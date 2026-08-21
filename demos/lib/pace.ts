/**
 * Making every beat read at the same speaking rate.
 *
 * A synthesizer's pace is a property of the sentence, not of the `speed` you
 * ask for: short lines get raced, comma-heavy lists get drawn out, and the two
 * land minutes apart on the same setting. Hand-tuning a `Speed:` per beat fixes
 * one line and moves the problem to its neighbour, which is audible — a slow
 * first sentence followed by a fast second one sounds like two different
 * recordings spliced together.
 *
 * So the rate is measured rather than requested, and corrected afterwards:
 *
 * 1. Count the syllables the beat's text should take to say.
 * 2. Measure how many seconds of *voice* the audio actually contains — total
 *    length minus the pauses, because a pause is punctuation, not pace.
 * 3. Resample with `atempo` until every beat sits at the same syllables per
 *    second.
 *
 * Words per second would be the obvious metric and is the wrong one:
 * "Logs, replays, releases, profiles" packs 1.8 syllables into every word and
 * "just like in the web app" packs 1.1, so equalising words per minute would
 * make the first line articulate half again as fast as the second. Syllables
 * are what the mouth actually does.
 *
 * Pauses ride along with the tempo change, which is what you want: a comma in a
 * line that was 20% too slow was also 20% too long.
 */

/** Comfortable narration sits here. Measured over voice, not over pauses. */
export const TARGET_SYLLABLES_PER_SECOND = 4.35;

/**
 * How far one beat may be pushed. Beyond this the correction is audible as
 * resampling rather than as delivery, and the real fault is upstream — a line
 * the synthesizer mangled, or a take that needs redoing.
 */
export const MIN_TEMPO = 0.7;
export const MAX_TEMPO = 1.55;

/**
 * Tokens the vowel-group heuristic gets wrong, because they are spelled out
 * letter by letter rather than read as words.
 */
const SPOKEN_AS_LETTERS: Record<string, number> = {
  ui: 2,
  npx: 3,
  cli: 3,
  api: 3,
  tui: 3,
  ai: 2,
  id: 2,
  k: 1,
  n: 1,
  j: 1,
  r: 1,
};

/**
 * Syllables in one word, by vowel groups with the usual English corrections.
 *
 * Approximate by construction — it only has to be consistent between beats, not
 * correct in a dictionary sense, because it is used to compare one line's pace
 * against another's rather than to measure anything absolute.
 */
export function countWordSyllables(raw: string): number {
  const word = raw.toLowerCase().replace(/[^a-z']/g, "");
  if (!word) return 0;

  const spelled = SPOKEN_AS_LETTERS[word];
  if (spelled !== undefined) return spelled;

  // A plural -s adds no syllable ("dashboards"), unless it lands after a
  // sibilant and becomes one ("releases").
  const stem = /(?:[szxcg]|ch|sh)es$/.test(word) || !/[^s]s$/.test(word) ? word : word.slice(0, -1);

  let count = (stem.match(/[aeiouy]+/g) ?? []).length;
  // Silent final e — "profile" is two, not three. Only after a consonant: the
  // "ee" in "disagree" is spoken, and "-le" after a consonant is syllabic in
  // its own right ("simple", "subtle").
  if (/[^aeiouy]e$/.test(stem) && !/[^aeiouy]le$/.test(stem) && count > 1) count--;
  // "-ed" is only a syllable after t or d: "ported" yes, "browsed" no.
  if (/[^td]ed$/.test(stem) && count > 1) count--;
  return Math.max(1, count);
}

/** Syllables in a line of narration. Hyphens split: "Control-K" is three. */
export function countSyllables(text: string): number {
  return text
    .split(/[\s\-—–]+/)
    .map(countWordSyllables)
    .reduce((sum, n) => sum + n, 0);
}

export interface VoiceProfile {
  /** Whole file, including the pause the synthesizer leaves at the end. */
  totalSeconds: number;
  /** Speech only — pauses subtracted. This is what pace is measured against. */
  voicedSeconds: number;
  /** Where the last word ends. */
  speechEndSeconds: number;
}

/** Silence quiet enough to be a pause rather than a breath. */
const SILENCE_DB = -35;
/** Shorter than this is phrasing inside a word, not a pause between phrases. */
const SILENCE_MIN_SECONDS = 0.12;

/**
 * Split a clip into voice and pauses with ffmpeg's `silencedetect`.
 *
 * The filter logs at info level, so this cannot run at the `-v error` every
 * other ffmpeg call in the harness uses.
 */
export async function profileVoice(path: string): Promise<VoiceProfile> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-nostats",
      "-i",
      path,
      "-af",
      `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN_SECONDS}`,
      "-f",
      "null",
      "-",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const log = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`Could not profile ${path}:\n${log}`);

  const totalSeconds = await probe(path);

  const spans: Array<{ start: number; end: number }> = [];
  let open: number | null = null;
  for (const line of log.split("\n")) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Number(start[1]);
      continue;
    }
    const end = /silence_end:\s*([\d.]+)/.exec(line);
    if (end && open !== null) {
      spans.push({ start: Math.max(0, open), end: Number(end[1]) });
      open = null;
    }
  }
  // A clip that ends in silence never logs `silence_end`.
  if (open !== null) spans.push({ start: Math.max(0, open), end: totalSeconds });

  const trailing = spans.find((span) => span.end >= totalSeconds - 0.01);
  const speechEndSeconds = trailing ? trailing.start : totalSeconds;
  const paused = spans
    .filter((span) => span !== trailing)
    .reduce((sum, span) => sum + (span.end - span.start), 0);

  return {
    totalSeconds,
    voicedSeconds: Math.max(0.1, speechEndSeconds - paused),
    speechEndSeconds,
  };
}

