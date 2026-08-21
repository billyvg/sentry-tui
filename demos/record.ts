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

import { probeSize, WindowRecording } from "./lib/capture.ts";
import { KittySession } from "./lib/kitty.ts";
import {
  assertNotMultiplexed,
  BUILD_DIR,
  DURATIONS_PATH,
  REPO_ROOT,
  shellEnv,
  SOCKET,
  TAPE_PATH,
  writeShim,
} from "./lib/paths.ts";
import { parseTape, timeline } from "./lib/tape.ts";

/** Give the window time to open and the shell to draw its prompt. */
const WARMUP_MS = 1500;
/** Let the recorder get going before the first keystroke lands. */
const LEAD_IN_MS = 800;
/** Trailing pad so the final frame isn't the recorder shutting down. */
const TAIL_MS = 1500;

assertNotMultiplexed();

const tape = parseTape(await file(TAPE_PATH).text());

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
// screencapture writes QuickTime; `demo:mux` copies the stream into an mp4.
const output = `${BUILD_DIR}/${tape.settings.output.replace(/^build\//, "").replace(/\.\w+$/, "")}.mov`;

const plan = timeline(tape, durations);
const tapeMs = plan.reduce((sum, entry) => sum + entry.holdMs, 0);
// The recorder stops itself, so the limit has to cover the whole take.
const captureSeconds = (LEAD_IN_MS + tapeMs + TAIL_MS) / 1000;
console.log(`Recording ${plan.length} steps, about ${(tapeMs / 1000).toFixed(1)}s of screen time.`);

await writeShim();

const kitty = await KittySession.launch({
  socket: SOCKET,
  columns: tape.settings.columns,
  rows: tape.settings.rows,
  fontSize: tape.settings.fontSize,
  cwd: REPO_ROOT,
  env: shellEnv(tape.env),
});

let recording: WindowRecording | undefined;
try {
  await Bun.sleep(WARMUP_MS);
  // Wipe the login banner before anything is captured, so the tape never has to
  // know that macOS prints one.
  await kitty.clearScreen();
  await Bun.sleep(500);

  const windowId = await kitty.platformWindowId();
  if (windowId === null) throw new Error("kitty did not report a window id to record.");

  // One window, by id — nothing on top of it can get into the picture, and
  // there is no rectangle to get wrong.
  recording = WindowRecording.start(windowId, captureSeconds, output);
  await Bun.sleep(LEAD_IN_MS);

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

  await recording.finish();
} finally {
  await kitty.close();
}

const size = await probeSize(output);
console.log(`\nWrote ${output} (${size.width}×${size.height})`);
console.log("Watch it before muxing — kitty's send-key cannot report a dropped keystroke.");
