#!/usr/bin/env bun
/**
 * One command per step of a release, so nothing has to be reconstructed from
 * the runbook by hand.
 *
 *   bun run release:preflight   is this machine and this repo ready?
 *   bun run release:dry-run     build and package on CI, publish nothing
 *   bun run release:cut 0.2.0   bump, verify, commit, tag, push — CI does the rest
 *   bun run release:publish     publish from CI artifacts, by hand
 *   bun run release:verify      check what actually landed
 *
 * `docs/releasing.md` explains what each one is doing and why.
 */
import { $ } from "bun";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALIAS_PACKAGE,
  BINARY_NAME,
  LAUNCHER_PACKAGE,
  RELEASE_TARGETS,
  REPOSITORY,
} from "./release-targets.ts";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOW = "release.yml";
/**
 * Pinned on every npm call rather than trusting config: a work machine may well
 * point npm at a mirror or a private proxy (Sentry laptops set one through
 * NPM_CONFIG_REGISTRY), and publishing a personal package there instead of to
 * npmjs is not a mistake you get to take back quietly.
 */
const REGISTRY = "https://registry.npmjs.org";
const TAP_REPO = "billyvg/homebrew-tap";
/** Longest `release:cut` will wait for CI before giving up. */
const CI_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
/** Gap between check-run polls: unnoticeable to a human, gentle on the API. */
const CI_POLL_MS = 15 * 1000;
/** Packages in publish order: platforms first, then the launcher, then the alias. */
const PUBLISH_ORDER = [
  ...RELEASE_TARGETS.map((target) => target.npmPackage),
  LAUNCHER_PACKAGE,
  ALIAS_PACKAGE,
];

const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

const step = (text: string) => console.log(`\n${bold(`==> ${text}`)}`);
const ok = (text: string) => console.log(`  ${green("✓")} ${text}`);
const warn = (text: string) => console.log(`  ${yellow("!")} ${text}`);
const bad = (text: string) => console.log(`  ${red("✗")} ${text}`);

/** Every flag is opt-in; `--yes` skips the confirmation prompts. */
const flags = {
  yes: process.argv.includes("--yes") || process.argv.includes("-y"),
  npmDryRun: process.argv.includes("--npm-dry-run"),
  skipDownload: process.argv.includes("--skip-download"),
  /** Run the full local suite too, on top of reading CI. */
  check: process.argv.includes("--check"),
  /** Release anyway, whatever CI says. */
  force: process.argv.includes("--force"),
  /** Wait for an in-progress CI run. Default; `--no-wait` stops instead. */
  wait: !process.argv.includes("--no-wait"),
};

function die(message: string): never {
  console.error(`\n${red("error")} ${message}`);
  process.exit(1);
}

/** Read `--name value` from argv. */
function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("-")) die(`${name} needs a value`);
  return value;
}

/** `--otp 123456`, for an npm account with two-factor auth on writes. */
const otp = readOption("--otp");

/** Positional arguments after the subcommand, minus any option values. */
const positionals = process.argv.slice(3).filter((arg) => !arg.startsWith("-") && arg !== otp);

/** Ask before anything outward-facing or hard to undo. */
function check(question: string): void {
  if (flags.yes) return;
  if (!confirm(`${question}`)) die("aborted");
}

/** Run a command, returning stdout and the exit code, printing nothing. */
async function capture(command: string[]): Promise<{ code: number; out: string }> {
  const result = await $`${command}`.cwd(ROOT).nothrow().quiet();
  return { code: result.exitCode, out: result.stdout.toString().trim() };
}

/** Run a command with its output attached to the terminal; throw on failure. */
async function run(command: string[], env?: Record<string, string>): Promise<void> {
  console.log(dim(`  $ ${command.join(" ")}`));
  const shell = env ? $`${command}`.env({ ...process.env, ...env }) : $`${command}`;
  const result = await shell.cwd(ROOT).nothrow();
  if (result.exitCode !== 0) die(`\`${command.join(" ")}\` exited ${result.exitCode}`);
}

/**
 * An npmrc holding `NPM_TOKEN`, when one is set.
 *
 * An automation token is the calm way through a first publish: it authenticates
 * six uploads without a 2FA prompt between them, and it is the same token CI
 * uses. Written 0600 into a temp dir and deleted afterwards, so the credential
 * never lands in the repo or in shell history.
 */
