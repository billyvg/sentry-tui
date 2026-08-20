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
import { BUILD_DIR, AUDIO_DIR, DURATIONS_PATH, TAPE_PATH } from "./lib/paths.ts";
import { parseTape, timeline } from "./lib/tape.ts";

const tape = parseTape(await file(TAPE_PATH).text());

const durationsFile = file(DURATIONS_PATH);
if (!(await durationsFile.exists())) {
  throw new Error("No build/durations.json — run `bun run demo:tts` first.");
}
const durations = (await durationsFile.json()) as Record<string, number>;

const video = `${BUILD_DIR}/${tape.settings.output.replace(/^build\//, "")}`;
if (!(await file(video).exists())) {
  throw new Error(`No ${video} — run \`bun run demo:record\` first.`);
}

const output = `${BUILD_DIR}/demo.mp4`;

/** Beats to place, with the millisecond offset each one starts at. */
const placements: Array<{ beat: string; path: string; atMs: number }> = [];
for (const { step, atMs } of timeline(tape, durations)) {
  if (step.kind !== "wait") continue;
  const path = `${AUDIO_DIR}/${step.beat}.mp3`;
  if (!(await file(path).exists())) {
    throw new Error(`Tape waits on @${step.beat} but ${path} does not exist. Re-run demo:tts.`);
  }
  placements.push({ beat: step.beat, path, atMs });
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
const filterComplex = `${filters};${mixInputs}amix=inputs=${placements.length}:normalize=0[out]`;

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
  "0:v",
  "-map",
  "[out]",
  // The picture is already encoded and correct; only the audio is new.
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-y",
  output,
];

console.log(`Laying ${placements.length} beats onto ${video}…`);
const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
if ((await proc.exited) !== 0) {
  throw new Error(`ffmpeg failed:\n${await new Response(proc.stderr).text()}`);
}

const videoSeconds = await probeDuration(video);
const lastBeat = placements[placements.length - 1]!;
const narrationEnd = (lastBeat.atMs + (durations[lastBeat.beat] ?? 0) * 1000) / 1000;

console.log(`\nWrote ${output}`);
console.log(`  video     ${videoSeconds.toFixed(1)}s`);
console.log(`  narration ends at ${narrationEnd.toFixed(1)}s`);

if (narrationEnd > videoSeconds + 0.5) {
  console.warn(
    `\nThe narration runs past the end of the picture by ${(narrationEnd - videoSeconds).toFixed(1)}s.\n` +
      `The capture was probably cut short — re-record, or add a trailing Sleep to the tape.`,
  );
}

await write(`${BUILD_DIR}/.gitkeep`, "");
