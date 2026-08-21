/**
 * The platforms a release is built for.
 *
 * This table is the single source of truth for the whole distribution chain:
 * the CI build matrix, the per-platform npm packages, the launcher's lookup
 * table, the release assets, and the Homebrew formula all derive from it.
 * `scripts/packaging.test.ts` fails if any of those drift out of step.
 */

/** npm scope the real packages publish under. */
export const NPM_SCOPE = "@billyvg";

/** Scoped package that carries the launcher and the platform optional deps. */
export const LAUNCHER_PACKAGE = `${NPM_SCOPE}/sentry-tui`;

/** Unscoped alias, so `npx sentry-tui` keeps working. */
export const ALIAS_PACKAGE = "sentry-tui";

/** Owner/repo the release assets and Homebrew formula point at. */
export const REPOSITORY = "billyvg/sentry-tui";

export interface ReleaseTarget {
  /** `${process.platform}-${process.arch}` — what the launcher looks itself up by. */
  key: string;
  /** Value for `bun build --compile --target=`. */
  bunTarget: string;
  /** GitHub Actions runner that builds this target natively. */
  runner: string;
  /** npm package the binary ships in, e.g. `@billyvg/sentry-tui-darwin-arm64`. */
  npmPackage: string;
  /** `os` field of that package, matching `process.platform`. */
  os: "darwin" | "linux" | "win32";
  /** `cpu` field of that package, matching `process.arch`. */
  cpu: "x64" | "arm64";
  /** Binary name inside the package and the archive. */
  exe: string;
  /** Release asset stem, e.g. `sentry-tui-darwin-arm64`. */
  asset: string;
  /** Archive format for the GitHub Release asset. */
  archive: "tar.gz" | "zip";
}

/**
 * x64 targets use Bun's baseline builds on purpose: the default x64 runtime
 * requires AVX2 and dies with SIGILL on pre-Haswell CPUs and on VMs that mask
 * the feature off. A TUI is not throughput-bound, so the tradeoff is free.
 */
export const RELEASE_TARGETS: ReleaseTarget[] = [
  {
    key: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    runner: "macos-latest",
    npmPackage: `${NPM_SCOPE}/sentry-tui-darwin-arm64`,
    os: "darwin",
    cpu: "arm64",
    exe: "sentry-tui",
    asset: "sentry-tui-darwin-arm64",
    archive: "tar.gz",
  },
  {
    key: "darwin-x64",
    bunTarget: "bun-darwin-x64-baseline",
    runner: "macos-15-intel",
    npmPackage: `${NPM_SCOPE}/sentry-tui-darwin-x64`,
    os: "darwin",
    cpu: "x64",
    exe: "sentry-tui",
    asset: "sentry-tui-darwin-x64",
    archive: "tar.gz",
  },
  {
    key: "linux-x64",
    bunTarget: "bun-linux-x64-baseline",
    runner: "ubuntu-latest",
    npmPackage: `${NPM_SCOPE}/sentry-tui-linux-x64`,
    os: "linux",
    cpu: "x64",
    exe: "sentry-tui",
    asset: "sentry-tui-linux-x64",
    archive: "tar.gz",
  },
  {
    key: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    runner: "ubuntu-24.04-arm",
    npmPackage: `${NPM_SCOPE}/sentry-tui-linux-arm64`,
    os: "linux",
    cpu: "arm64",
    exe: "sentry-tui",
    asset: "sentry-tui-linux-arm64",
    archive: "tar.gz",
  },
  {
    key: "win32-x64",
    bunTarget: "bun-windows-x64-baseline",
    runner: "windows-latest",
    npmPackage: `${NPM_SCOPE}/sentry-tui-win32-x64`,
    os: "win32",
    cpu: "x64",
    exe: "sentry-tui.exe",
    asset: "sentry-tui-win32-x64",
    archive: "zip",
  },
];

/** Targets the `install.sh` script can serve — it is POSIX-only by design. */
export const SHELL_INSTALLER_TARGETS = RELEASE_TARGETS.filter((t) => t.os !== "win32");

/** Targets the Homebrew formula covers. */
export const HOMEBREW_TARGETS = SHELL_INSTALLER_TARGETS;

/** Look up a target by its `${platform}-${arch}` key, or by its Bun target name. */
export function findTarget(name: string): ReleaseTarget | undefined {
  return RELEASE_TARGETS.find((t) => t.key === name || t.bunTarget === name);
}

/** The target matching the machine this runs on. */
export function hostTarget(): ReleaseTarget | undefined {
  return findTarget(`${process.platform}-${process.arch}`);
}
