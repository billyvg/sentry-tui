/**
 * Guards the distribution chain against drift.
 *
 * The platform list lives in `release-targets.ts`, but four other files repeat
 * it in their own syntax: the launcher's lookup table (plain JS, shipped to
 * npm), the release workflow's build matrix (YAML), the installer (bash), and
 * the Homebrew formula (Ruby). Nothing but these tests connects them, so a
 * target added in one place and forgotten elsewhere fails here rather than in
 * a release.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { aliasManifest, launcherManifest, packageDirName, platformManifest } from "./build-npm.ts";
import { parseChecksums, renderFormula } from "./build-formula.ts";
import { COMMANDS } from "./release.ts";
import {
  ALIAS_PACKAGE,
  ARCHIVE_EXT,
  LAUNCHER_PACKAGE,
  RELEASE_TARGETS,
} from "./release-targets.ts";

const ROOT = join(import.meta.dirname, "..");

const read = (path: string) => Bun.file(join(ROOT, path)).text();

describe("release targets", () => {
  test("keys are unique and match their os/cpu", () => {
    const keys = RELEASE_TARGETS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const target of RELEASE_TARGETS) {
      expect(target.key).toBe(`${target.os}-${target.cpu}`);
      expect(target.asset).toBe(`sentry-tui-${target.key}`);
      expect(target.npmPackage).toBe(`@billyvg/sentry-tui-${target.key}`);
    }
  });

  test("x64 targets use Bun's baseline runtime", () => {
    for (const target of RELEASE_TARGETS.filter((t) => t.cpu === "x64")) {
      expect(target.bunTarget).toEndWith("-baseline");
    }
  });
});

describe("npm launcher", () => {
  test("its platform table matches the release targets", async () => {
    const source = await read("packaging/npm/launch.mjs");

    for (const target of RELEASE_TARGETS) {
      expect(source).toContain(`"${target.key}": "${target.npmPackage}"`);
    }

    // And nothing extra: every mapping in the file is a known target.
    const mapped = [...source.matchAll(/"([a-z0-9]+-[a-z0-9]+)": "@billyvg\/sentry-tui-/g)].map(
      (match) => match[1],
    );
    expect(mapped.sort()).toEqual(RELEASE_TARGETS.map((t) => t.key).sort());
  });

  test("the updater ships alongside the launcher", async () => {
    // The launcher imports it at runtime, so leaving it out of the package
    // would break every npm install while every test here still passed.
    const buildScript = await read("scripts/build-npm.ts");
    expect(buildScript).toContain('join(launcherDir, "lib/update.mjs")');
    // The worker is spawned by path at runtime, so a missing copy would only
    // show up as updates silently never happening.
    expect(buildScript).toContain('join(launcherDir, "lib/background-update.mjs")');
    expect(launcherManifest("1.2.3").files).toContain("lib");
  });

  test("the bin entries point at the launcher module", async () => {
    expect(await read("packaging/npm/bin-launcher.mjs")).toContain("../lib/launch.mjs");
    expect(await read("packaging/npm/bin-alias.mjs")).toContain(`${LAUNCHER_PACKAGE}/launch`);
  });
});

describe("generated manifests", () => {
  const version = "1.2.3";

  test("the launcher depends on every platform package at an exact version", () => {
    const manifest = launcherManifest(version);
    const optional = manifest.optionalDependencies as Record<string, string>;

    expect(Object.keys(optional).sort()).toEqual(RELEASE_TARGETS.map((t) => t.npmPackage).sort());
    for (const pinned of Object.values(optional)) expect(pinned).toBe(version);
    expect(manifest.name).toBe(LAUNCHER_PACKAGE);
    expect(manifest.bin["sentry-tui"]).toBe("bin/sentry-tui.mjs");
  });

  test("the alias forwards to the launcher at the same version", () => {
    const manifest = aliasManifest(version);
    expect(manifest.name).toBe(ALIAS_PACKAGE);
    expect(manifest.dependencies[LAUNCHER_PACKAGE]).toBe(version);
    expect(manifest.bin["sentry-tui"]).toBe("bin/sentry-tui.mjs");
  });

  test("platform packages are os/cpu gated and carry no bin field", () => {
    for (const target of RELEASE_TARGETS) {
      const manifest = platformManifest(target, version) as Record<string, unknown>;
      expect(manifest.os).toEqual([target.os]);
      expect(manifest.cpu).toEqual([target.cpu]);
      // A `bin` here would fight the launcher's own `sentry-tui` command.
      expect(manifest.bin).toBeUndefined();
      expect(manifest.files).toEqual(["bin"]);
    }
  });

  test("package directories stay one level deep", () => {
    expect(packageDirName(LAUNCHER_PACKAGE)).toBe("billyvg-sentry-tui");
    expect(packageDirName(ALIAS_PACKAGE)).toBe("sentry-tui");
    for (const target of RELEASE_TARGETS) {
      expect(packageDirName(target.npmPackage)).not.toContain("/");
    }
  });
});

describe("release workflow", () => {
  test("its build matrix lists exactly the release targets", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const listed = [...workflow.matchAll(/^ {10}- target: (\S+)$/gm)].map((match) => match[1]);

    expect(listed.sort()).toEqual(RELEASE_TARGETS.map((t) => t.key).sort());
  });

  test("each matrix entry names the right runner and executable", async () => {
    const workflow = await read(".github/workflows/release.yml");

    for (const target of RELEASE_TARGETS) {
      const entry = new RegExp(`- target: ${target.key}\\n\\s+runner: ${target.runner}`);
      expect(workflow).toMatch(entry);
    }
  });

  test("nothing is built or published until the suite passes", async () => {
    const workflow = await read(".github/workflows/release.yml");

    // A hand-pushed tag never goes past `main`'s CI, so the release workflow
    // has to run the suite itself rather than assume someone else did.
    expect(workflow).toContain("run: bun run check");
    expect(workflow).toMatch(/build:\n\s+name: Build[^\n]*\n\s+needs: \[verify, test\]/);
    expect(workflow).toMatch(/needs: \[verify, test, build\]/);
  });

  test("publishing is skipped on a dry run", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const publishSteps = workflow
      .split("      - name: ")
      .filter((step) => /run: .*(publish-npm|gh release create|update-homebrew-tap)/s.test(step));

    expect(publishSteps.length).toBe(3);
    for (const step of publishSteps) expect(step).toContain("env.DRY_RUN != 'true'");
  });
});

describe("install.sh", () => {
  test("it can name every POSIX target it claims to serve", async () => {
    const script = await read("install.sh");

    for (const target of RELEASE_TARGETS) {
      // The script builds the asset name from `${os}-${arch}`, so check the
      // halves it maps `uname` output onto.
      expect(script).toContain(`os="${target.os}"`);
      expect(script).toContain(`arch="${target.cpu}"`);
    }

    expect(script).toContain("sentry-tui-${target}.tar.gz");
    expect(script).toContain("checksums.txt");
  });

  test("it resolves the target for the machine it runs on", () => {
    // Sourcing it rather than running it — the guard exists for exactly this.
    const result = Bun.spawnSync(
      ["bash", "-c", "SENTRY_TUI_INSTALL_SH_NO_RUN=1 source install.sh; detect_target"],
      { cwd: ROOT },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(`${process.platform}-${process.arch}`);
  });

  test("it verifies the checksum before installing", async () => {
    const script = await read("install.sh");
    const verifyAt = script.indexOf("checksum mismatch");
    const installAt = script.indexOf('mv "${INSTALL_DIR}/.sentry-tui.new"');

    expect(verifyAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(verifyAt);
  });
});

describe("homebrew formula", () => {
  const checksums = new Map(
    RELEASE_TARGETS.map((target, index) => [
      `${target.asset}.${ARCHIVE_EXT}`,
      String(index + 1).repeat(64),
    ]),
  );

  test("it covers every target with its own url and sha", () => {
    const formula = renderFormula("1.2.3", checksums);

    for (const target of RELEASE_TARGETS) {
      expect(formula).toContain(`${target.asset}.${ARCHIVE_EXT}`);
      expect(formula).toContain(checksums.get(`${target.asset}.${ARCHIVE_EXT}`)!);
    }

    expect(formula).toContain('version "1.2.3"');
    expect(formula).toContain("/download/v1.2.3/");
    expect(formula).toContain('bin.install "sentry-tui"');
  });

  test("a missing checksum fails the build rather than shipping a blank one", () => {
    const incomplete = new Map(checksums);
    incomplete.delete("sentry-tui-linux-x64.tar.gz");

    expect(() => renderFormula("1.2.3", incomplete)).toThrow(/sentry-tui-linux-x64/);
  });

  test("checksum parsing accepts sha256sum output", () => {
    const parsed = parseChecksums(
      `${"a".repeat(64)}  sentry-tui-darwin-arm64.tar.gz\n` +
        `${"B".repeat(64)} *sentry-tui-linux-arm64.tar.gz\n` +
        `not a checksum line\n`,
    );

    expect(parsed.get("sentry-tui-darwin-arm64.tar.gz")).toBe("a".repeat(64));
    expect(parsed.get("sentry-tui-linux-arm64.tar.gz")).toBe("b".repeat(64));
    expect(parsed.size).toBe(2);
  });
});

describe("release commands", () => {
  test("every subcommand has a package.json script, and vice versa", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as {
      scripts: Record<string, string>;
    };

    const scripted = Object.entries(manifest.scripts)
      .filter(([name]) => name.startsWith("release:"))
      .map(([name, body]) => {
        const subcommand = name.slice("release:".length);
        expect(body).toBe(`bun run ./scripts/release.ts ${subcommand}`);
        return subcommand;
      });

    expect(scripted.sort()).toEqual(Object.keys(COMMANDS).sort());
  });
});

describe("repository manifest", () => {
  test("the dev bin entry is executable on its own", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as {
      bin: Record<string, string>;
    };
    expect(manifest.bin["sentry-tui"]).toBe("src/main.tsx");

    // `npx sentry-tui` inside a checkout resolves to this package and execs the
    // file directly. Without the shebang the shell parses TSX as shell script.
    const source = await read("src/main.tsx");
    expect(source.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  });

  test("stays private, so only generated packages can be published", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as Record<string, unknown>;
    expect(manifest.private).toBe(true);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
