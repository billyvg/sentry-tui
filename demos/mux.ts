#!/usr/bin/env bun
/**
 * `bun run demo:mux` — lay the narration onto the silent capture.
 *
 * Each beat is placed at the offset the tape puts it at, rather than the audio
 * being concatenated end to end. That difference matters: any `Sleep` between
 * two `Wait`s is silence in the finished cut, and concatenating would slide
 * every later line earlier by the length of every gap before it.
 */

import { file, write } from "bun";

import { probeDuration } from "./lib/capture.ts";
import { parseNarration } from "./lib/narration.ts";
import { textFingerprint } from "./lib/pace.ts";
import {
  AUDIO_DIR,
  BUILD_DIR,
  DURATIONS_PATH,
  NARRATION_PATH,
  TAPE_PATH,
  TIMELINE_PATH,
} from "./lib/paths.ts";
import { type Freeze, syncToAudio } from "./lib/sync.ts";
import { parseTape, timeline } from "./lib/tape.ts";

const tape = parseTape(await file(TAPE_PATH).text());

const durationsFile = file(DURATIONS_PATH);
if (!(await durationsFile.exists())) {
  throw new Error("No build/durations.json — run `bun run demo:tts` first.");
}
const durations = (await durationsFile.json()) as Record<string, number>;

const video = `${BUILD_DIR}/${tape.settings.output.replace(/^build\//, "").replace(/\.\w+$/, "")}.mov`;
if (!(await file(video).exists())) {
  throw new Error(`No ${video} — run \`bun run demo:record\` first.`);
}

const output = `${BUILD_DIR}/demo.mp4`;

/**
 * Refuse to quietly ship the previous wording of a line.
 *
 * Editing `narration.md` and re-muxing without re-rendering produces a cut that
 * looks right, runs to the right length, and says something else. Each beat's
 * audio carries a fingerprint of the words it was made from, so the mismatch is
 * visible here rather than on a second viewing.
 */
const cacheFile = file(`${BUILD_DIR}/tts-cache.json`);
const fingerprints = (await cacheFile.exists())
  ? ((await cacheFile.json()) as Record<string, { text?: string }>)
  : {};
const edited = parseNarration(await file(NARRATION_PATH).text()).filter((beat) => {
  const recorded = fingerprints[beat.id]?.text;
  return recorded !== undefined && recorded !== textFingerprint(beat.text);
});
if (edited.length > 0) {
  console.warn(
    `${edited.map((beat) => beat.id).join(", ")} ` +
      `${edited.length === 1 ? "has" : "have"} been edited since the audio was made.\n` +
      `This cut will speak the old wording. Run \`bun run demo:tts\` first.\n`,
  );
}

/**
 * Where each beat's audio goes.
 *
 * `demo:record` writes the offsets it actually produced, and those win: a
 * `Settle` runs for as long as it runs, and every kitty round-trip costs a few
 * milliseconds that the plan doesn't know about. Re-deriving the timeline here
 * would drift the narration progressively late against the picture.
 */
const recorded = file(TIMELINE_PATH);
const actual: Map<string, number> = (await recorded.exists())
  ? new Map(
      ((await recorded.json()) as { beats: Array<{ id: string; atMs: number }> }).beats.map(
        ({ id, atMs }) => [id, atMs],
      ),
    )
  : new Map();

if (actual.size === 0) {
  console.warn(
    "No build/timeline.json — falling back to the tape's predicted offsets.\n" +
      "Re-record to get the real ones; anything dynamic will be slightly out of sync.\n",
  );
}

async function audioFor(beat: string): Promise<string> {
  const path = `${AUDIO_DIR}/${beat}.mp3`;
  if (!(await file(path).exists())) {
    throw new Error(`Tape waits on @${beat} but ${path} does not exist. Re-run demo:tts.`);
  }
  return path;
}

const beatsInOrder: Array<{ beat: string; path: string; recordedAtMs: number }> = [];
for (const { step, atMs } of timeline(tape, durations)) {
  if (step.kind !== "wait" && step.kind !== "meanwhile") continue;
  beatsInOrder.push({
    beat: step.beat,
    path: await audioFor(step.beat),
    recordedAtMs: actual.get(step.beat) ?? atMs,
  });
}

/**
 * Where each line actually goes, and where the picture has to wait for it.
 *
 * Narration re-rendered since the take is not the same length as the narration
 * the take was cut to — the synthesizer is not deterministic, and the script
 * gets edited. Rather than squeezing the audio back into the hole left for it,
 * the picture holds a frame until the line is done. See `lib/sync.ts`.
 */
const sync = syncToAudio(
  beatsInOrder.map(({ beat, recordedAtMs }) => ({
    id: beat,
    atMs: recordedAtMs,
    seconds: durations[beat] ?? 0,
  })),
);

const placements = beatsInOrder.map((entry, i) => ({
  ...entry,
  atMs: sync.placements[i]?.atMs ?? entry.recordedAtMs,
}));

if (placements.length === 0)
  throw new Error("The tape has no Wait steps, so there is no audio to lay.");

// `adelay` per input to put it at its offset, then one `amix` to sum them.
// `normalize=0` keeps each line at full level — mixing normalised inputs would
// duck every beat in proportion to how many beats exist, which is not a thing
// anybody wants.
const filters = placements
  .map(({ atMs }, i) => `[${i + 1}:a]adelay=${atMs}|${atMs}[a${i}]`)
  .join(";");
const mixInputs = placements.map((_, i) => `[a${i}]`).join("");

