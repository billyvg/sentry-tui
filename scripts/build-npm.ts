#!/usr/bin/env bun
/**
 * Assemble the publishable npm package trees under `dist/npm/`.
 *
 * Three kinds of package come out of this:
 *
 *   @billyvg/sentry-tui-<platform>  one compiled binary each, `os`/`cpu` gated
 *   @billyvg/sentry-tui             the launcher; optionally depends on all of them
 *   sentry-tui                      unscoped alias, so `npx sentry-tui` works
 *
 * npm installs only the platform package matching the machine, so a consumer
 * downloads one binary rather than five. The repo's own `package.json` stays
 * `private` and is never published — everything published is generated here,
 * which keeps devDependencies, hooks, and source layout out of the tarballs.
 *
 * Usage:
 *   bun run ./scripts/build-npm.ts               # whatever binaries exist
 *   bun run ./scripts/build-npm.ts --strict      # every target must be present
 */
import { chmodSync, existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALIAS_PACKAGE,
  LAUNCHER_PACKAGE,
  RELEASE_TARGETS,
  REPOSITORY,
  type ReleaseTarget,
} from "./release-targets.ts";

const ROOT = join(import.meta.dirname, "..");
/** Where `build-bin.ts` output lands, one directory per target key. */
const BIN_DIR = join(ROOT, "dist", "bin");
/** Where the assembled package trees go, one directory per package. */
const OUT_DIR = join(ROOT, "dist", "npm");

const DESCRIPTION = "sentry.io in your terminal — a TUI client for Sentry";
const KEYWORDS = ["sentry", "tui", "terminal", "cli", "errors", "observability", "opentui"];
const LICENSE = "MIT";
const AUTHOR = "Billy Vong";

const COMMON = {
  description: DESCRIPTION,
  license: LICENSE,
  author: AUTHOR,
  homepage: `https://github.com/${REPOSITORY}#readme`,
  repository: { type: "git", url: `git+https://github.com/${REPOSITORY}.git` },
  bugs: { url: `https://github.com/${REPOSITORY}/issues` },
};

/** Manifest for a package that carries one platform's compiled binary. */
export function platformManifest(target: ReleaseTarget, version: string) {
  return {
    ...COMMON,
    name: target.npmPackage,
    version,
    description: `${DESCRIPTION} (${target.key} binary)`,
    os: [target.os],
    cpu: [target.cpu],
    files: ["bin"],
    // Yarn PnP cannot execute a binary from inside a zip.
    preferUnplugged: true,
  };
}

/** Manifest for the scoped package users actually depend on. */
export function launcherManifest(version: string) {
  return {
    ...COMMON,
    name: LAUNCHER_PACKAGE,
    version,
    keywords: KEYWORDS,
    type: "module",
    bin: { "sentry-tui": "bin/sentry-tui.mjs" },
    exports: {
      ".": "./lib/launch.mjs",
      "./launch": "./lib/launch.mjs",
      "./package.json": "./package.json",
    },
    files: ["bin", "lib", "README.md", "LICENSE"],
    engines: { node: ">=18.0.0" },
    // Optional so that an unsupported platform still installs — the launcher
    // then prints how to get a binary instead of npm failing the install.
    optionalDependencies: Object.fromEntries(
      RELEASE_TARGETS.map((target) => [target.npmPackage, version]),
    ),
  };
}

/** Manifest for the unscoped alias that forwards to the launcher. */
export function aliasManifest(version: string) {
  return {
    ...COMMON,
    name: ALIAS_PACKAGE,
    version,
    keywords: KEYWORDS,
    type: "module",
    bin: { "sentry-tui": "bin/sentry-tui.mjs" },
    files: ["bin", "README.md", "LICENSE"],
    engines: { node: ">=18.0.0" },
    dependencies: { [LAUNCHER_PACKAGE]: version },
  };
}

/** Package directory name, with the scope flattened so it stays one level deep. */
export function packageDirName(packageName: string): string {
  return packageName.replace("@", "").replace("/", "-");
}

async function writeManifest(dir: string, manifest: object): Promise<void> {
  await writeFile(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");
  const { version } = (await Bun.file(join(ROOT, "package.json")).json()) as { version?: string };

  if (!version) {
    console.error("package.json has no version — set one before building release packages.");
    process.exit(1);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const built: ReleaseTarget[] = [];
  const missing: ReleaseTarget[] = [];

  for (const target of RELEASE_TARGETS) {
    const binary = join(BIN_DIR, target.key, target.exe);
    if (!existsSync(binary)) {
      missing.push(target);
      continue;
    }

    const dir = join(OUT_DIR, packageDirName(target.npmPackage));
    await mkdir(join(dir, "bin"), { recursive: true });
    await cp(binary, join(dir, "bin", target.exe));
    chmodSync(join(dir, "bin", target.exe), 0o755);
    await writeManifest(dir, platformManifest(target, version));
    await writeFile(
      join(dir, "README.md"),
      `# ${target.npmPackage}\n\nThe ${target.key} binary for [sentry-tui](https://github.com/${REPOSITORY}).\n` +
        `Installed automatically as an optional dependency of \`${LAUNCHER_PACKAGE}\`; ` +
        `there is no reason to depend on it directly.\n`,
    );
    built.push(target);
  }

  if (missing.length > 0) {
    const names = missing.map((t) => t.key).join(", ");
    if (strict) {
      console.error(`Missing binaries for: ${names}`);
      console.error(`Expected each at dist/bin/<target>/<exe>.`);
      process.exit(1);
    }
    console.warn(`⚠ Skipping platforms with no binary: ${names}`);
  }

  // Launcher package.
  const launcherDir = join(OUT_DIR, packageDirName(LAUNCHER_PACKAGE));
  await mkdir(join(launcherDir, "bin"), { recursive: true });
  await mkdir(join(launcherDir, "lib"), { recursive: true });
  await cp(join(ROOT, "packaging/npm/launch.mjs"), join(launcherDir, "lib/launch.mjs"));
  await cp(join(ROOT, "packaging/npm/bin-launcher.mjs"), join(launcherDir, "bin/sentry-tui.mjs"));
  chmodSync(join(launcherDir, "bin/sentry-tui.mjs"), 0o755);
  await cp(join(ROOT, "README.md"), join(launcherDir, "README.md"));
  await cp(join(ROOT, "LICENSE"), join(launcherDir, "LICENSE"));
  await writeManifest(launcherDir, launcherManifest(version));

  // Unscoped alias.
  const aliasDir = join(OUT_DIR, packageDirName(ALIAS_PACKAGE));
  await mkdir(join(aliasDir, "bin"), { recursive: true });
  await cp(join(ROOT, "packaging/npm/bin-alias.mjs"), join(aliasDir, "bin/sentry-tui.mjs"));
  chmodSync(join(aliasDir, "bin/sentry-tui.mjs"), 0o755);
  await cp(join(ROOT, "README.md"), join(aliasDir, "README.md"));
  await cp(join(ROOT, "LICENSE"), join(aliasDir, "LICENSE"));
  await writeManifest(aliasDir, aliasManifest(version));

  console.log(`Assembled npm packages in dist/npm (version ${version}):`);
  for (const target of built) console.log(`  ${target.npmPackage}`);
  console.log(`  ${LAUNCHER_PACKAGE}`);
  console.log(`  ${ALIAS_PACKAGE}`);
}

if (import.meta.main) {
  await main();
}
