/**
 * The in-app half of the self-updater, and the one statement of when we check.
 *
 * `packaging/npm/update.mjs` already knows how to ask the registry what is
 * newest, verify a tarball, and land it in `~/.cache/sentry-tui/versions`.
 * What was missing was a single answer to *when* to run it, since two things
 * can: the npm launcher, and the app the launcher starts.
 *
 * The rule, and the whole of it: **whoever is running decides**. From the
 * moment the app is up it looks for itself — `UPDATE_FIRST_CHECK_MS` after
 * start, then hourly — so a release landing mid-session is offered in that
 * session rather than silently waiting for a relaunch. The launcher checks
 * once its child has exited, and only when that child went before it could
 * have looked: every command that never starts the app (`--help`,
 * `--version`, `login`, `logout`, `status`), a session too short to have
 * checked, and a binary that would not start at all.
 *
 * So a launch costs exactly one check, in one place or the other, never both
 * — and the `mkdir` lock in `update.mjs` is left guarding what it was written
 * for, several terminals launching at once, rather than our own two schedules.
 * The launcher decides that with a clock, not by reading the arguments it was
 * handed, so a command added to the app needs nothing added there.
 *
 * The imports reach outside `src/` on purpose. Those two modules are shipped
 * runtime code, not build scripts, and they are the only definition of the
 * cache layout, the lock, and the platform lookup. Restating any of it here
 * would mean the app and the launcher could disagree about which binary is
 * current, which is the one thing this must never do.
 */
import { platformPackage } from "../../packaging/npm/launch.mjs";
import {
  cachedBinary,
  cachedVersions,
  compareVersions,
  downloadIfNewer,
  updatesDisabled,
} from "../../packaging/npm/update.mjs";
import { replaceProcess } from "~/lib/exec";
import { APP_VERSION } from "~/lib/version";

/** A build on disk, newer than the one running, ready to be restarted into. */
export interface ReadyUpdate {
  version: string;
  /** Absolute path to the cached binary. */
  path: string;
}

/**
 * How long after start the app makes its first real check.
 *
 * Not zero, and not an hour. The first seconds of a launch are the renderer
 * coming up and the issue stream loading, and an update has no deadline, so it
 * waits for that to be over — starting the app never waits on the network.
 * Long before the poll below, though: the common case is a release that landed
 * since the last launch, and nobody should have to sit for an hour to be told.
 */
export const UPDATE_FIRST_CHECK_MS = 10 * 1000;

/** How often the app looks again after that, for as long as it is open. */
export const UPDATE_POLL_MS = 60 * 60 * 1000;

/**
 * Whether an update offered here would survive the next cold start.
 *
 * Restarting execs a binary out of the cache; that only persists because the
 * npm launcher prefers the newest cached build every time it runs. Nothing
 * else does, so a binary downloaded by hand must stay quiet rather than offer
 * an update that reverts the moment the user quits.
 */
export function canSelfUpdate(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SENTRY_TUI_MANAGED !== "1") return false;
  if (updatesDisabled(env)) return false;
  return Boolean(platformPackage());
}

/**
 * The newest cached build that beats the running one, if there is one.
 *
 * Disk only — no network, no waiting. Called on mount so a build the
 * launcher's worker fetched seconds ago is offered immediately.
 */
export function readyUpdate(env: NodeJS.ProcessEnv = process.env): ReadyUpdate | undefined {
  // Sorted newest first, so the head is the only candidate worth comparing.
  const newest = cachedVersions(env)[0];
  if (!newest || compareVersions(newest, APP_VERSION) <= 0) return undefined;
  return { version: newest, path: cachedBinary(newest, env) };
}

/**
 * Look for something newer, download it, and report what is now ready to run.
 *
 * Deliberately returns nothing until the bytes are on disk: the pill this
 * feeds means "press and you are on the new version", not "press and wait on a
 * 24MB download".
 *
 * Never rejects. `update.mjs` fails open by design — offline, rate-limited,
 * corrupt, unwritable cache all leave the current binary alone — and a failed
 * check has no business becoming an error in the status bar.
 */
export async function checkForUpdate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadyUpdate | undefined> {
  const packageName = platformPackage();
  if (!packageName) return undefined;

  try {
    await downloadIfNewer({ packageName, localVersion: APP_VERSION, env });
  } catch {
    // Nothing to say and nowhere to say it. The cache read below still runs:
    // the launcher's worker may have landed a build while this call failed.
  }
  return readyUpdate(env);
}

/** Seams for the tests; the defaults are the cadence the app actually runs. */
export interface UpdateWatchOptions {
  env?: NodeJS.ProcessEnv;
  firstCheckMs?: number;
  pollMs?: number;
  check?: (env?: NodeJS.ProcessEnv) => Promise<ReadyUpdate | undefined>;
}

/**
 * Watch for a newer build for as long as the app is up, and report each answer.
 *
 * The schedule described at the top of this file, in one place: the cache read
 * now, then a real check at `UPDATE_FIRST_CHECK_MS`, then every
 * `UPDATE_POLL_MS`. `onUpdate` is called with `undefined` when a later check
 * finds nothing, so a cached build that gets pruned out from under us stops
 * being offered.
 *
 * @returns a function that stops the watch; safe to call more than once.
 */
export function watchForUpdate(
  onUpdate: (update: ReadyUpdate | undefined) => void,
  {
    env = process.env,
    firstCheckMs = UPDATE_FIRST_CHECK_MS,
    pollMs = UPDATE_POLL_MS,
    check = checkForUpdate,
  }: UpdateWatchOptions = {},
): () => void {
  if (!canSelfUpdate(env)) return () => {};

  // Disk first, and synchronously: reading a directory costs nothing, and the
  // previous session may have left a build sitting there ready to run.
  onUpdate(readyUpdate(env));

  let live = true;
  let poll: ReturnType<typeof setInterval> | undefined;

  const look = () => {
    void check(env).then((found) => {
      // A watch stopped mid-download would otherwise report into a dead tree.
      if (live) onUpdate(found);
    });
  };

  const first = setTimeout(() => {
    look();
    poll = setInterval(look, pollMs);
  }, firstCheckMs);

  return () => {
    live = false;
    clearTimeout(first);
    if (poll) clearInterval(poll);
  };
}

/**
 * Hand the terminal to `path`, and never come back.
 *
 * `execve` first: it keeps this pid, this terminal, and whatever is waiting on
 * this process, so accepting update after update in one session leaves nothing
 * behind. Spawning is the fallback, because a restart that works and stacks a
 * process is better than one that does not happen — but it is the shape that
 * caused #101, so it is second.
 *
 * The caller must have torn the renderer down first, either way: the new image
 * inherits this terminal, and one left in `-echo`/`-icanon` reaches it so.
 *
 * @param replace seam for the test that covers the spawn fallback
 */
export function restartInto(
  path: string,
  argv: readonly string[] = process.argv.slice(2),
  replace: typeof replaceProcess = replaceProcess,
): void {
  // Passing the environment explicitly rather than letting execve inherit it:
  // `process.env` is what the rest of the app reads and writes, and it carries
  // SENTRY_TUI_MANAGED, which is what lets the new build offer the next update
  // in turn.
  replace(path, argv, process.env);

  const result = Bun.spawnSync([path, ...argv], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });

  // Re-raise the child's signal so Ctrl-C looks the same to the shell as it
  // would have without the restart in between.
  if (result.signalCode) {
    process.kill(process.pid, result.signalCode);
    return;
  }
  process.exit(result.exitCode);
}