function npmrcFromToken(): { env: Record<string, string>; cleanup: () => void } | undefined {
  const token = process.env.NPM_TOKEN;
  if (!token) return undefined;

  const dir = mkdtempSync(join(tmpdir(), "sentry-tui-npm-"));
  const path = join(dir, "npmrc");
  writeFileSync(path, `//registry.npmjs.org/:_authToken=${token}\n`);
  chmodSync(path, 0o600);

  return {
    env: { NPM_CONFIG_USERCONFIG: path },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function packageVersion(): Promise<string> {
  const { version } = (await Bun.file(join(ROOT, "package.json")).json()) as { version: string };
  return version;
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

/**
 * Check everything a release depends on that lives outside this repo, and
 * report all of it at once rather than failing one step at a time.
 */
async function preflight(): Promise<void> {
  const version = await packageVersion();
  let blocking = 0;

  step(`Preflight for v${version}`);

  const configured = await capture(["npm", "config", "get", "registry"]);
  if (configured.out === REGISTRY || configured.out === `${REGISTRY}/`) {
    ok(`npm registry: ${configured.out}`);
  } else {
    warn(
      `npm registry is ${configured.out} — every npm call here pins ${REGISTRY}, ` +
        `so this is handled, but a bare \`npm publish\` would go to the wrong place`,
    );
  }

  const npmUser = await capture(["npm", "whoami", "--registry", REGISTRY]);
  if (npmUser.code !== 0) {
    // Not blocking: CI publishes with NPM_TOKEN, so a local login only matters
    // for `release:publish`.
    warn(
      `npm: not logged in to ${REGISTRY} — \`npm login --registry ${REGISTRY}\`, needed only for a manual publish`,
    );
  } else if (npmUser.out !== "billyvg") {
    warn(`npm: logged in as ${npmUser.out}, expected billyvg`);
  } else {
    ok(`npm: logged in as ${npmUser.out}`);
  }

  const ghAuth = await capture(["gh", "auth", "status"]);
  if (ghAuth.code !== 0) {
    bad("gh: not authenticated — run `gh auth login`");
    blocking++;
  } else {
    ok("gh: authenticated");
  }

  const secrets = await capture(["gh", "secret", "list", "--repo", REPOSITORY]);
  if (secrets.out.includes("NPM_TOKEN")) {
    ok("NPM_TOKEN secret is set");
  } else {
    bad("NPM_TOKEN secret is missing — CI cannot publish (gh secret set NPM_TOKEN)");
    blocking++;
  }

  if (secrets.out.includes("HOMEBREW_TAP_TOKEN")) {
    ok("HOMEBREW_TAP_TOKEN secret is set");
  } else {
    warn("HOMEBREW_TAP_TOKEN is missing — the tap step will be skipped");
  }

  const tap = await capture(["gh", "repo", "view", TAP_REPO, "--json", "name"]);
  if (tap.code === 0) ok(`Homebrew tap ${TAP_REPO} exists`);
  else warn(`Homebrew tap ${TAP_REPO} does not exist yet — brew installs will not work`);

  // The registry is the authority on whether these names are still ours to take.
  for (const name of [ALIAS_PACKAGE, LAUNCHER_PACKAGE]) {
    const published = await publishedVersion(name);
    if (!published) {
      ok(`${name}: unpublished, name is free`);
      continue;
    }
    if (published === version) {
      bad(`${name}@${version} is already published — bump the version first`);
      blocking++;
    } else {
      ok(`${name}: latest is ${published}, publishing ${version}`);
    }
  }

  const dirty = await capture(["git", "status", "--porcelain"]);
  if (dirty.out) warn("working tree is dirty");
  else ok("working tree is clean");

  const branch = await capture(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.out === "main") {
    ok("on main");
  } else {
    warn(
      `on ${branch.out}, not main — \`gh workflow run\` only finds ${WORKFLOW} once it is on the default branch`,
    );
  }

  console.log();
  if (blocking > 0) die(`${blocking} blocking problem${blocking === 1 ? "" : "s"} above`);
  console.log(green("Ready."));
}

// ---------------------------------------------------------------------------
// dry-run
// ---------------------------------------------------------------------------

/** Trigger the release workflow in dry-run mode and follow it to completion. */
async function dryRun(): Promise<void> {
  const branch = (await capture(["git", "rev-parse", "--abbrev-ref", "HEAD"])).out;

  step(`Triggering ${WORKFLOW} (dry run) on ${branch}`);
  await run([
    "gh",
    "workflow",
    "run",
    WORKFLOW,
    "--repo",
    REPOSITORY,
    "--ref",
    branch,
    "-f",
    "dry_run=true",
  ]);

  // The run does not exist the instant the dispatch returns.
  await Bun.sleep(4000);
  const runId = await latestRunId();
  if (!runId) die("could not find the dispatched run — check `gh run list`");

  step(`Watching run ${runId}`);
  await run(["gh", "run", "watch", runId, "--repo", REPOSITORY, "--exit-status"]);

  step("Artifacts");
  await run(["gh", "run", "view", runId, "--repo", REPOSITORY]);
  console.log(
    `\nDownload the bundle with:\n  ${bold(`gh run download ${runId} -n release-bundle --dir bundle`)}`,
  );
}

/** Most recent run of the release workflow, whatever its status. */
async function latestRunId(): Promise<string | undefined> {
  const list = await capture([
    "gh",
    "run",
    "list",
    "--repo",
    REPOSITORY,
    "--workflow",
    WORKFLOW,
    "--limit",
    "1",
    "--json",
    "databaseId",
  ]);
  if (list.code !== 0) return undefined;
  const [entry] = JSON.parse(list.out || "[]") as { databaseId: number }[];
  return entry ? String(entry.databaseId) : undefined;
}

// ---------------------------------------------------------------------------
// cut
// ---------------------------------------------------------------------------

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

/** Every check GitHub has recorded against a commit. */
async function checkRunsFor(sha: string): Promise<CheckRun[]> {
  const result = await capture([
    "gh",
    "api",
    `repos/${REPOSITORY}/commits/${sha}/check-runs`,
    "--jq",
    ".check_runs",
  ]);
  if (result.code !== 0) throw new Error(`could not read CI status for ${sha.slice(0, 7)}`);
  return JSON.parse(result.out || "[]") as CheckRun[];
}

/**
 * Refuse to tag a commit CI has not blessed.
 *
 * The release workflow runs the suite itself before it builds anything, so this
 * is not what stops broken code shipping — it is what stops a release starting
 * on a commit already known to be broken. Failing here costs seconds; failing
 * in the workflow costs a tag that has to be deleted and re-cut.
 *
 * Reading the verdict beats re-running the suite locally either way: it is
 * seconds rather than minutes, and it describes the pushed commit rather than
 * one machine's working tree.
 */
async function requireGreenCi(sha: string): Promise<void> {
  step(`Checking CI for ${sha.slice(0, 7)}`);

  /** What was last printed, so waiting does not repeat itself every poll. */
  let reported = "";
  const deadline = Date.now() + CI_WAIT_TIMEOUT_MS;

  for (let attempt = 0; ; attempt++) {
    if (Date.now() > deadline) {
      die(
        `CI has not finished for ${sha.slice(0, 7)} after ` +
          `${Math.round(CI_WAIT_TIMEOUT_MS / 60000)} minutes. Check the run, ` +
          `then release again.`,
      );
    }

    const runs = await checkRunsFor(sha);

    if (runs.length === 0) {
      // Almost always "CI has not started yet" rather than "there is nothing to
      // run": the workflow's first job runs on every push, docs included. Waving
      // this through would drop the gate exactly when a release is racing the
      // run it depends on.
      if (flags.wait) {
        if (attempt === 0) console.log(dim("  no checks yet, waiting for CI to start…"));
        await Bun.sleep(CI_POLL_MS);
        continue;
      }
      die(
        `no checks recorded for ${sha.slice(0, 7)} yet — CI may not have started. ` +
          `Drop --no-wait to wait for it, or --force if this commit genuinely has no CI.`,
      );
    }

    const failed = runs.filter(
      (check) =>
        check.status === "completed" &&
        check.conclusion !== null &&
        !["success", "skipped", "neutral"].includes(check.conclusion),
    );
    const pending = runs.filter((check) => check.status !== "completed");

    const summary = runs
      .map((check) => {
        const state = check.status === "completed" ? (check.conclusion ?? "?") : check.status;
        return `${check.name}: ${state}`;
      })
      .sort()
      .join("\n");

    if (summary !== reported) {
      reported = summary;
      for (const check of runs) {
        const state = check.status === "completed" ? (check.conclusion ?? "?") : check.status;
        if (failed.includes(check)) bad(`${check.name}: ${state}`);
        else if (pending.includes(check)) warn(`${check.name}: ${state}`);
        else ok(`${check.name}: ${state}`);
      }
    }

    if (failed.length > 0) {
      die(
        `CI is red for ${sha.slice(0, 7)} — fix it, or \`--force\` to release anyway.\n` +
          `  gh run list --commit ${sha}`,
      );
    }

    if (pending.length === 0) return;

    if (!flags.wait) {
      die(
        `CI is still running for ${sha.slice(0, 7)}. Re-run when it finishes, ` +
          `or --force to skip the check.`,
      );
    }

    if (attempt === 0) console.log(dim("  waiting for CI to finish…"));
    await Bun.sleep(CI_POLL_MS);
  }
}

/**
 * Bump the version, verify, commit, tag, and push — CI takes it from the tag.
 * Without an argument it releases whatever version package.json already names.
 */
async function cut(): Promise<void> {
  const requested = positionals[0];
  const current = await packageVersion();
  const version = requested ?? current;

  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    die(`"${version}" is not a semver version — try \`bun run release:cut 0.2.0\``);
  }

  const dirty = (await capture(["git", "status", "--porcelain"])).out;
  if (dirty) die("working tree is dirty — commit or stash first");

  const branch = (await capture(["git", "rev-parse", "--abbrev-ref", "HEAD"])).out;
  if (branch !== "main") warn(`releasing from ${branch}, not main`);

  // The commit has to be on the remote already, or CI has never seen the code
  // about to be published and there is no verdict to read.
  const fetched = await capture(["git", "fetch", "--quiet", "origin", branch]);
  if (fetched.code !== 0 && !flags.force) {
    die(`origin has no ${branch}. Push the branch first so CI can run against it.`);
  }

  const head = (await capture(["git", "rev-parse", "HEAD"])).out;
  const remote = (await capture(["git", "rev-parse", `origin/${branch}`])).out;
  if (head !== remote && !flags.force) {
    die(
      `HEAD is not origin/${branch}. Push first so CI can run against it, ` +
        `or --force to release regardless.`,
    );
  }

  if (flags.force) warn("--force: releasing without checking CI");
  else await requireGreenCi(head);

  const existingTag = await capture([
    "git",
    "rev-parse",
    "-q",
    "--verify",
    `refs/tags/v${version}`,
  ]);
  if (existingTag.code === 0) die(`tag v${version} already exists`);

  const manifestPath = join(ROOT, "package.json");
  const original = await Bun.file(manifestPath).text();
  /** Put the manifest back, so an abort leaves the tree as it was found. */
  const restore = async () => {
    if (version !== current) await Bun.write(manifestPath, original);
  };

  if (version !== current) {
    step(`Bumping ${current} → ${version}`);
    // Replace only the top-level version field, which is the first one.
    const bumped = original.replace(`"version": "${current}"`, `"version": "${version}"`);
    if (bumped === original) die("could not find the version field in package.json");
    await Bun.write(manifestPath, bumped);
    ok(`package.json is now ${version}`);
  }

  // Only on request: CI has already run all of this against this commit.
  if (flags.check) {
    step("Verifying locally");
    await run(["bun", "run", "check"]);
  }

  step(`Releasing v${version}`);
  console.log(`  commit, tag v${version}, and push to origin/${branch}`);
  console.log(`  CI then builds ${RELEASE_TARGETS.length} binaries and publishes:`);
  for (const name of PUBLISH_ORDER) console.log(`    ${name}@${version}`);
  if (!flags.yes && !confirm(`\nPush v${version}? This publishes to npm.`)) {
    await restore();
    die("aborted");
  }

  await run(["git", "commit", "-am", `chore: release v${version}`]);
  await run(["git", "tag", `v${version}`]);
  await run(["git", "push", "origin", branch, "--follow-tags"]);

  console.log(`\n${green("Pushed.")} Follow the release with:\n  ${bold("gh run watch")}`);
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

/**
 * Ask the registry what version of `spec` exists, revalidating rather than
 * trusting the local cache.
 *
 * `--prefer-online` is the whole point: npm caches 404s too, so a name checked
 * before it was published keeps reading as unpublished for minutes afterwards.
 * That made `release:verify` contradict a publish that had in fact succeeded.
 */
async function publishedVersion(spec: string): Promise<string | undefined> {
  const view = await capture([
    "npm",
    "view",
    spec,
    "version",
    "--registry",
    REGISTRY,
    "--prefer-online",
  ]);
  if (view.code !== 0) return undefined;
  return view.out.trim().replaceAll('"', "") || undefined;
}

/** Whether this exact version is already on the registry. */
async function isPublished(name: string, version: string): Promise<boolean> {
  return (await publishedVersion(`${name}@${version}`)) === version;
}

/**
 * Publish by hand from a CI run's binaries.
 *
 * The binaries are re-assembled locally with `build:npm` rather than taken from
 * the `release-bundle` artifact, because artifact downloads drop the executable
 * bit and `npm publish` ships whatever mode the file has on disk.
 */
async function publish(): Promise<void> {
  const version = await packageVersion();

  if (flags.skipDownload) {
    step("Using the binaries already in dist/bin");
  } else {
    const runId = positionals[0] ?? (await latestRunId());
    if (!runId) die("no release workflow run found — pass a run id, or run release:dry-run first");

    step(`Downloading binaries from run ${runId}`);
    // Cleared first so a stale binary from an earlier run cannot be published.
    await run(["rm", "-rf", join(ROOT, "dist", "bin")]);
    const names = RELEASE_TARGETS.flatMap((target) => ["-n", target.key]);
    await run([
      "gh",
      "run",
      "download",
      runId,
      "--repo",
      REPOSITORY,
      "--dir",
      "dist/bin",
      ...names,
    ]);
  }

  for (const target of RELEASE_TARGETS) {
    const binary = Bun.file(join(ROOT, "dist", "bin", target.key, BINARY_NAME));
    if (!(await binary.exists())) die(`no ${target.key} binary at dist/bin/${target.key}`);
    ok(`${target.key} (${(binary.size / 1_048_576).toFixed(1)} MB)`);
  }

  step("Assembling packages");
  await run(["bun", "run", "build:npm", "--strict"]);

  step(`Publishing ${PUBLISH_ORDER.length} packages at ${version}`);
  for (const name of PUBLISH_ORDER) console.log(`  ${name}@${version}`);
  if (flags.npmDryRun) warn("--npm-dry-run: nothing will be uploaded");
  else check(`\nPublish to npm? Unpublishing is only possible for 72 hours.`);

  const auth = npmrcFromToken();
  if (auth) ok("authenticating with NPM_TOKEN from the environment");

  try {
    for (const name of PUBLISH_ORDER) {
      // Six uploads of ~24MB each: one can fail on a flaky connection or an
      // OTP that expired mid-run. Skipping what already landed lets a re-run
      // finish the job rather than die on "cannot publish over the previously
      // published version".
      if (!flags.npmDryRun && (await isPublished(name, version))) {
        ok(`${name}@${version} is already published — skipping`);
        continue;
      }

      const dir = `dist/npm/${name.replace("@", "").replace("/", "-")}`;
      const command = ["npm", "publish", dir, "--access", "public", "--registry", REGISTRY];
      if (flags.npmDryRun) command.push("--dry-run");
      if (otp) command.push("--otp", otp);
      await run(command, auth?.env);
    }
  } finally {
    auth?.cleanup();
  }

  console.log(`\n${green("Published.")} Check it with:\n  ${bold("bun run release:verify")}`);
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/** Confirm what is actually on the registry, and that it runs. */
async function verify(): Promise<void> {
  const version = await packageVersion();

  step(`Registry, expecting ${version}`);
  for (const name of PUBLISH_ORDER) {
    const published = await publishedVersion(name);
    if (!published) bad(`${name}: not published`);
    else if (published === version) ok(`${name}@${published}`);
    else warn(`${name}@${published}, expected ${version}`);
  }

  step(`Running npx ${ALIAS_PACKAGE}@${version}`);
  console.log(dim("  downloads the launcher and this platform's binary, ~24 MB"));
  const npx = await capture([
    "npx",
    "--yes",
    "--registry",
    REGISTRY,
    `${ALIAS_PACKAGE}@${version}`,
    "--help",
  ]);
  if (npx.code === 0 && npx.out.includes("sentry.io in your terminal")) ok("npx runs the CLI");
  else bad(`npx failed (exit ${npx.code})`);

  const brew = await capture([
    "brew",
    "info",
    "--json=v2",
    `${TAP_REPO.replace("homebrew-", "")}/sentry-tui`,
  ]);
  if (brew.code === 0) {
    const info = JSON.parse(brew.out) as { formulae?: { versions?: { stable?: string } }[] };
    const formulaVersion = info.formulae?.[0]?.versions?.stable;
    if (formulaVersion === version) ok(`Homebrew formula is ${formulaVersion}`);
    else warn(`Homebrew formula is ${formulaVersion ?? "unknown"}, expected ${version}`);
  } else {
    warn("Homebrew tap not installed locally — skipping (brew tap billyvg/tap)");
  }
}

// ---------------------------------------------------------------------------

/** Subcommands, also asserted against package.json by scripts/packaging.test.ts. */
export const COMMANDS: Record<string, () => Promise<void>> = {
  preflight,
  "dry-run": dryRun,
  cut,
  publish,
  verify,
};

if (import.meta.main) {
  const name = process.argv[2];
  const command = name ? COMMANDS[name] : undefined;

  if (!command) {
    console.error(`Usage: bun run ./scripts/release.ts <${Object.keys(COMMANDS).join("|")}>`);
    process.exit(1);
  }

  await command();
}
