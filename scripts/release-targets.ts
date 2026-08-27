/**
 * The platforms a release is built for.
 *
 * This table is the single source of truth for the whole distribution chain:
 * the CI build matrix, the per-platform npm packages, the launcher's lookup
 * table, and the release assets all derive from it.
 * `scripts/packaging.test.ts` fails if any of those drift out of step.
 */

/** npm scope the real packages publish under. */
export const NPM_SCOPE = "@billyvg";

/** Scoped package that carries the launcher and the platform optional deps. */
export const LAUNCHER_PACKAGE = `${NPM_SCOPE}/sentry-tui`;

/** Platform-neutral app payload loaded by the compiled runtime host. */
export const APP_PACKAGE = `${NPM_SCOPE}/sentry-tui-app`;

/** Unscoped alias, so `npx sentry-tui` keeps working. */
export const ALIAS_PACKAGE = "sentry-tui";

/** Owner/repo the release assets are published under. */
export const REPOSITORY = "billyvg/sentry-tui";

/** Binary name inside every package, archive, and install directory. */
export const BINARY_NAME = "sentry-tui";

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
  os: "darwin" | "linux";
  /** `cpu` field of that package, matching `process.arch`. */
  cpu: "x64" | "arm64";
  /** Release asset stem, e.g. `sentry-tui-darwin-arm64`. */
  asset: string;
}

/**
 * x64 targets use Bun's baseline builds on purpose: the default x64 runtime
 * requires AVX2 and dies with SIGILL on pre-Haswell CPUs and on VMs that mask
 * the feature off. A TUI is not throughput-bound, so the tradeoff is free.
 *
 * Windows is deliberately absent: nothing here has been run against a Windows
 * terminal, and shipping a binary nobody has tried is worse than not shipping
 * one. `docs/releasing.md` covers what adding it would take.
 */
export const RELEASE_TARGETS: ReleaseTarget[] = [
  {
    key: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    runner: "macos-latest",
    npmPackage: `${NPM_SCOPE}/sentry-tui-darwin-arm64`,
    os: "darwin",
    cpu: "arm64",
    asset: "sentry-tui-darwin-arm64",
  },
  {
    key: "darwin-x64",
    bunTarget: "bun-darwin-x64-baseline",
    runner: "macos-15-intel",
    npmPackage: `${NPM_SCOPE}/sentry-tui-darwin-x64`,
    os: "darwin",
    cpu: "x64",
    asset: "sentry-tui-darwin-x64",
  },
  {
    key: "linux-x64",
    bunTarget: "bun-linux-x64-baseline",
    runner: "ubuntu-latest",
    npmPackage: `${NPM_SCOPE}/sentry-tui-linux-x64`,
    os: "linux",
    cpu: "x64",
    asset: "sentry-tui-linux-x64",
  },
  {
    key: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    runner: "ubuntu-24.04-arm",
    npmPackage: `${NPM_SCOPE}/sentry-tui-linux-arm64`,
    os: "linux",
    cpu: "arm64",
    asset: "sentry-tui-linux-arm64",
  },
];

/** Look up a target by its `${platform}-${arch}` key, or by its Bun target name. */
export function findTarget(name: string): ReleaseTarget | undefined {
  return RELEASE_TARGETS.find((t) => t.key === name || t.bunTarget === name);
}

/** The target matching the machine this runs on. */
export function hostTarget(): ReleaseTarget | undefined {
  return findTarget(`${process.platform}-${process.arch}`);
}
