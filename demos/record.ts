#!/usr/bin/env bun
/**
 * `bun run demo:record` — replay the tape into a real Kitty window and capture it.
 *
 * The output has no audio: `demo:mux` lays the narration on afterwards, using
 * the same timeline walk this script sleeps by, so picture and voice line up by
 * construction rather than by nudging.
 */

import { file } from "bun";
import { mkdir } from "node:fs/promises";

import { readGeometry, ScreenRecording } from "./lib/capture.ts";
import { KittySession } from "./lib/kitty.ts";
import {
  assertNotMultiplexed,
  BUILD_DIR,
  DURATIONS_PATH,
  REPO_ROOT,
  shellEnv,
  writeShim,
  SOCKET,
  TAPE_PATH,
} from "./lib/paths.ts";
import { parseTape, timeline } from "./lib/tape.ts";

/** Give the window time to open and the shell to draw its prompt. */
const WARMUP_MS = 1500;
/** Trailing pad so the final frame isn't the recorder shutting down. */
const TAIL_MS = 1200;

assertNotMultiplexed();

const tape = parseTape(await file(TAPE_PATH).text());
const geometry = await readGeometry();

const durationsFile = file(DURATIONS_PATH);
const durations = (await durationsFile.exists())
  ? ((await durationsFile.json()) as Record<string, number>)
  : {};

if (Object.keys(durations).length === 0) {
  console.warn(
    "No build/durations.json — every Wait will hold for the fallback instead of the\n" +
      "length of its narration. Run `bun run demo:tts` first for a cut that matches the voice.\n",
  );
}

await mkdir(BUILD_DIR, { recursive: true });
const output = `${BUILD_DIR}/${tape.settings.output.replace(/^build\//, "")}`;

const plan = timeline(tape, durations);
const totalMs = plan.reduce((sum, entry) => sum + entry.holdMs, 0);
console.log(
  `Recording ${plan.length} steps, about ${(totalMs / 1000).toFixed(1)}s of screen time.`,
);

await writeShim();

const kitty = await KittySession.launch({
  socket: SOCKET,
  columns: tape.settings.columns,
  rows: tape.settings.rows,
  fontSize: tape.settings.fontSize,
  cwd: REPO_ROOT,
  env: shellEnv(tape.env),
});

let recording: ScreenRecording | undefined;
try {
  await Bun.sleep(WARMUP_MS);
  // Wipe the login banner before anything is captured, so the tape never has to
  // know that macOS prints one.
  await kitty.clearScreen();
  await Bun.sleep(500);

  recording = ScreenRecording.start(geometry, output);
  // ffmpeg needs a moment to open the device; starting the tape into a capture
  // that hasn't begun loses the opening beat.
  await Bun.sleep(800);

  for (const { step, holdMs } of plan) {
    switch (step.kind) {
      case "type":
        await kitty.type(step.text);
        break;
      case "key":
        await kitty.key(step.chord, step.count);
        break;
      case "sleep":
      case "wait":
        break;
    }
    if (step.kind === "wait") {
      console.log(`  @${step.beat} — ${(holdMs / 1000).toFixed(1)}s`);
    }
    if (holdMs > 0) await Bun.sleep(holdMs);
  }

  await Bun.sleep(TAIL_MS);
} finally {
  await recording?.stop();
  await kitty.close();
}

console.log(`\nWrote ${output}`);
console.log("Watch it before muxing — kitty's send-key cannot report a dropped keystroke.");
