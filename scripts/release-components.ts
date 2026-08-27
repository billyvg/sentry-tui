/** Independently versioned and published parts of sentry-tui. */
export type ReleaseComponent = "host" | "app";

const BOTH: readonly ReleaseComponent[] = ["host", "app"];
const HOST: readonly ReleaseComponent[] = ["host"];
const APP: readonly ReleaseComponent[] = ["app"];
const NONE: readonly ReleaseComponent[] = [];

/**
 * Map a changed repository path to the release artifacts whose shipped bytes
 * can change because of it.
 *
 * Most product source belongs to the replaceable payload. The short host list
 * is deliberately explicit so adding an ordinary screen does not rebuild four
 * native binaries. Shared module identity and dependency changes are
 * conservative: getting those wrong can make a payload impossible to load, so
 * they advance both release lines.
 */
export function releaseComponentsForPath(path: string): readonly ReleaseComponent[] {
  if (path.includes(".test.") || path.startsWith("test/")) return NONE;

  if (
    path === "package.json" ||
    path === "bun.lock" ||
    path === "LICENSE" ||
    path === "THIRD_PARTY_NOTICES" ||
    path === "src/app/runtimeContract.ts" ||
    path === "src/app/selfUpdate.ts" ||
    path === "src/core/theme.ts" ||
    path === "src/ui/theme.tsx" ||
    path === "src/ui/runtime/payloadEntry.tsx" ||
    path === "packaging/npm/update.mjs" ||
    path === "scripts/build-npm.ts"
  ) {
    return BOTH;
  }

  if (
    path === "src/compiled.ts" ||
    path === "src/main.tsx" ||
    path === "src/app/login.ts" ||
    path === "src/app/startup.ts" ||
    path === "src/lib/version.ts" ||
    path === "src/api/config.ts" ||
    path === "src/ui/runApp.tsx" ||
    path.startsWith("src/telemetry/") ||
    path === "src/ui/components/ErrorBoundary.tsx" ||
    (path.startsWith("src/ui/runtime/") && !path.endsWith("payloadEntry.tsx")) ||
    path.startsWith("src/assets/openTuiRuntime") ||
    path.startsWith("src/assets/syntaxProbe") ||
    path.startsWith("packaging/npm/") ||
    path === "scripts/build-bin.ts" ||
    path === ".github/scripts/package-release.sh" ||
    path === "README.md"
  ) {
    return HOST;
  }

  if (path.startsWith("src/") || path.startsWith("scripts/build-app.ts")) {
    return APP;
  }

  return NONE;
}

/** Unique release components affected by a list of changed paths. */
export function changedReleaseComponents(paths: readonly string[]): ReleaseComponent[] {
  const selected = new Set(paths.flatMap((path) => releaseComponentsForPath(path)));
  return (["host", "app"] as const).filter((component) => selected.has(component));
}

/** npm packages published for one release component, in dependency order. */
export function packagesForComponents(
  components: readonly ReleaseComponent[],
  packages: {
    hosts: readonly string[];
    app: string;
    launcher: string;
    alias: string;
  },
): Array<{ name: string; component: ReleaseComponent }> {
  const selected = new Set(components);
  return [
    ...(selected.has("host")
      ? packages.hosts.map((name) => ({ name, component: "host" as const }))
      : []),
    ...(selected.has("app") ? [{ name: packages.app, component: "app" as const }] : []),
    ...(selected.has("host")
      ? [
          { name: packages.launcher, component: "host" as const },
          { name: packages.alias, component: "host" as const },
        ]
      : []),
  ];
}
