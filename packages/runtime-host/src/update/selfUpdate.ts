/**
 * The in-app half of the self-updater, and the one statement of when we check.
 *
 * The launcher's `update.mjs` already knows how to ask the registry what is
 * newest, verify a tarball, and land it in `~/.cache/sentry-tui/versions`.
 * What was missing was a single answer to *when* to run it, since two things
 * can: the npm launcher, and the app the launcher starts.
 *
 * The rule, and the whole of it: **whoever is running decides**. From the
 * moment the app is up it looks for itself — `UPDATE_FIRST_CHECK_MS` after
 * start, then every `UPDATE_POLL_MS` — so a release landing mid-session is
 * offered in that
 * session rather than silently waiting for a relaunch. The launcher checks
 * once its child has exited, and only when that child went before it could
 * have looked: every command that never starts the app (`--help`,
 * `--version`, `login`, `logout`, `status`), a session too short to have
 * checked, and a host that would not start at all.
 *
 * So a launch checks each independent release line in one place or the other,
 * never both — and the `mkdir` lock in `update.mjs` is left guarding what it was written
 * for, several terminals launching at once, rather than our own two schedules.
 * The launcher decides that with a clock, not by reading the arguments it was
 * handed, so a command added to the app needs nothing added there.
 *
 * The imports cross into the launcher workspace on purpose. Those two modules
 * are shipped runtime code, not build scripts, and they are the only definition of the
 * cache layout, the lock, and the platform lookup. Restating any of it here
 * would mean the app and the launcher could disagree about which artifact is
 * current, which is the one thing this must never do.
 */
import { APP_PACKAGE, platformPackage } from "@sentry-tui/launcher/launch.mjs";
import {
  cachedBinary,
  cachedPayload,
  cachedPayloadManifest,
  cachedPayloadVersions,
  cachedVersions,
  compareVersions,
  downloadIfNewer,
  removeCachedArtifact,
  updatesDisabled,
} from "@sentry-tui/launcher/update.mjs";
import { APP_VERSION } from "@sentry-tui/app/version";
import { HOST_API_VERSION } from "@sentry-tui/runtime-contract/runtime";
import { installUpdateService, type ReadyUpdate } from "@sentry-tui/runtime-contract/update";
import {
  countUpdateCheckFailure,
  reportUpdateFailure,
} from "@sentry-tui/runtime-host/update/telemetry";
import { HOST_VERSION } from "@sentry-tui/runtime-host/version";

export type { ReadyUpdate } from "@sentry-tui/runtime-contract/update";

/**
 * How long after start the app makes its first real check.
 *
 * Not zero, and not the poll below. The first seconds of a launch are the
 * renderer
 * coming up and the issue stream loading, and an update has no deadline, so it
 * waits for that to be over — starting the app never waits on the network.
 * Long before the poll, though: the common case is a release that landed since
 * the last launch, and nobody should have to wait a quarter of an hour to be
 * told.
 */
export const UPDATE_FIRST_CHECK_MS = 10 * 1000;

/**
 * How often the app looks again after that, for as long as it is open.
 *
 * Short enough that a session running while releases are going out is offered
 * each of them, long enough that an app left open all day is a handful of
 * registry requests rather than a poller.
 */
export const UPDATE_POLL_MS = 15 * 60 * 1000;

/**
 * Whether an update offered here would survive the next cold start.
 *
 * Applying a payload only persists because the npm launcher prefers the newest
 * cached payload every time it runs. Nothing else does, so a bundle downloaded
 * by hand must stay quiet rather than offer an update that reverts on quit.
 */
export function canSelfUpdate(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SENTRY_TUI_MANAGED !== "1") return false;
  if (updatesDisabled(env)) return false;
  return true;
}

/**
 * The newest cached release that beats the running app, if there is one.
 *
 * Disk only — no network, no waiting. Called on mount so a release the
 * launcher's worker fetched seconds ago is offered immediately.
 */
