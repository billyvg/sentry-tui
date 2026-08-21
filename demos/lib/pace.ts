/**
 * Measuring how fast each beat reads.
 *
 * This used to correct the audio as well — resample the speech onto a target
 * rate, rebuild the pauses to a budget — and those corrected files were what
 * the cut played. They were consistent, and they sounded processed, which is a
 * poor trade for a demo whose whole pitch is that the thing on screen is real.
 * The synthesizer reads the line however it reads it now, and nothing
 * downstream touches the samples.
 *
 * What survives is the measurement, because knowing *why* a beat sounds off is
 * still worth having. A line the model raced shows up here as a high
 * articulation rate, and the fixes are the honest ones: rewrite the line, or
 * slow that beat at synthesis time with `**Emphasis:**`, which asks the model
 * to read it differently rather than operating on what it returned.
 *
 * Syllables rather than words, throughout. "Logs, replays, releases, profiles"
 * packs 1.8 syllables into every word and "just like in the web app" packs 1.1,
 * so words per minute calls those two wildly different speeds when the mouth is
 * moving at exactly the same rate.
 */

/**
 * What a comfortable read looks like — for flagging, not for correcting.
 *
 * `ARTICULATION` counts syllables per second of speech; `OVERALL` counts the
 * pauses too, which is what a listener hears as pace. A beat outside these
 * bands is not wrong — a punchline is allowed to take its time — but it is the
 * first place to look when the script sounds uneven.
 */
export const COMFORTABLE_ARTICULATION = { min: 3.8, max: 5.1 };
export const COMFORTABLE_OVERALL = { min: 3.0, max: 4.3 };

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
  /** Pauses between words, in order. The trailing silence is not one of them. */
  gaps: Array<{ start: number; end: number }>;
}

/**
 * A short hash of what a beat says, stored beside its audio.
 *
 * Pace is measured by counting the syllables in the script and comparing them
 * against the seconds in the file, which is nonsense the moment the two are of
 * different vintages — an edited line against yesterday's take reads as a beat
 * that needs a 40% correction, and the correction gets applied. This is how the
 * pipeline notices.
 */
export function textFingerprint(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);
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
    gaps: spans.filter((span) => span !== trailing),
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

export interface BeatRate {
  id: string;
  title: string;
  words: number;
  syllables: number;
  /** Length of the file, trailing silence included. */
  seconds: number;
  /** Syllables per second of speech: how fast the mouth moves. */
  articulation: number;
  /** Syllables per second including pauses: how fast the line arrives. */
  overall: number;
  wordsPerMinute: number;
}

/**
 * Measure every beat that has audio.
 *
 * Beats with no audio are skipped rather than failing: `demo:tts` reports what
 * is missing, with the titles this would only be duplicating.
 */
export async function measureBeats(
  beats: Array<{ id: string; title: string; text: string }>,
  audioDir: string,
): Promise<BeatRate[]> {
  const rates: BeatRate[] = [];
  for (const beat of beats) {
    const path = `${audioDir}/${beat.id}.mp3`;
    if (!(await Bun.file(path).exists())) continue;
    const { totalSeconds, voicedSeconds, speechEndSeconds } = await profileVoice(path);
    const syllables = countSyllables(beat.text);
    const words = beat.text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
    rates.push({
      id: beat.id,
      title: beat.title,
      words,
      syllables,
      seconds: totalSeconds,
      articulation: syllables / voicedSeconds,
      overall: syllables / speechEndSeconds,
      wordsPerMinute: (words / speechEndSeconds) * 60,
    });
  }
  return rates;
}

/** Is this beat read at a pace the rest of the script can live with? */
export function rateVerdict(beat: BeatRate): "rushed" | "draggy" | "fine" {
  if (beat.articulation > COMFORTABLE_ARTICULATION.max || beat.overall > COMFORTABLE_OVERALL.max) {
    return "rushed";
  }
  if (beat.articulation < COMFORTABLE_ARTICULATION.min || beat.overall < COMFORTABLE_OVERALL.min) {
    return "draggy";
  }
  return "fine";
}

/** One line per beat, flagging the reads that sit outside the band. */
export function formatRateReport(rates: BeatRate[]): string {
  const flags = { rushed: " ⚡rushed", draggy: " 🐢draggy", fine: "" };
  return rates
    .map(
      (beat) =>
        `  ${beat.id} ${beat.seconds.toFixed(1)}s  ` +
        `${beat.articulation.toFixed(2)} syl/s speaking, ${beat.overall.toFixed(2)} overall  ` +
        `${Math.round(beat.wordsPerMinute)}wpm — ${beat.title}${flags[rateVerdict(beat)]}`,
    )
    .join("\n");
}
