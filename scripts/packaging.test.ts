/**
 * Guards the distribution chain against drift.
 *
 * The platform list lives in `release-targets.ts`, but two other files repeat
 * it in their own syntax: the launcher's lookup table (plain JS, shipped to
 * npm) and the release workflow's build matrix (YAML). Nothing but these tests
 * connects them, so a target added in one place and forgotten elsewhere fails
 * here rather than in a release.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { APP_FIRST_CHECK_MS } from "../packages/launcher/src/launch.mjs";
import { UPDATE_FIRST_CHECK_MS } from "../packages/runtime-host/src/update/selfUpdate.ts";
import {
  aliasManifest,
  appManifest,
  launcherManifest,
  packageDirName,
  platformManifest,
} from "./build-npm.ts";
import { HOST_MODULES, rewriteHostModuleSpecifiers } from "./build-app.ts";
import { COMMANDS } from "./release.ts";
import {
  ALIAS_PACKAGE,
  APP_PACKAGE,
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
    const source = await read("packages/launcher/src/launch.mjs");

    expect(source).toContain(`APP_PACKAGE = "${APP_PACKAGE}"`);

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

  test("it marks the process it launches, which is what unlocks the in-app update", async () => {
    // The app offers a cached payload only when it sees this, and
    // nothing else sets it. Drop the marker and the pill silently never
    // appears — no product-source test would notice, because none of them run the
    // launcher.
    const source = await read("packages/launcher/src/launch.mjs");

    expect(source).toContain('SENTRY_TUI_MANAGED: "1"');
    // Every spawn of the binary, not just the happy path: the chmod retry and
    // the fall-back-to-bundled path hand over the same terminal.
    const spawns = [
      ...source.matchAll(/spawnSync\((?:binary|bundled\.path), argv, (\{[^}]*\})\)/g),
    ];
    expect(spawns.length).toBe(3);
    for (const [, options] of spawns) expect(options).toContain("env: childEnv(appPayload)");
  });

  test("it discards a permanently broken cached build before falling back", async () => {
    const source = await read("packages/launcher/src/launch.mjs");
    const fallback = source.indexOf("if (result.error && binary !== bundled.path)");
    const discard = source.indexOf("discardFailedCachedBuild(local, result.error)", fallback);
    const bundledSpawn = source.indexOf("spawnSync(bundled.path, argv", fallback);

    expect(fallback).toBeGreaterThan(-1);
    expect(discard).toBeGreaterThan(fallback);
    expect(bundledSpawn).toBeGreaterThan(discard);
  });

  test("it looks for both independent release lines only after the child exits", async () => {
    // The cadence lives in the runtime host updater; the launcher's share of it
    // is this pair of calls, after the child has exited: one registry request
    // for the payload and one for the platform host. Move them above the spawn
    // and every launch checks each release line twice.
    const source = await read("packages/launcher/src/launch.mjs");

    const calls = [...source.matchAll(/(?<!function )startBackgroundUpdate\(/g)];
    expect(calls.length).toBe(2);

    const handover = source.indexOf("spawnSync(binary, argv");
    expect(handover).toBeGreaterThan(-1);
    for (const call of calls) expect(call.index).toBeGreaterThan(handover);
  });

  test("it hands the check to the app whenever the app was up long enough", () => {
    // The launcher cannot import the TypeScript the binary is compiled from,
    // so it restates this one number, and gates its own check on it. Drift is
    // silent either way: too low here and a session that quit before its first
    // check gets no check at all, too high and both halves run. This is the
    // only thing holding the two sides of the cadence together.
    expect(APP_FIRST_CHECK_MS).toBe(UPDATE_FIRST_CHECK_MS);
  });

  test("the bin entries point at the launcher module", async () => {
    expect(await read("packages/launcher/src/bin-launcher.mjs")).toContain("../lib/launch.mjs");
    expect(await read("packages/launcher/src/bin-alias.mjs")).toContain(
      `${LAUNCHER_PACKAGE}/launch`,
    );
  });
});

describe("generated manifests", () => {
  const version = "1.2.3";

  test("the launcher pins its hosts but resolves the independent app release line", () => {
    const manifest = launcherManifest(version);
    const optional = manifest.optionalDependencies as Record<string, string>;

    expect(Object.keys(optional).sort()).toEqual(RELEASE_TARGETS.map((t) => t.npmPackage).sort());
    for (const pinned of Object.values(optional)) expect(pinned).toBe(version);
    expect(manifest.name).toBe(LAUNCHER_PACKAGE);
    expect(manifest.dependencies[APP_PACKAGE]).toBe("*");
    expect(manifest.bin["sentry-tui"]).toBe("bin/sentry-tui.mjs");
  });

  test("the app package exposes the payload and its manifest", () => {
    const manifest = appManifest(version);
    expect(manifest.name).toBe(APP_PACKAGE);
    expect(manifest.exports["./app"]).toBe("./app/app.mjs");
    expect(manifest.files).toContain("app");
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
      expect(manifest.files).toEqual(["bin", "LICENSE", "README.md", "THIRD_PARTY_NOTICES"]);
    }
  });

  test("compiled distributions carry their own and third-party license notices", async () => {
    const notice = await read("THIRD_PARTY_NOTICES");
    const npmBuilder = await read("scripts/build-npm.ts");
    const releasePackager = await read(".github/scripts/package-release.sh");

    expect(notice).toContain("tree-sitter-python");
    expect(notice).toContain("tree-sitter-ruby");
    expect(notice).toContain("tree-sitter-php");
    expect(notice).toContain("tree-sitter-go");
    expect(notice).toContain("Copyright (c) 2016 Max Brunsfeld");
    expect(npmBuilder).toContain('join(dir, "THIRD_PARTY_NOTICES")');
    expect(npmBuilder).toContain('join(dir, "LICENSE")');
    expect(releasePackager).toContain("sentry-tui app LICENSE THIRD_PARTY_NOTICES");
  });

  test("package directories stay one level deep", () => {
    expect(packageDirName(LAUNCHER_PACKAGE)).toBe("billyvg-sentry-tui");
    expect(packageDirName(APP_PACKAGE)).toBe("billyvg-sentry-tui-app");
    expect(packageDirName(ALIAS_PACKAGE)).toBe("sentry-tui");
    for (const target of RELEASE_TARGETS) {
      expect(packageDirName(target.npmPackage)).not.toContain("/");
    }
  });
});

describe("app payload", () => {
  test("runtime-owned imports are rewritten to host virtual modules", () => {
    const imports = [...HOST_MODULES.keys()]
      .map((name) => `import ${JSON.stringify(name)};`)
      .join("\n");
    const rewritten = rewriteHostModuleSpecifiers(imports);

    for (const [dependency, hosted] of HOST_MODULES) {
      expect(hosted.length).toBe(dependency.length);
      expect(rewritten).not.toContain(JSON.stringify(dependency));
      expect(rewritten).toContain(JSON.stringify(hosted));
    }
  });

  test("the release builds the payload before packaging it", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const build = workflow.indexOf("run: bun run build:app");
    expect(build).toBeGreaterThan(-1);
    expect(workflow.indexOf("run: .github/scripts/package-release.sh")).toBeGreaterThan(build);
    expect(workflow.indexOf("bun run build:npm --component")).toBeGreaterThan(build);
  });

  test("every compiled host smoke-loads a payload", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const buildJob = workflow.split(/^  build:/m)[1]!.split(/^  package:/m)[0]!;
    expect(buildJob).toContain("SENTRY_TUI_VERIFY_PAYLOAD=");
    expect(buildJob).toContain("bun run build:app");
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
    expect(workflow).toContain('run: bun run test:shard "$SHARD" "4"');
    expect(workflow).toMatch(
      /build:\n\s+name: Build[^\n]*\n\s+needs: \[verify, validate, test, tag\]/,
    );
    expect(workflow).toMatch(
      /package:\n\s+name: Package release\n\s+needs: \[verify, validate, test, tag, build\]/,
    );
  });

  test("a remote cut validates its exact commit before creating the tag", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const tagJob = workflow.split(/^  tag:/m)[1]!.split(/^  build:/m)[0]!;

    expect(workflow).toContain("types: [release_cut]");
    expect(workflow).toContain("ref: ${{ github.event.client_payload.sha || github.sha }}");
    expect(tagJob).toContain("needs: [verify, validate, test]");
    expect(tagJob).toContain('git tag -a "host-v${HOST_VERSION}"');
    expect(tagJob).toContain('git tag -a "app-v${APP_VERSION}"');
    expect(tagJob).toContain('git push origin "host-v${HOST_VERSION}"');
    expect(tagJob).toContain('git push origin "app-v${APP_VERSION}"');
  });

  test("npm is authenticated over OIDC, not by a required token", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const script = await read(".github/scripts/publish-npm.sh");

    // An account with 2FA on writes answers a token publish with EOTP, and no
    // unattended job can produce a one-time password. OIDC is not subject to
    // it, but only with `id-token: write` and npm 11.5.1+ — miss either and
    // the failure names neither OIDC nor the missing piece.
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("npm install -g npm@latest");

    // A token may remain as a fallback, but requiring one puts the release
    // back on the path that cannot work unattended.
    expect(script).not.toContain('"${NPM_TOKEN:?');
  });

  test("a partly-published release can be re-run", async () => {
    const script = await read(".github/scripts/publish-npm.sh");

    // A multi-package host release can fail partway through its uploads.
    // Without this the retry dies on "cannot publish over the previously
    // published version" and the release can never be completed. npm also
    // caches the pre-publish 404, so the retry has to revalidate online.
    expect(script).toContain("already published — skipping");
    expect(script).toContain(
      'npm view "$name@$version" version --registry "$REGISTRY" --prefer-online',
    );
  });

  test("combined releases publish hosts before the app payload", async () => {
    const script = await read(".github/scripts/publish-npm.sh");

    // v0.10.1 and earlier know only the platform package release line. If a
    // combined publish stops after the app package, those clients cannot see
    // the new release at all, even though npm contains a newer payload.
    const hostLoop = script.indexOf('for dir in "$NPM_DIR"/billyvg-sentry-tui-*');
    const appPublish = script.indexOf('publish "$NPM_DIR/billyvg-sentry-tui-app"');
    const launcherPublish = script.indexOf('publish "$NPM_DIR/billyvg-sentry-tui"');

    expect(hostLoop).toBeGreaterThan(-1);
    expect(appPublish).toBeGreaterThan(hostLoop);
    expect(launcherPublish).toBeGreaterThan(appPublish);
  });

  test("publishing is skipped on a dry run", async () => {
    const workflow = await read(".github/workflows/release.yml");

    // Every step that publishes or records something live is in the `publish`
    // job, which is gated as a whole rather than step-by-step, so a dry run
    // never enters it.
    const publishJob = workflow.split(/^  publish:/m)[1];
    expect(publishJob).toBeDefined();
    expect(publishJob).toContain("if: needs.verify.outputs.dry_run != 'true'");

    const publishSteps = publishJob!
      .split("      - name: ")
      .filter((step) => /run: .*(publish-npm|gh api|gh release create)/s.test(step));
    expect(publishSteps.length).toBe(3);
  });

  test("a production deployment is recorded only after npm publishes", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const publishJob = workflow.split(/^  publish:/m)[1];
    expect(publishJob).toBeDefined();

    expect(publishJob).toContain("environment:");
    expect(publishJob).toContain("name: production");
    expect(publishJob).toContain("deployment: false");
    expect(publishJob).toContain("deployments: write");

    const npmPublish = publishJob!.indexOf("run: .github/scripts/publish-npm.sh");
    const deployment = publishJob!.indexOf("- name: Create GitHub deployment");
    const githubRelease = publishJob!.indexOf("- name: Create GitHub Release");

    expect(npmPublish).toBeGreaterThan(-1);
    expect(deployment).toBeGreaterThan(npmPublish);
    expect(githubRelease).toBeGreaterThan(deployment);

    const deploymentStep = publishJob!.slice(deployment, githubRelease);
    expect(deploymentStep).toContain('/deployments"');
    expect(deploymentStep).toContain("/deployments/${deployment_id}/statuses");
    expect(deploymentStep).toContain("X-GitHub-Api-Version: 2026-03-10");
    expect(deploymentStep).toContain('--field "required_contexts[]"');
    expect(deploymentStep).toContain('--field "state=success"');
    expect(deploymentStep).toContain("https://www.npmjs.com/package/sentry-tui/v/${HOST_VERSION}");
    expect(deploymentStep).toContain("@billyvg/sentry-tui-app/v/${APP_VERSION}");
  });

  test("an app-only release skips every native build", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const buildJob = workflow.split(/^  build:/m)[1]!.split(/^  package:/m)[0]!;
    const packageJob = workflow.split(/^  package:/m)[1]!.split(/^  publish:/m)[0]!;

    expect(buildJob).toContain("if: needs.verify.outputs.release_host == 'true'");
    expect(packageJob).toContain("bun run build:npm --component app");
    expect(packageJob).toContain("needs.verify.outputs.release_host == 'true'");
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

  test("cut commits and dispatches remotely, then watches the exact release run", async () => {
    const source = await read("scripts/release.ts");
    const cutPath = source.split("interface RemoteReleaseSource")[1]!.split("// publish")[0]!;

    // A stale checkout must not choose or mutate the release. The expected-head
    // GraphQL mutation makes a racing update fail, then repository_dispatch
    // hands that exact commit to the workflow which creates the tag after CI.
    expect(cutPath).toContain("createCommitOnBranch");
    expect(cutPath).toContain("expectedHeadOid: $head");
    expect(cutPath).toContain("repos/${REPOSITORY}/dispatches");
    expect(cutPath).toContain("event_type=release_cut");
    expect(cutPath).toContain("client_payload[sha]=${commit}");
    expect(cutPath).not.toContain('["git",');

    // Locate by its unique dispatch id rather than whichever release happened
    // to be newest, then propagate a failed Release run back to the command.
    expect(cutPath).toContain("run.displayTitle.includes(`[${requestId}]`)");
    expect(cutPath).toContain('"gh", "run", "watch"');
    expect(cutPath).toContain('"--exit-status"');
  });
});

describe("repository manifest", () => {
  test("the dev bin entry is executable on its own", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as {
      bin: Record<string, string>;
    };
    expect(manifest.bin["sentry-tui"]).toBe("packages/runtime-host/src/main.tsx");

    // `npx sentry-tui` inside a checkout resolves to this package and execs the
    // file directly. Without the shebang the shell parses TSX as shell script.
    const source = await read("packages/runtime-host/src/main.tsx");
    expect(source.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  });

  test("stays private, so only generated packages can be published", async () => {
    const manifest = (await Bun.file(join(ROOT, "package.json")).json()) as Record<string, unknown>;
    expect(manifest.private).toBe(true);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("tracks host and app release lines independently", async () => {
    const versions = (await Bun.file(join(ROOT, "release.json")).json()) as Record<string, unknown>;
    expect(versions.host).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions.app).toMatch(/^\d+\.\d+\.\d+/);
  });
});
