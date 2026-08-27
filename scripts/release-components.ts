import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Independently versioned and published parts of sentry-tui. */
export type ReleaseComponent = "host" | "app";

interface WorkspaceManifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  sentryTui?: { releaseComponents?: ReleaseComponent[] };
}

interface Workspace {
  dir: string;
  manifest: WorkspaceManifest;
}

const ROOT = join(import.meta.dirname, "..");
const BOTH: readonly ReleaseComponent[] = ["host", "app"];
const NONE: readonly ReleaseComponent[] = [];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Expand the root manifest's direct paths and `dir/*` workspace patterns. */
function workspaceDirectories(): string[] {
  const root = readJson<{ workspaces?: string[] }>(join(ROOT, "package.json"));
  const directories: string[] = [];

  for (const pattern of root.workspaces ?? []) {
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2);
      for (const entry of readdirSync(join(ROOT, parent))) {
        const candidate = join(ROOT, parent, entry);
        if (statSync(candidate).isDirectory()) directories.push(`${parent}/${entry}`);
      }
    } else {
      directories.push(pattern);
    }
  }

  return directories.sort();
}

const WORKSPACES: Workspace[] = workspaceDirectories().map((dir) => ({
  dir,
  manifest: readJson<WorkspaceManifest>(join(ROOT, dir, "package.json")),
}));

function workspaceForPath(path: string): Workspace | undefined {
  return WORKSPACES.find(({ dir }) => path === `${dir}/package.json` || path.startsWith(`${dir}/`));
}

function dependenciesOf(manifest: WorkspaceManifest): Set<string> {
  return new Set(
    Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    }),
  );
}

/**
 * Resolve a workspace's shipped artifacts from package ownership.
 *
 * Product, host, and launcher packages declare their release component in
 * their manifests. A shared package such as runtime-contract deliberately
 * declares none; its release set is derived from every workspace that depends
 * on it, including transitive consumers.
 */
function componentsForWorkspace(workspace: Workspace): ReleaseComponent[] {
  const direct = workspace.manifest.sentryTui?.releaseComponents;
  if (direct) return [...direct];

  const affectedPackages = new Set([workspace.manifest.name]);
  const components = new Set<ReleaseComponent>();
  let foundConsumer = true;

  while (foundConsumer) {
    foundConsumer = false;
    for (const candidate of WORKSPACES) {
      if (affectedPackages.has(candidate.manifest.name)) continue;
      const dependsOnAffected = [...dependenciesOf(candidate.manifest)].some((name) =>
        affectedPackages.has(name),
      );
      if (!dependsOnAffected) continue;
      affectedPackages.add(candidate.manifest.name);
      for (const component of candidate.manifest.sentryTui?.releaseComponents ?? []) {
        components.add(component);
      }
      foundConsumer = true;
    }
  }

  return (["host", "app"] as const).filter((component) => components.has(component));
}

/** Map a changed path to the release artifacts whose shipped bytes it affects. */
export function releaseComponentsForPath(path: string): readonly ReleaseComponent[] {
  if (path.includes(".test.") || path.startsWith("test/")) return NONE;

  const workspace = workspaceForPath(path);
  if (workspace) return componentsForWorkspace(workspace);

  // Files outside a workspace are shared build inputs or repository tooling.
  if (
    path === "package.json" ||
    path === "bun.lock" ||
    path === "LICENSE" ||
    path === "THIRD_PARTY_NOTICES" ||
    path === "README.md" ||
    path === "scripts/build-npm.ts"
  ) {
    return BOTH;
  }
  if (path === "scripts/build-app.ts" || path === "scripts/build-platform-icons.ts") {
    return ["app"];
  }
  if (path === "scripts/build-bin.ts" || path === ".github/scripts/package-release.sh") {
    return ["host"];
  }

  return NONE;
}

/** Unique release components affected by a list of changed paths. */
export function changedReleaseComponents(paths: readonly string[]): ReleaseComponent[] {
  // A workspace dependency edit necessarily rewrites the shared lockfile. In
  // that change set the owning manifest is the more precise source of truth;
  // a lockfile-only change remains conservative and releases both components.
  const workspaceDependencyChanged = paths.some((path) =>
    WORKSPACES.some(({ dir }) => path === `${dir}/package.json`),
  );
  const selected = new Set(
    paths
      .filter((path) => !(path === "bun.lock" && workspaceDependencyChanged))
      .flatMap((path) => releaseComponentsForPath(path)),
  );
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
