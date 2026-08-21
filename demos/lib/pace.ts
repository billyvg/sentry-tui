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

/**
 * How fast the mouth moves: syllables per second of speech, pauses excluded.
 */
export const TARGET_ARTICULATION = 4.35;

/**
 * How fast the line arrives: syllables per second including its pauses.
 *
 * Two targets rather than one, because they are what a listener actually hears
 * as pace and one knob cannot hold both. Correct only the articulation and a
 * line the synthesizer ran together with no breath comes out at the same mouth
 * speed as a comma-heavy one and still sounds twice as fast — measured on the
 * cut this replaced, 210 words a minute against 118, with both beats sitting
 * within 2% of the same syllables per second. So the pauses get a budget too:
 * `TARGET_ARTICULATION` sets the speech, this sets the space around it.
 *
 * The gap between the two is the share of a beat spent not talking — about 17%
 * here, which is ordinary for narration.
 */
export const TARGET_OVERALL = 3.6;

/** No pause is allowed to fall below this, or to run past it. */
const MIN_PAUSE_SECONDS = 0.12;
const MAX_PAUSE_SECONDS = 0.6;
/** Silence left after the last word, so a beat doesn't end on a hard cut. */
const TAIL_SECONDS = 0.25;

/**
 * How far the pauses as a group may be rescaled.
 *
 * Reaching the budget matters less than keeping the phrasing recognisable: the
 * gaps are scaled together, in proportion to how the read placed them, so a
 * dramatic pause stays the longest one. Growing them hard is the riskier
 * direction — a 0.08s breath stretched fourfold is not a pause, it's a stutter
 * — so the ceiling is low, and what the pauses can't absorb goes to the speech
 * instead.
 */
const MIN_PAUSE_SCALE = 0.4;
const MAX_PAUSE_SCALE = 2.2;

/**
 * How far a beat's speech may sit from the articulation target.
 *
 * The last resort for a line the pauses can't fix: a sentence the synthesizer
 * ran together in one breath has nowhere to put its budget, so it is read a
 * little slower instead of being given pauses it never had. Which is what a
 * person does with the same sentence.
 */
const ARTICULATION_TOLERANCE = 0.12;

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

/** Keep a rebuilt pause inside what reads as punctuation. */
const clampPause = (seconds: number) =>
  Math.min(MAX_PAUSE_SECONDS, Math.max(MIN_PAUSE_SECONDS, seconds));

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
  /** Speech rate of the source audio, syllables per second of voice. */
  sourceRate: number;
  /** Speech rate after correction — the target, unless the tempo was clamped. */
  pacedRate: number;
  /** Rate including pauses: what the line sounds like it is going at. */
  overallRate: number;
  tempo: number;
  /** What the pauses were multiplied by to reach their budget. */
  pauseScale: number;
  clamped: boolean;
  /** Length of the corrected file. */
  seconds: number;
}

/** Audio layout of a file, for generating silence that matches it. */
async function audioFormat(path: string): Promise<{ rate: number; layout: string }> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,channels",
      "-of",
      "csv=p=0",
      path,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const [rate, channels] = (await new Response(proc.stdout).text()).trim().split(",").map(Number);
  await proc.exited;
  return { rate: rate || 24000, layout: channels === 2 ? "stereo" : "mono" };
}

/**
 * Work out how to re-time one beat, from its measurements alone.
 *
 * Split out from the ffmpeg work because it is the whole idea and worth being
 * able to test: how much of the correction the pauses take, how much is left
 * for the speech, and what happens when neither can reach the target.
 */
export function planPacing(input: {
  syllables: number;
  /** Seconds of speech in the take, pauses excluded. */
  voicedSeconds: number;
  /** Length of each pause between words, in order. */
  gaps: number[];
  emphasis?: number;
  target?: number;
  overallTarget?: number;
}): { tempo: number; pauseScale: number; articulation: number; clamped: boolean } {
  const emphasis = input.emphasis ?? 1;
  const target = (input.target ?? TARGET_ARTICULATION) * emphasis;
  const overallTarget = (input.overallTarget ?? TARGET_OVERALL) * emphasis;
  const { syllables, voicedSeconds, gaps } = input;

  // How long the beat should run, and how that time divides. The pauses go
  // first, because they are the cheaper thing to move: speech that has been
  // resampled sounds resampled, and silence never does.
  const wantedSeconds = syllables / overallTarget;
  const pauseBudget = Math.max(0, wantedSeconds - syllables / target);

  const pausesNow = gaps.reduce((sum, gap) => sum + gap, 0);
  const pauseScale =
    gaps.length === 0 || pausesNow <= 0
      ? 1
      : Math.min(MAX_PAUSE_SCALE, Math.max(MIN_PAUSE_SCALE, pauseBudget / pausesNow));
  const paused = gaps.reduce((sum, gap) => sum + clampPause(gap * pauseScale), 0);

  // Whatever the pauses could not absorb, the speech takes — within a bound, so
  // this stays a nudge in delivery rather than an audible slow-down.
  const articulation = Math.min(
    target * (1 + ARTICULATION_TOLERANCE),
    Math.max(
      target * (1 - ARTICULATION_TOLERANCE),
      syllables / Math.max(0.1, wantedSeconds - paused),
    ),
  );

  const wanted = articulation / (syllables / voicedSeconds);
  const tempo = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, wanted));
  return { tempo, pauseScale, articulation, clamped: Math.abs(tempo - wanted) > 0.001 };
}