/** Constant frame rate for the finished cut. */
const FPS = 30;

/**
 * The picture has to be re-encoded, not copied.
 *
 * `screencapture` writes a variable frame rate stream and only emits a frame
 * when the screen changes — sensible for a terminal, and fine on its own. What
 * isn't fine is that it leaves the timestamps in a state ffmpeg can't reason
 * about: they arrive out of order, and at least one stray packet lands tens of
 * seconds past the end of the recording. Copied straight through, that packet
 * becomes the file's duration — one cut claimed 97 seconds for 73 seconds of
 * picture, and `-t` computed against those timestamps trimmed to the wrong
 * place. `fps` re-times the stream onto a constant grid.
 *
 * On that grid the freezes are cheap: cut the stream where a line needs room,
 * clone the frame there for as long as it needs, and concatenate. The last
 * segment gets a minute of the final frame regardless, because the capture
 * emits nothing at all while the picture is still — the outro would otherwise
 * be one frame with no duration behind it, and the file would end the moment
 * the last word does.
 */
function videoChain(freezes: Freeze[]): string {
  /** Clone of the last frame, for the trim below to cut back to length. */
  const tail = "tpad=stop_mode=clone:stop_duration=60";
  if (freezes.length === 0) return `[0:v]fps=${FPS},${tail}[v]`;

  const segments = freezes.length + 1;
  const cuts = freezes.map(({ atMs }) => atMs / 1000);
  const parts = [
    `[0:v]fps=${FPS},split=${segments}` +
      Array.from({ length: segments }, (_, i) => `[c${i}]`).join(""),
  ];

  for (let i = 0; i < segments; i++) {
    const from = i === 0 ? 0 : cuts[i - 1]!;
    const to = cuts[i];
    const hold = freezes[i]?.holdMs;
    parts.push(
      `[c${i}]trim=start=${from.toFixed(3)}${to === undefined ? "" : `:end=${to.toFixed(3)}`},` +
        `setpts=PTS-STARTPTS,` +
        `tpad=stop_mode=clone:stop_duration=${hold === undefined ? 60 : (hold / 1000).toFixed(3)}` +
        `[p${i}]`,
    );
  }

  const joined = Array.from({ length: segments }, (_, i) => `[p${i}]`).join("");
  parts.push(`${joined}concat=n=${segments}:v=1:a=0[v]`);
  return parts.join(";");
}

const filterComplex =
  `${videoChain(sync.freezes)};${filters};` +
  `${mixInputs}amix=inputs=${placements.length}:normalize=0[out]`;

/**
 * Where the demo ends, as opposed to where the recorder gave up.
 *
 * The capture budget has to allow for every `Settle` running its full maximum
 * (see `demo:record`), so a take that waited less than that — which is every
 * take — ends with a stretch of the last frame. The tape says how long that
 * frame is meant to hold: whatever it does after the final beat. Cutting there
 * keeps the file honest about the demo's length instead of shipping half a
 * minute of a still prompt.
 */
const planned = timeline(tape, durations);
const lastBeatAt = planned.findLastIndex(
  ({ step }) => step.kind === "wait" || step.kind === "meanwhile",
);
const trailingMs = planned.slice(lastBeatAt + 1).reduce((sum, entry) => sum + entry.holdMs, 0);
const endsAtMs =
  placements[placements.length - 1]!.atMs +
  (durations[placements[placements.length - 1]!.beat] ?? 0) * 1000 +
  trailingMs;
/** A moment of air, so the cut doesn't land on the frame the last line ends in. */
const TAIL_PAD_MS = 500;

const args = [
  "ffmpeg",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  video,
  ...placements.flatMap(({ path }) => ["-i", path]),
  "-filter_complex",
  filterComplex,
  "-map",
  "[v]",
  "-map",
  "[out]",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  // Terminal text is unforgiving of a soft encode, and the picture is mostly
  // static, so a low crf costs little.
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-t",
  ((endsAtMs + TAIL_PAD_MS) / 1000).toFixed(3),
  "-y",
  output,
];

console.log(`Laying ${placements.length} beats onto ${video}…`);
if (sync.freezes.length > 0) {
  console.log(
    `  holding the picture at ${sync.freezes.length} point${sync.freezes.length === 1 ? "" : "s"} ` +
      `for ${(sync.addedMs / 1000).toFixed(1)}s, so every line finishes before the next starts`,
  );
}
const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
if ((await proc.exited) !== 0) {
  throw new Error(`ffmpeg failed:\n${await new Response(proc.stderr).text()}`);
}

const videoSeconds = await probeDuration(output);
const capturedSeconds = await probeDuration(video);
const lastBeat = placements[placements.length - 1]!;
const narrationEnd = (lastBeat.atMs + (durations[lastBeat.beat] ?? 0) * 1000) / 1000;

console.log(`\nWrote ${output}`);
console.log(`  video     ${videoSeconds.toFixed(1)}s`);
console.log(`  narration ends at ${narrationEnd.toFixed(1)}s`);
if (capturedSeconds > videoSeconds + 0.5) {
  console.log(
    `  trimmed   ${(capturedSeconds - videoSeconds).toFixed(1)}s of tail off the capture`,
  );
}

if (narrationEnd > capturedSeconds + 0.5) {
  console.warn(
    `\nThe narration runs past the end of the picture by ${(narrationEnd - capturedSeconds).toFixed(1)}s.\n` +
      `The capture was cut short — re-record, or add a trailing Sleep to the tape.`,
  );
}

await write(`${BUILD_DIR}/.gitkeep`, "");
