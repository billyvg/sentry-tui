/**
 * Recording the demo window.
 *
 * This uses `screencapture -v -l<windowid>`, which records **one window** rather
 * than a region of the screen. That choice matters more than it looks:
 *
 * The obvious approach — `ffmpeg -f avfoundation` plus a crop rect — records
 * what the compositor draws, so anything overlapping the window ends up in the
 * video. The crop is a fixed rectangle, so an occluded window produces a
 * perfectly framed recording of whatever was on top of it, which looks like a
 * coordinate bug and isn't one. It also needs the window's position, and the
 * obvious way to get *that* (System Events) needs Accessibility permission
 * granted to `osascript` rather than to your terminal, so it fails no matter
 * what you tick in System Settings.
 *
 * Recording the window by id sidesteps all of it: no crop, no coordinate space,
 * no permission beyond Screen Recording, and nothing can obscure the picture.
 */

import { rm } from "node:fs/promises";

/** Video frames per second. */
const FPS = 30;

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

/**
 * Confirm the window can actually be captured, before a whole take depends on it.
 *
 * `screencapture` fails when the display is asleep or the screen is locked, and
 * says nothing at all about why — it just exits 1. Discovering that after
 * driving seventy seconds of tape wastes the take *and* looks like a bug in the
 * harness, so this spends one second finding out first.
 */
export async function assertCapturable(windowId: number): Promise<void> {
  const probe = "/tmp/sentry-tui-capture-probe.mov";
  await rm(probe, { force: true });

  const proc = Bun.spawn(["screencapture", "-x", "-o", "-v", "-V1", `-l${windowId}`, probe], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const detail = (await new Response(proc.stderr).text()).trim();
  await rm(probe, { force: true });

  if (code !== 0) {
    throw new Error(
      `Cannot capture the demo window${detail ? `: ${detail}` : "."}\n\n` +
        `screencapture fails silently when the display is asleep or the screen is\n` +
        `locked — wake the display and try again. If it persists, check that this\n` +
        `terminal has Screen Recording permission in System Settings › Privacy & Security.`,
    );
  }
}

/**
 * A fixed-length recording of a single window.
 *
 * The length has to be declared up front — `screencapture` takes `-V<seconds>`
 * and stops itself. That suits a scripted demo, whose length is known from the
 * tape before a single key is sent.
 */
export class WindowRecording {
  private constructor(private readonly process: Bun.Subprocess) {}

  /**
   * @param windowId CGWindowID, from `KittySession.platformWindowId`.
   * @param seconds Hard limit; the recorder exits on its own at this point.
   */
  static async start(windowId: number, seconds: number, output: string): Promise<WindowRecording> {
    // Clear the destination first. screencapture records the whole take and
    // only *then* tries to save, so anything wrong with the path — a previous
    // capture sitting there, or a player still holding it open — costs you the
    // entire take and reports it as "Failed to save to final location".
    // Unlinking satisfies both: a player keeps its own handle on the old inode.
    await rm(output, { force: true });

    const process = Bun.spawn(
      [
        "screencapture",
        "-x", // no shutter sound
        "-o", // no window shadow, so the frame is exactly the window
        "-v", // video
        `-V${Math.ceil(seconds)}`,
        `-l${windowId}`,
        output,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    return new WindowRecording(process);
  }

  /** Wait for the recorder to reach its limit and finalise the file. */
  async finish(): Promise<void> {
    const stderr = this.process.stderr;
    const code = await this.process.exited;
    if (code !== 0) {
      // Lead with what screencapture said. It reports the actual cause — a
      // destination it can't write, a window that vanished — and burying that
      // under a guess about permissions sends you to System Settings for a
      // problem that was never there.
      const detail = (
        stderr instanceof ReadableStream ? await new Response(stderr).text() : ""
      ).trim();
      throw new Error(
        `${detail || `screencapture exited ${code}`}\n\n` +
          `If it mentions permission, grant Screen Recording to this terminal in ` +
          `System Settings › Privacy & Security.`,
      );
    }
  }
}

export { FPS };