/** Duration in seconds, straight from the container. */
async function probe(path: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`ffprobe failed on ${path}`);
  return Number(out.trim());
}

export interface Pacing {
  syllables: number;
  /** Rate of the source audio, syllables of voice per second. */
  sourceRate: number;
  /** Rate after correction — the target, unless the tempo had to be clamped. */
  pacedRate: number;
  tempo: number;
  clamped: boolean;
  /** Length of the corrected file. */
  seconds: number;
}

/**
 * Resample one beat to the target rate, writing the corrected file.
 *
 * `atempo` moves tempo without touching pitch, so a beat that was read too
 * slowly comes back at the same voice rather than a higher one. Factors stay
 * inside a single filter's 0.5–2.0 range by the clamp above.
 *
 * @param emphasis Deliberate departure from the target, per beat: 0.95 reads
 *   this line 5% slower than the rest of the script. Defaults to 1.
 */
export async function paceClip(
  source: string,
  destination: string,
  text: string,
  emphasis = 1,
  target = TARGET_SYLLABLES_PER_SECOND,
): Promise<Pacing> {
  const syllables = countSyllables(text);
  const { voicedSeconds } = await profileVoice(source);
  const sourceRate = syllables / voicedSeconds;

  const wanted = (target * emphasis) / sourceRate;
  const tempo = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, wanted));
  const clamped = Math.abs(tempo - wanted) > 0.001;

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      source,
      "-filter:a",
      `atempo=${tempo.toFixed(4)}`,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      "-y",
      destination,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) {
    throw new Error(`Could not pace ${source}:\n${await new Response(proc.stderr).text()}`);
  }

  return {
    syllables,
    sourceRate,
    pacedRate: sourceRate * tempo,
    tempo,
    clamped,
    seconds: await probe(destination),
  };
}

export interface PacedBeat extends Pacing {
  id: string;
  title: string;
  words: number;
  /** Gross rate including pauses, for the record — this one is allowed to vary. */
  wordsPerMinute: number;
}

/**
 * Correct every beat that has audio onto one speaking rate.
 *
 * Reads `${audioDir}/BNN.mp3` and writes `${pacedDir}/BNN.mp3`, so running it
 * twice produces the same result as running it once — the correction is always
 * computed from the original take, never from the last correction.
 *
 * Beats with no audio are skipped rather than failing: `demo:tts` reports what
 * is missing, and it does it with the beat titles this function doesn't have to
 * duplicate.
 */
export async function paceAll(
  beats: Array<{ id: string; title: string; text: string; emphasis?: number }>,
  options: { audioDir: string; pacedDir: string; target?: number } = {
    audioDir: "",
    pacedDir: "",
  },
): Promise<PacedBeat[]> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(options.pacedDir, { recursive: true });

  const paced: PacedBeat[] = [];
  for (const beat of beats) {
    const source = `${options.audioDir}/${beat.id}.mp3`;
    if (!(await Bun.file(source).exists())) continue;
    const pacing = await paceClip(
      source,
      `${options.pacedDir}/${beat.id}.mp3`,
      beat.text,
      beat.emphasis ?? 1,
      options.target ?? TARGET_SYLLABLES_PER_SECOND,
    );
    const words = beat.text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
    paced.push({
      ...pacing,
      id: beat.id,
      title: beat.title,
      words,
      wordsPerMinute: (words / pacing.seconds) * 60,
    });
  }
  return paced;
}

/** One line per beat: what it was, what it is now, and whether it fought back. */
export function formatPacingReport(paced: PacedBeat[]): string {
  return paced
    .map((beat) => {
      const flag = beat.clamped ? " ⚠ clamped — check the take" : "";
      return (
        `  ${beat.id} ${beat.seconds.toFixed(1)}s  ` +
        `${beat.sourceRate.toFixed(2)} → ${beat.pacedRate.toFixed(2)} syl/s ` +
        `@${beat.tempo.toFixed(2)}×  ${Math.round(beat.wordsPerMinute)}wpm — ${beat.title}${flag}`
      );
    })
    .join("\n");
}
