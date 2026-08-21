// Plain JS on purpose: this file is what an npm consumer runs under Node, so
// it must have no build step, no dependencies, and no TypeScript.
import { spawn, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { bestLocal, updatesDisabled } from "./update.mjs";

/**
 * `${process.platform}-${process.arch}` → the npm package carrying that binary.
 * Generated from `scripts/release-targets.ts`; keep the two in step (there is a
 * test that checks).
 */
export const PLATFORM_PACKAGES = {
  "darwin-arm64": "@billyvg/sentry-tui-darwin-arm64",
  "darwin-x64": "@billyvg/sentry-tui-darwin-x64",
  "linux-x64": "@billyvg/sentry-tui-linux-x64",
  "linux-arm64": "@billyvg/sentry-tui-linux-arm64",
};

const INSTALL_HELP = `Or download the binary for your platform by hand:
  https://github.com/billyvg/sentry-tui/releases`;

/** The platform package this machine needs, or undefined when unsupported. */
export function platformPackage() {
  return PLATFORM_PACKAGES[`${process.platform}-${process.arch}`];
}

/**
 * The version npm installed, from this package's own manifest.
 *
 * Undefined when the manifest cannot be read — running from a checkout, say —
 * which the updater reads as "anything on the registry is newer".
 */
export function bundledVersion() {
  try {
    return createRequire(import.meta.url)("../package.json").version;
  } catch {
    return undefined;
  }
}

/**
 * Absolute path to the compiled binary for this machine.
 *
 * @throws {Error} when the platform is unsupported, or when its package is
 *   absent — which is what `--no-optional`, `--omit=optional`, and a lockfile
 *   copied from another OS all look like from here.
 */
export function resolveBinary() {
  const key = `${process.platform}-${process.arch}`;
  const packageName = PLATFORM_PACKAGES[key];

  if (!packageName) {
    const supported = Object.keys(PLATFORM_PACKAGES).sort().join(", ");
    throw new Error(
      `sentry-tui has no prebuilt binary for ${key}.\nSupported: ${supported}.\n\n` +
        `You can still run it from source with Bun — see ` +
        `https://github.com/billyvg/sentry-tui#from-source`,
    );
  }

  try {
    return createRequire(import.meta.url).resolve(`${packageName}/bin/sentry-tui`);
  } catch (cause) {
    throw new Error(
      `sentry-tui could not find its binary package ${packageName}.\n` +
        `That package is an optional dependency, so this usually means it was skipped — ` +
        `installing with --no-optional or --omit=optional does it, and so does a lockfile ` +
        `built on a different platform.\n\nTry: npm install ${packageName}\n\n${INSTALL_HELP}`,
      { cause },
    );
  }
}

/**
 * Environment for the binary: ours, plus the marker saying we launched it.
 *
 * The app offers an in-app update — a pill in the status bar that restarts
 * into a build already sitting in the cache. That only sticks when something
 * prefers the cache on the next launch, which is this launcher and nothing
 * else. A binary downloaded from the releases page and run directly sees no
 * marker, so it never makes an offer it cannot keep.
 */
function childEnv() {
  return { ...process.env, SENTRY_TUI_MANAGED: "1" };
}

/**
 * Run the compiled binary with this process's arguments, then exit with
 * whatever it exited with.
 *
 * `stdio: "inherit"` hands the real TTY straight to the child, which the TUI
 * needs for raw mode and for the alternate screen; it also puts the child in
 * this process group, so Ctrl-C reaches it directly.
 */
/**
 * Kick off an update in a process of our own, and return immediately.
 *
 * Detached with stdio ignored, so it outlives this launch and cannot write over
 * a TUI that owns the screen. The new build lands in the cache and the next
 * launch runs it — nobody waits on a 24MB download to read `--help`.
 *
 * @returns {boolean} whether a worker was started
 */
export function startBackgroundUpdate({ packageName, localVersion, env = process.env } = {}) {
  if (!packageName || updatesDisabled(env)) return false;

  try {
    const worker = fileURLToPath(new URL("./background-update.mjs", import.meta.url));
    const child = spawn(process.execPath, [worker, packageName, localVersion ?? ""], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    // Whatever went wrong there, the app still starts.
    return false;
  }
}

export function main(argv = process.argv.slice(2)) {
  let bundled;
  try {
    bundled = { version: bundledVersion(), path: resolveBinary() };
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  // Run what is already here: the binary npm installed, or a newer one that an
  // earlier launch fetched. Starting the app never waits on the network.
  const local = bestLocal(bundled);

  // Then look for something newer, in a process of our own. Releases land
  // often, and this is what keeps people current without ever asking them to
  // reinstall. `SENTRY_TUI_NO_UPDATE=1` switches it off.
  startBackgroundUpdate({ packageName: platformPackage(), localVersion: local.version });

  const binary = local.path;
  let result = spawnSync(binary, argv, { stdio: "inherit", env: childEnv() });

  // npm preserves the executable bit, but tarballs unpacked by other tooling
  // sometimes don't. One retry costs nothing and saves a confusing failure.
  // If the chmod itself fails (read-only install, no permission), fall through
  // to the error report below rather than throwing a stack trace at the user.
  if (result.error && result.error.code === "EACCES") {
    try {
      accessSync(binary, constants.X_OK);
    } catch {
      try {
        chmodSync(binary, 0o755);
        result = spawnSync(binary, argv, { stdio: "inherit", env: childEnv() });
      } catch {
        /* keep the original spawn error */
      }
    }
  }

  // A cached build that will not start is worse than the stale one that will,
  // so fall back once to whatever npm installed.
  if (result.error && binary !== bundled.path) {
    process.stderr.write(
      `sentry-tui ${local.version} did not start, falling back to ${bundled.version}\n`,
    );
    result = spawnSync(bundled.path, argv, { stdio: "inherit", env: childEnv() });
  }

  if (result.error) {
    process.stderr.write(`sentry-tui failed to start: ${result.error.message}\n`);
    process.exit(1);
  }

  // Re-raise the child's signal so `Ctrl-C` and friends look the same to the
  // shell as they would if it had run the binary itself.
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  process.exit(result.status ?? 0);
}