/**
 * Re-time one beat: speech to the articulation target, pauses to their budget.
 *
 * The clip is cut at its silences, every speech run is resampled by the same
 * factor — one factor, so the delivery inside the line is untouched — and the
 * gaps between them are rebuilt at new lengths. `atempo` moves tempo without
 * moving pitch, so a beat that was read too fast comes back as the same voice
 * rather than a deeper one.
 *
 * Pauses are scaled together rather than set individually: the read decided
 * where the emphasis went, and a beat whose gaps are all 200ms of the same
 * nothing is a beat that has had its phrasing ironed out.
 *
 * @param emphasis Deliberate departure from both targets, per beat: 0.95 reads
 *   this line 5% slower than the rest of the script. Defaults to 1.
 */
export async function paceClip(
  source: string,
  destination: string,
  text: string,
  emphasis = 1,
  target = TARGET_ARTICULATION,
  overallTarget = TARGET_OVERALL,
): Promise<Pacing> {
  const syllables = countSyllables(text);
  const { voicedSeconds, speechEndSeconds, gaps } = await profileVoice(source);
  const sourceRate = syllables / voicedSeconds;
  const { tempo, pauseScale, clamped } = planPacing({
    syllables,
    voicedSeconds,
    gaps: gaps.map((gap) => gap.end - gap.start),
    emphasis,
    target,
    overallTarget,
  });

  const { rate, layout } = await audioFormat(source);

  // Speech runs are what is left of the clip once the gaps are taken out of it.
  const speech: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.start > cursor) speech.push({ start: cursor, end: gap.start });
    cursor = gap.end;
  }
  if (speechEndSeconds > cursor) speech.push({ start: cursor, end: speechEndSeconds });

  const parts: string[] = [];
  const labels: string[] = [];
  speech.forEach((run, i) => {
    parts.push(
      `[0:a]atrim=start=${run.start.toFixed(3)}:end=${run.end.toFixed(3)},` +
        `asetpts=PTS-STARTPTS,atempo=${tempo.toFixed(4)}[s${i}]`,
    );
    labels.push(`[s${i}]`);
    const gap = gaps[i];
    if (!gap) return;
    const seconds = clampPause((gap.end - gap.start) * pauseScale);
    parts.push(`anullsrc=r=${rate}:cl=${layout},atrim=duration=${seconds.toFixed(3)}[g${i}]`);
    labels.push(`[g${i}]`);
  });
  parts.push(`anullsrc=r=${rate}:cl=${layout},atrim=duration=${TAIL_SECONDS}[tail]`);
  labels.push("[tail]");

  const filter = `${parts.join(";")};${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`;

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      source,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
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

  const paced = await profileVoice(destination);
  return {
    syllables,
    sourceRate,
    pacedRate: syllables / paced.voicedSeconds,
    overallRate: syllables / paced.speechEndSeconds,
    tempo,
    pauseScale,
    clamped,
    seconds: paced.totalSeconds,
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
  options: { audioDir: string; pacedDir: string; target?: number; overallTarget?: number } = {
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
      options.target ?? TARGET_ARTICULATION,
      options.overallTarget ?? TARGET_OVERALL,
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
        `${beat.sourceRate.toFixed(2)} → ${beat.pacedRate.toFixed(2)} syl/s @${beat.tempo.toFixed(2)}×  ` +
        `overall ${beat.overallRate.toFixed(2)} (pauses ${beat.pauseScale.toFixed(2)}×)  ` +
        `${Math.round(beat.wordsPerMinute)}wpm — ${beat.title}${flag}`
      );
    })
    .join("\n");
}
