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
import {
  AUDIO_DIR,
  BUILD_DIR,
  DURATIONS_PATH,
  PACED_DIR,
  TAPE_PATH,
  TIMELINE_PATH,
} from "./lib/paths.ts";
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

/**
 * The pace-corrected take, falling back to the raw one.
 *
 * `durations.json` is measured on whichever of these the pipeline last wrote,
 * and the tape held for exactly that long — so laying down the other file would
 * put every beat at the right offset and the wrong length.
 */
async function audioFor(beat: string): Promise<string> {
  const paced = `${PACED_DIR}/${beat}.mp3`;
  if (await file(paced).exists()) return paced;
  const raw = `${AUDIO_DIR}/${beat}.mp3`;
  if (await file(raw).exists()) return raw;
  throw new Error(`Tape waits on @${beat} but there is no audio for it. Re-run demo:tts.`);
}

const placements: Array<{ beat: string; path: string; atMs: number }> = [];
for (const { step, atMs } of timeline(tape, durations)) {
  if (step.kind !== "wait" && step.kind !== "meanwhile") continue;
  placements.push({
    beat: step.beat,
    path: await audioFor(step.beat),
    atMs: actual.get(step.beat) ?? atMs,
  });
}

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
 * becomes the file's duration — the last cut claimed 97 seconds for 73 seconds
 * of picture, and `-t` computed against those timestamps trimmed to the wrong
 * place. `fps` re-times the stream onto a constant grid, holding the last frame
 * across the stretches where nothing moved, which is also what makes the trim
 * below land where it says it does.
 */
const filterComplex =
  `[0:v]fps=${FPS}[v];${filters};` +
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
