#!/usr/bin/env bun
/**
 * `bun run demo:record` — replay the tape into a real Kitty window and capture it.
 *
 * The output has no audio: `demo:mux` lays the narration on afterwards, using
 * the same timeline walk this script sleeps by, so picture and voice line up by
 * construction rather than by nudging.
 */

import { file, write } from "bun";
import { mkdir } from "node:fs/promises";

import { assertCapturable, probeSize, WindowRecording } from "./lib/capture.ts";
import { KittySession } from "./lib/kitty.ts";
import {
  assertNotMultiplexed,
  BUILD_DIR,
  DURATIONS_PATH,
  REPO_ROOT,
  shellEnv,
  SOCKET,
  TAPE_PATH,
  TIMELINE_PATH,
  writeShim,
} from "./lib/paths.ts";
import { parseTape, timeline, type TapeStep } from "./lib/tape.ts";

/** Give the window time to open and the shell to draw its prompt. */
const WARMUP_MS = 1500;
/** Let the recorder get going before the first keystroke lands. */
const LEAD_IN_MS = 800;
/** How long the screen must hold still before `Settle` calls it done. */
const SETTLE_STABLE_MS = 1500;
const SETTLE_POLL_MS = 400;
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

  // Fail in a second rather than after the whole tape has played to a
  // recorder that was never going to write anything.
  await assertCapturable(windowId);

  // One window, by id — nothing on top of it can get into the picture, and
  // there is no rectangle to get wrong.
  recording = await WindowRecording.start(windowId, captureSeconds, output);
  await Bun.sleep(LEAD_IN_MS);

  /** Wall-clock ms since the capture started. */
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  /** Where each beat's audio actually begins, for `demo:mux`. */
  const beatOffsets: Array<{ id: string; atMs: number }> = [];

  /** Perform one step. Sleeps are the caller's business. */
  const perform = async (step: TapeStep) => {
    if (step.kind === "type") await kitty.type(step.text);
    else if (step.kind === "key") await kitty.key(step.chord, step.count);
  };

  /**
   * Wait until the screen has been unchanged for a moment, or `maxMs` passes.
   *
   * Polling `get-text` is enough: a streaming answer keeps redrawing, and the
   * redraws stopping is the only signal that doesn't depend on knowing which
   * app is on screen or which string it prints when it's done.
   */
  const settle = async (maxMs: number) => {
    const deadline = Date.now() + maxMs;
    let previous = "";
    let stableSince = 0;
    while (Date.now() < deadline) {
      const screen = await kitty.screenText();
      if (screen === previous) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= SETTLE_STABLE_MS) return;
      } else {
        previous = screen;
        stableSince = 0;
      }
      await Bun.sleep(SETTLE_POLL_MS);
    }
  };

  for (const { step, holdMs } of plan) {
    if (step.kind === "settle") {
      const before = elapsed();
      await settle(step.maxMs);
      console.log(`  settled after ${((elapsed() - before) / 1000).toFixed(1)}s`);
      continue;
    }

    if (step.kind === "meanwhile") {
      // The beat's audio starts now and the block's steps run underneath it, so
      // the screen keeps moving while the line plays.
      console.log(`  @${step.beat} — ${(holdMs / 1000).toFixed(1)}s (with action)`);
      beatOffsets.push({ id: step.beat, atMs: elapsed() });
      const started = Date.now();
      for (const inner of step.steps) {
        await perform(inner);
        if (inner.kind === "sleep") await Bun.sleep(inner.ms);
        // A settle inside a block lets the beat's narration play over the wait
        // instead of leaving a silent hold before it.
        if (inner.kind === "settle") await settle(inner.maxMs);
      }
      // Hold whatever is left of the line after the actions have finished.
      const remaining = holdMs - (Date.now() - started);
      if (remaining > 0) await Bun.sleep(remaining);
      continue;
    }

    await perform(step);
    if (step.kind === "wait") {
      console.log(`  @${step.beat} — ${(holdMs / 1000).toFixed(1)}s`);
      beatOffsets.push({ id: step.beat, atMs: elapsed() });
    }
    if (holdMs > 0) await Bun.sleep(holdMs);
  }

  await recording.finish();

  // The offsets that actually happened, not the ones the plan predicted. A
  // `Settle` runs for however long it runs, and every kitty round-trip adds a
  // little, so re-deriving these in `mux` would drift the audio late.
  await write(TIMELINE_PATH, `${JSON.stringify({ beats: beatOffsets }, null, 2)}\n`);
} finally {
  await kitty.close();
}

const size = await probeSize(output);
console.log(`\nWrote ${output} (${size.width}×${size.height})`);
console.log("Watch it before muxing — kitty's send-key cannot report a dropped keystroke.");
