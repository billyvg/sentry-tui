/**
 * Shared paths and the one precondition every stage has in common.
 */

export const DEMO_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const BUILD_DIR = `${DEMO_DIR}/build`;
export const AUDIO_DIR = `${BUILD_DIR}/audio`;
export const DURATIONS_PATH = `${BUILD_DIR}/durations.json`;
/** Beat offsets as they actually happened, written by `demo:record`. */
export const TIMELINE_PATH = `${BUILD_DIR}/timeline.json`;
export const NARRATION_PATH = `${DEMO_DIR}/narration.md`;
export const TAPE_PATH = `${DEMO_DIR}/demo.tape`;

/** Control socket for the kitty window under recording. */
export const SOCKET = "/tmp/sentry-tui-demo.sock";

/**
 * The tape's environment, with the compiled binary's directory on PATH.
 *
 * Derived rather than written into the tape so the file stays portable — and so
 * a demo recorded from a worktree runs *that* worktree's build, not whichever
 * checkout happened to be first on the ambient PATH.
 */
export function shellEnv(tapeEnv: Record<string, string>): Record<string, string> {
  const inherited = process.env["PATH"] ?? "/usr/bin:/bin";
  return { ...tapeEnv, PATH: `${SHIM_DIR}:${inherited}` };
}

/** Directory holding the `sentry-tui` shim, first on the recorded shell's PATH. */
export const SHIM_DIR = `${BUILD_DIR}/bin`;

/**
 * Write a `sentry-tui` that runs the app from source.
 *
 * The tape types `sentry-tui`, which should mean the real command — but the
 * compiled binary can't be used here. `bun build --compile` bundles the code and
 * nothing else, so `src/assets/**` is absent at runtime and every `<image>`
 * resolves to a path that isn't there: no nav icons, no platform icons, no
 * assignee avatars. They fail silently, which is exactly the failure this whole
 * harness exists to avoid.
 *
 * Running from source keeps the assets on disk where the components look for
 * them. The shim is what keeps the typed command honest in the meantime.
 */
export async function writeShim(): Promise<void> {
  const { mkdir, chmod } = await import("node:fs/promises");
  await mkdir(SHIM_DIR, { recursive: true });
  const shim = `${SHIM_DIR}/sentry-tui`;
  await Bun.write(shim, `#!/bin/sh\nexec bun run ${REPO_ROOT}/src/main.tsx "$@"\n`);
  await chmod(shim, 0o755);
}

/**
 * Refuse to record from inside a terminal multiplexer.
 *
 * The launched kitty inherits this environment, and `useImageSupport` disables
 * every icon in the app when it sees `HERDR_ENV`, `TMUX` or `STY` — the exact
 * thing this harness exists to avoid. Failing loudly here beats discovering a
 * text-only nav rail after a five-minute take.
 */
export function assertNotMultiplexed(): void {
  const found = ["HERDR_ENV", "TMUX", "STY"].filter((name) => process.env[name]);
  if (found.length === 0) return;
  throw new Error(
    `${found.join(", ")} set in this environment.\n\n` +
      `The recorded kitty window inherits it, and the app turns off every icon —\n` +
      `nav rail, org avatar, platform icons, assignee avatars — inside a multiplexer.\n` +
      `Run this from a plain terminal window instead.`,
  );
}
