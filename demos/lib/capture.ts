/**
 * Screen capture and geometry, via ffmpeg's avfoundation input.
 *
 * Two things here are measured rather than assumed, because both are per-machine
 * and getting either wrong wastes a whole take: which avfoundation index is the
 * screen, and how many captured pixels there are per point of window geometry.
 */

import { file, write } from "bun";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Geometry {
  /** avfoundation device index for the display being recorded. */
  screenIndex: number;
  /** Full capture size in pixels, as ffmpeg produces it. */
  capture: { width: number; height: number };
  /**
   * Rect to crop to, in captured pixels. Absent means "keep the whole frame",
   * which is what the fullscreen fallback uses.
   */
  crop?: CropRect;
}

export const GEOMETRY_PATH = new URL("../geometry.json", import.meta.url).pathname;

/**
 * Find the avfoundation index of a screen capture device.
 *
 * The index is not stable across machines — cameras are enumerated first, so a
 * laptop with a webcam and a connected phone pushes the display to 4. Listing
 * always exits non-zero (there is no input to open), so the device table is read
 * off stderr regardless of exit code.
 */
export async function detectScreenIndex(): Promise<number> {
  const proc = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { stdout: "ignore", stderr: "pipe" },
  );
  const listing = await new Response(proc.stderr).text();
  await proc.exited;

  const match = /\[(\d+)\]\s+Capture screen 0/.exec(listing);
  if (!match) {
    throw new Error(
      `No "Capture screen" device in ffmpeg's avfoundation list. Is Screen Recording ` +
        `permission granted to this terminal in System Settings › Privacy & Security?\n\n${listing}`,
    );
  }
  return Number(match[1]);
}

/**
 * Bounds of the demo window in screen points, via System Events.
 *
 * Needs Accessibility permission. Returns null when that is refused, which is
 * the signal to fall back to recording the whole screen.
 */
export async function windowBounds(): Promise<CropRect | null> {
  const script = `
    tell application "System Events"
      tell process "kitty"
        set win to first window whose title contains "sentry-tui demo"
        set {x, y} to position of win
        set {w, h} to size of win
        return (x as text) & "," & (y as text) & "," & (w as text) & "," & (h as text)
      end tell
    end tell`;

  const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0 || !out) return null;

  const [x, y, width, height] = out.split(",").map((n) => Number(n.trim()));
  if ([x, y, width, height].some((n) => n === undefined || Number.isNaN(n))) return null;
  return { x: x!, y: y!, width: width!, height: height! };
}

/** Screen size in points, so the capture's pixel-per-point scale can be derived. */
export async function screenPoints(): Promise<{ width: number; height: number } | null> {
  const script = `tell application "Finder" to get bounds of window of desktop`;
  const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0 || !out) return null;

  const parts = out.split(",").map((n) => Number(n.trim()));
  if (parts.length < 4 || parts.some(Number.isNaN)) return null;
  return { width: parts[2]!, height: parts[3]! };
}

/** Capture a single frame, so geometry can be measured off a real image. */
export async function captureFrame(screenIndex: number, destination: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "avfoundation",
      "-capture_cursor",
      "0",
      // Input pixel format, and it has to come before -i: avfoundation reads a
      // global -pix_fmt as a request to the device and fails on yuv420p.
      "-pix_fmt",
      "uyvy422",
      "-framerate",
      "30",
      "-i",
      String(screenIndex),
      "-frames:v",
      "1",
      "-y",
      destination,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) {
    throw new Error(`ffmpeg could not capture a frame: ${await new Response(proc.stderr).text()}`);
  }
}

/** Pixel dimensions of a media file. */
export async function probeSize(path: string): Promise<{ width: number; height: number }> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const [width, height] = (await new Response(proc.stdout).text()).trim().split(",").map(Number);
  await proc.exited;
  if (!width || !height) throw new Error(`Could not probe dimensions of ${path}`);
  return { width, height };
}

/** Duration of a media file in seconds. */
export async function probeDuration(path: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { stdout: "pipe", stderr: "ignore" },
  );
  const seconds = Number((await new Response(proc.stdout).text()).trim());
  await proc.exited;
  if (Number.isNaN(seconds)) throw new Error(`Could not probe duration of ${path}`);
  return seconds;
}

/**
 * A long-running screen capture.
 *
 * Stopping writes `q` to ffmpeg's stdin rather than signalling it: ffmpeg has to
 * finalise the container, and a killed process leaves an mp4 with no moov atom,
 * which is to say no video at all.
 */
export class ScreenRecording {
  private constructor(private readonly process: Bun.Subprocess<"pipe">) {}

  static start(geometry: Geometry, output: string, fps = 30): ScreenRecording {
    const filters = geometry.crop
      ? [
          "-vf",
          `crop=${geometry.crop.width}:${geometry.crop.height}:${geometry.crop.x}:${geometry.crop.y}`,
        ]
      : [];

    const process = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-capture_cursor",
        "0",
        "-pix_fmt",
        "uyvy422",
        "-framerate",
        String(fps),
        "-i",
        String(geometry.screenIndex),
        ...filters,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-y",
        output,
      ],
      { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
    );

    return new ScreenRecording(process);
  }

  async stop(): Promise<void> {
    this.process.stdin.write("q");
    await this.process.stdin.end();
    await this.process.exited;
  }
}

export async function readGeometry(): Promise<Geometry> {
  const handle = file(GEOMETRY_PATH);
  if (!(await handle.exists())) {
    throw new Error("No geometry.json — run `bun run demo:calibrate` first.");
  }
  return (await handle.json()) as Geometry;
}

export async function writeGeometry(geometry: Geometry): Promise<void> {
  await write(GEOMETRY_PATH, `${JSON.stringify(geometry, null, 2)}\n`);
}
