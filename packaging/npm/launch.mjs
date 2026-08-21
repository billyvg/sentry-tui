// Plain JS on purpose: this file is what an npm consumer runs under Node, so
// it must have no build step, no dependencies, and no TypeScript.
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants } from "node:fs";
import { createRequire } from "node:module";

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

const INSTALL_HELP = `Or install it another way:
  brew install billyvg/tap/sentry-tui
  curl -fsSL https://raw.githubusercontent.com/billyvg/sentry-tui/main/install.sh | bash
  https://github.com/billyvg/sentry-tui/releases  (binaries, one per platform)`;

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
 * Run the compiled binary with this process's arguments, then exit with
 * whatever it exited with.
 *
 * `stdio: "inherit"` hands the real TTY straight to the child, which the TUI
 * needs for raw mode and for the alternate screen; it also puts the child in
 * this process group, so Ctrl-C reaches it directly.
 */
export function main(argv = process.argv.slice(2)) {
  let binary;
  try {
    binary = resolveBinary();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  let result = spawnSync(binary, argv, { stdio: "inherit" });

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
        result = spawnSync(binary, argv, { stdio: "inherit" });
      } catch {
        /* keep the original spawn error */
      }
    }
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
