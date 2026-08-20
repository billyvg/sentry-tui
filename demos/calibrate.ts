#!/usr/bin/env bun
/**
 * `bun run demo:calibrate` — work out what to record, and where.
 *
 * Opens the demo window exactly as `record.ts` will, measures it against a real
 * captured frame, and writes `geometry.json`. Everything here is measured rather
 * than assumed: the avfoundation device index differs per machine, and the
 * pixels-per-point scale differs per display.
 *
 * If Accessibility permission is refused, System Events can't report the window
 * bounds — so it falls back to recording the whole screen rather than failing.
 * A full-screen demo is worse framing, not a broken pipeline.
 */

import { file, write } from "bun";
import { mkdir, rm } from "node:fs/promises";

import {
  captureFrame,
  detectScreenIndex,
  probeSize,
  screenPoints,
  windowBounds,
  writeGeometry,
  type Geometry,
} from "./lib/capture.ts";
import { KittySession } from "./lib/kitty.ts";
import { parseTape } from "./lib/tape.ts";
import {
  assertNotMultiplexed,
  BUILD_DIR,
  DEMO_DIR,
  REPO_ROOT,
  shellEnv,
  writeShim,
  SOCKET,
} from "./lib/paths.ts";

/** Let the window finish opening and settle before it is measured. */
const SETTLE_MS = 1200;

assertNotMultiplexed();

const tape = parseTape(await file(`${DEMO_DIR}/demo.tape`).text());
await mkdir(BUILD_DIR, { recursive: true });

console.log("Looking for a screen capture device…");
const screenIndex = await detectScreenIndex();
console.log(`  avfoundation index ${screenIndex}`);

console.log("Opening the demo window…");
await writeShim();

const kitty = await KittySession.launch({
  socket: SOCKET,
  columns: tape.settings.columns,
  rows: tape.settings.rows,
  fontSize: tape.settings.fontSize,
  cwd: REPO_ROOT,
  env: shellEnv(tape.env),
});

let geometry: Geometry;
try {
  await Bun.sleep(SETTLE_MS);

  const framePath = `${BUILD_DIR}/calibration.png`;
  await captureFrame(screenIndex, framePath);
  const capture = await probeSize(framePath);
  console.log(`  capture is ${capture.width}×${capture.height} px`);

  const bounds = await windowBounds();
  const points = await screenPoints();

  if (bounds && points) {
    // One scale factor for both axes: a display's pixels are square, and
    // deriving each axis separately would bake any rounding in the reported
    // desktop bounds into a stretched crop.
    const scale = capture.width / points.width;
    const crop = {
      x: Math.round(bounds.x * scale),
      y: Math.round(bounds.y * scale),
      // Even dimensions: yuv420p subsamples chroma 2×2 and rejects odd sizes.
      width: Math.round((bounds.width * scale) / 2) * 2,
      height: Math.round((bounds.height * scale) / 2) * 2,
    };
    geometry = { screenIndex, capture, crop };
    console.log(
      `  window at ${bounds.x},${bounds.y} ${bounds.width}×${bounds.height} pt ` +
        `(scale ${scale.toFixed(2)}×)`,
    );
    console.log(`  crop ${crop.width}×${crop.height} at ${crop.x},${crop.y} px`);
  } else {
    geometry = { screenIndex, capture };
    console.log("  could not read the window bounds — recording the full screen instead.");
    console.log(
      "  To frame just the window, grant Accessibility permission to your terminal in\n" +
        "  System Settings › Privacy & Security › Accessibility, then run this again.",
    );
  }

  await rm(framePath, { force: true });
} finally {
  await kitty.close();
}

await writeGeometry(geometry);
await write(`${BUILD_DIR}/.gitkeep`, "");
console.log(`\nWrote ${DEMO_DIR}/geometry.json`);
