/**
 * The in-app half of the self-updater.
 *
 * `packaging/npm/update.mjs` already knows how to ask the registry what is
 * newest, verify a tarball, and land it in `~/.cache/sentry-tui/versions`. The
 * launcher runs that in a detached worker at startup and picks the result up
 * on the *next* launch — which, for anyone who leaves the TUI open all day, is
 * close to never. This is what lets the running app notice and offer to
 * restart into it.
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
import { APP_VERSION } from "~/lib/version";

/** A build on disk, newer than the one running, ready to be restarted into. */
export interface ReadyUpdate {
  version: string;
  /** Absolute path to the cached binary. */
  path: string;
}

/** How often the app looks for something newer while it is open. */
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

/**
 * Hand the terminal to `path` and exit with whatever it exits with.
 *
 * The caller must have torn the renderer down first, or the child inherits a
 * terminal still in `-echo`/`-icanon`.
 *
 * Bun has no `process.execve`, so this nests one process rather than replacing
 * the image — the same shape the launcher already uses to run the binary, and
 * only ever one level deep, since it happens when someone presses Update.
 */
export function restartInto(path: string, argv: readonly string[] = process.argv.slice(2)): void {
  const result = Bun.spawnSync([path, ...argv], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    // Carries SENTRY_TUI_MANAGED through, so the new build can offer the next
    // update in turn.
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