export function readyUpdate(env: NodeJS.ProcessEnv = process.env): ReadyUpdate | undefined {
  // Prefer a compatible payload: it keeps the process and renderer alive.
  const newestPayload = cachedPayloadVersions(env)[0];
  if (newestPayload && compareVersions(newestPayload, APP_VERSION) > 0) {
    const manifest = cachedPayloadManifest(newestPayload, env);
    if (manifest?.hostApiVersion === HOST_API_VERSION) {
      return { version: newestPayload, kind: "payload", path: cachedPayload(newestPayload, env) };
    }
  }

  // A payload requiring another host API cannot be executed. Once its matching
  // compiled release is cached, use the old process-replacement path.
  const newestHost = cachedVersions(env)[0];
  if (!newestHost || compareVersions(newestHost, HOST_VERSION) <= 0) return undefined;
  return { version: newestHost, kind: "host", path: cachedBinary(newestHost, env) };
}

/**
 * Look for something newer, download it, and report what is now ready to run.
 *
 * Deliberately returns nothing until the bytes are on disk: the pill this
 * feeds means "press and you are on the new version", not "press and wait for
 * a download".
 *
 * Never rejects. `update.mjs` fails open by design — offline, rate-limited,
 * corrupt, unwritable cache all leave the current app alone — and a failed
 * check has no business becoming an error in the status bar.
 */
export async function checkForUpdate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadyUpdate | undefined> {
  if (!canSelfUpdate(env)) return undefined;

  try {
    await downloadIfNewer({
      packageName: env.SENTRY_TUI_APP_PACKAGE || APP_PACKAGE,
      localVersion: cachedPayloadVersions(env)[0] || APP_VERSION,
      artifact: "payload",
      env,
    });
  } catch {
    // The host check is independent. A payload registry failure must not hide
    // a runtime fix, and the cache read below may still have an old answer.
    countUpdateCheckFailure("payload");
  }

  try {
    const hostPackage = platformPackage();
    if (hostPackage) {
      await downloadIfNewer({
        packageName: hostPackage,
        localVersion: cachedVersions(env)[0] || HOST_VERSION,
        artifact: "binary",
        env,
      });
    }
  } catch {
    // Both release lines fail open; the counter is the aggregate signal that
    // tells us if this expected outcome becomes anomalous.
    countUpdateCheckFailure("host");
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
 * Watch for a newer release for as long as the app is up, and report each answer.
 *
 * The schedule described at the top of this file, in one place: the cache read
 * now, then a real check at `UPDATE_FIRST_CHECK_MS`, then every
 * `UPDATE_POLL_MS`. `onUpdate` is called with `undefined` when a later check
 * finds nothing, so a cached release that gets pruned out from under us stops
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
  // previous session may have left a payload sitting there ready to run.
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
 * `execve` keeps this pid, this terminal, and whatever is waiting on
 * this process, so accepting update after update in one session leaves nothing
 * behind.
 *
 * The caller must have torn the renderer down first: the new image inherits
 * this terminal, and one left in `-echo`/`-icanon` reaches it so.
 */
export function restartInto(path: string, argv: readonly string[] = process.argv.slice(2)): void {
  // Passing the environment explicitly rather than letting execve inherit it:
  // `process.env` is what the rest of the app reads and writes, and it carries
  // SENTRY_TUI_MANAGED, which is what lets the new build offer the next update
  // in turn.
  process.execve!(path, [path, ...argv], process.env);
}

/** Remove a payload that failed validation/import, without touching cached hosts. */
export function discardFailedPayload(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const version = cachedPayloadVersions(env).find(
    (candidate) => cachedPayload(candidate, env) === path,
  );
  if (!version) return false;
  try {
    removeCachedArtifact(version, "payload", env);
    return true;
  } catch (error) {
    reportUpdateFailure(error, { kind: "payload", version, stage: "discard" });
    return false;
  }
}

installUpdateService({ watchForUpdate, checkForUpdate });
