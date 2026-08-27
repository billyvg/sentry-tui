#!/usr/bin/env bun
/**
 * One command per step of a release, so nothing has to be reconstructed from
 * the runbook by hand.
 *
 *   bun run release:preflight   check readiness for the next minor
 *   bun run release:dry-run     build and package on CI, publish nothing
 *   bun run release:cut --minor cut from remote main and watch CI publish it
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
/** Longest `release:cut` will wait for CI before giving up. */
const CI_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
/** Gap between check-run polls: unnoticeable to a human, gentle on the API. */
const CI_POLL_MS = 15 * 1000;
/** Longest to wait for the tag-triggered Release run to appear. */
const RELEASE_RUN_WAIT_TIMEOUT_MS = 60 * 1000;
/** Release runs normally appear quickly; this keeps the lookup responsive. */
const RELEASE_RUN_POLL_MS = 2 * 1000;
const SEMVER_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/;
const VERSION_BUMPS = ["major", "minor", "patch"] as const;
type VersionBump = (typeof VERSION_BUMPS)[number];
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
  // Reject ambiguous selectors before making even a read-only network call.
  requestedReleaseVersion("0.0.0");
  const ghAuth = await capture(["gh", "auth", "status"]);
  if (ghAuth.code !== 0) die("gh: not authenticated — run `gh auth login`");
  const source = await remoteReleaseSource();
  const version = requestedReleaseVersion(source.version);
  let blocking = 0;

  step(`Preflight for v${version} from ${source.branch}@${source.head.slice(0, 7)}`);

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
    // Not blocking: CI publishes over OIDC, so a local login only matters
    // for `release:publish`.
    warn(
      `npm: not logged in to ${REGISTRY} — \`npm login --registry ${REGISTRY}\`, needed only for a manual publish`,
    );
  } else if (npmUser.out !== "billyvg") {
    warn(`npm: logged in as ${npmUser.out}, expected billyvg`);
  } else {
    ok(`npm: logged in as ${npmUser.out}`);
  }

  ok("gh: authenticated");

  // CI authenticates over OIDC, so a token is a fallback rather than a
  // requirement. Its absence is the healthy state; its presence is worth a
  // word, because a token guarded by 2FA is answered with EOTP and there is no
  // prompt an unattended job can satisfy. npm exposes no way to read a
  // package's trusted-publisher config, so this cannot be checked from here —
  // npmjs.com is the only place that knows.
  const secrets = await capture(["gh", "secret", "list", "--repo", REPOSITORY]);
  if (secrets.out.includes("NPM_TOKEN")) {
    warn("NPM_TOKEN secret is set — a fallback, unread wherever a trusted publisher exists");
  } else {
    ok("no NPM_TOKEN secret — CI publishes over OIDC");
  }

  // The registry is the authority on whether these names are still ours to take.
  for (const name of [ALIAS_PACKAGE, LAUNCHER_PACKAGE]) {
    const { latest, targetPublished } = await releasePackageStatus(name, version);
    if (targetPublished) {
      bad(`${name}@${version} is already published — choose another version`);
      blocking++;
    } else if (!latest) {
      ok(`${name}: unpublished, name is free`);
    } else {
      ok(`${name}: latest is ${latest}, publishing ${version}`);
    }
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

/** Resolve an exact version or increment from the version in package.json. */
export function resolveReleaseVersion(
  current: string,
  requested: readonly string[],
  bumps: readonly VersionBump[],
): string {
  if (requested.length > 1) throw new Error("pass at most one exact version");
  if (bumps.length > 1) throw new Error("choose one of --major, --minor, or --patch");
  if (requested.length > 0 && bumps.length > 0) {
    throw new Error("pass an exact version or a bump flag, not both");
  }
  if (requested[0]) return requested[0];

  const match = current.match(SEMVER_VERSION);
  if (!match) throw new Error(`"${current}" is not a semver version`);

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const bump = bumps[0] ?? "minor";

  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Collect every version bump selector from argv, including duplicates. */
function requestedVersionBumps(args: readonly string[]): VersionBump[] {
  return args.flatMap((arg) => {
    const bump = VERSION_BUMPS.find((candidate) => arg === `--${candidate}`);
    return bump ? [bump] : [];
  });
}

/** Resolve the release target requested on the command line. */
function requestedReleaseVersion(current: string): string {
  let version: string;
  try {
    version = resolveReleaseVersion(
      current,
      positionals,
      requestedVersionBumps(process.argv.slice(3)),
    );
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  if (!SEMVER_VERSION.test(version)) {
    die(`"${version}" is not a semver version — try an exact version such as 0.2.0`);
  }
  return version;
}

/** The exact default-branch state a remote release starts from. */
interface RemoteReleaseSource {
  branch: string;
  head: string;
  manifest: string;
  version: string;
}

/** Read package.json and the default branch head from GitHub, never local Git. */
async function remoteReleaseSource(): Promise<RemoteReleaseSource> {
  const repository = await capture(["gh", "api", `repos/${REPOSITORY}`, "--jq", ".default_branch"]);
  if (repository.code !== 0 || !repository.out) die(`could not read ${REPOSITORY}`);
  const branch = repository.out;

  const ref = await capture([
    "gh",
    "api",
    `repos/${REPOSITORY}/git/ref/heads/${branch}`,
    "--jq",
    ".object.sha",
  ]);
  if (ref.code !== 0 || !ref.out) die(`could not read ${REPOSITORY}'s ${branch} head`);

  const file = await capture([
    "gh",
    "api",
    `repos/${REPOSITORY}/contents/package.json?ref=${ref.out}`,
  ]);
  if (file.code !== 0 || !file.out) die(`could not read package.json from ${branch}`);

  let manifest: string;
  let version: unknown;
  try {
    const encoded = (JSON.parse(file.out) as { content?: string }).content;
    if (!encoded) throw new Error("package.json has no content");
    manifest = Buffer.from(encoded.replaceAll("\n", ""), "base64").toString();
    version = (JSON.parse(manifest) as { version?: unknown }).version;
  } catch (error) {
    die(`could not decode package.json from ${branch}: ${String(error)}`);
  }
  if (typeof version !== "string") die(`package.json on ${branch} has no version`);

  return { branch, head: ref.out, manifest, version };
}

/** Change only package.json's top-level version field. */
export function bumpManifestVersion(manifest: string, current: string, version: string): string {
  if (current === version) return manifest;
  const bumped = manifest.replace(`"version": "${current}"`, `"version": "${version}"`);
  if (bumped === manifest) throw new Error("could not find the version field in package.json");
  return bumped;
}

/** Commit a bumped package.json straight to GitHub's current default-branch head. */
async function createReleaseCommit(
  source: RemoteReleaseSource,
  manifest: string,
  version: string,
): Promise<string> {
  const mutation = `
    mutation(
      $repository: String!
      $branch: String!
      $head: GitObjectID!
      $message: String!
      $path: String!
      $contents: Base64String!
    ) {
      createCommitOnBranch(input: {
        branch: { repositoryNameWithOwner: $repository, branchName: $branch }
        expectedHeadOid: $head
        message: { headline: $message }
        fileChanges: { additions: [{ path: $path, contents: $contents }] }
      }) {
        commit { oid }
      }
    }
  `;
  const commit = await capture([
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-f",
    `repository=${REPOSITORY}`,
    "-f",
    `branch=${source.branch}`,
    "-f",
    `head=${source.head}`,
    "-f",
    `message=chore: release v${version}`,
    "-f",
    "path=package.json",
    "-f",
    `contents=${Buffer.from(manifest).toString("base64")}`,
    "--jq",
    ".data.createCommitOnBranch.commit.oid",
  ]);
  if (commit.code !== 0 || !commit.out) {
    die(
      `could not create the release commit on ${source.branch} — ` +
        "the branch may have moved; re-run release:cut",
    );
  }
  return commit.out;
}

/** Dispatch the remote release workflow with enough identity to find its run. */
async function dispatchRelease(version: string, commit: string, requestId: string): Promise<void> {
  const dispatched = await capture([
    "gh",
    "api",
    "--method",
    "POST",
    `repos/${REPOSITORY}/dispatches`,
    "-f",
    "event_type=release_cut",
    "-f",
    `client_payload[version]=${version}`,
    "-f",
    `client_payload[sha]=${commit}`,
    "-f",
    `client_payload[request_id]=${requestId}`,
    "--silent",
  ]);
  if (dispatched.code !== 0) die("could not dispatch the Release workflow");
}

/** Wait until a uniquely identified dispatch materializes as a Release run. */
async function releaseRunFor(requestId: string): Promise<string> {
  const deadline = Date.now() + RELEASE_RUN_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const list = await capture([
      "gh",
      "run",
      "list",
      "--repo",
      REPOSITORY,
      "--workflow",
      WORKFLOW,
      "--event",
      "repository_dispatch",
      "--limit",
      "20",
      "--json",
      "databaseId,displayTitle",
    ]);
    if (list.code === 0) {
      const entry = (
        JSON.parse(list.out || "[]") as { databaseId: number; displayTitle: string }[]
      ).find((run) => run.displayTitle.includes(`[${requestId}]`));
      if (entry) return String(entry.databaseId);
    }
    await Bun.sleep(RELEASE_RUN_POLL_MS);
  }
  die(`Release run ${requestId} did not appear — check \`gh run list\``);
}

/** Cut from GitHub's default branch, tag it remotely, and watch CI publish it. */
async function cut(): Promise<void> {
  // Reject ambiguous selectors before making even a read-only network call.
  requestedReleaseVersion("0.0.0");
  if (process.argv.includes("--check")) {
    die("--check no longer applies — the Release workflow validates the remote commit");
  }

  const source = await remoteReleaseSource();
  const version = requestedReleaseVersion(source.version);
  let manifest: string;
  try {
    manifest = bumpManifestVersion(source.manifest, source.version, version);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  const existingTag = await capture([
    "gh",
    "api",
    `repos/${REPOSITORY}/git/ref/tags/v${version}`,
    "--silent",
  ]);
  if (existingTag.code === 0) die(`tag v${version} already exists`);

  if (flags.force) warn("--force: releasing without checking CI");
  else await requireGreenCi(source.head);

  step(`Releasing v${version} from GitHub`);
  console.log(`  ${REPOSITORY} ${source.branch}@${source.head.slice(0, 7)}`);
  if (version === source.version) console.log(`  tag the existing v${version} manifest`);
  else console.log(`  commit package.json ${source.version} → ${version}, then tag v${version}`);
  console.log(`  CI then builds ${RELEASE_TARGETS.length} binaries and publishes:`);
  for (const name of PUBLISH_ORDER) console.log(`    ${name}@${version}`);
  check(`\nRelease v${version}? This publishes to npm.`);

  let releaseCommit = source.head;
  if (version !== source.version) {
    step(`Committing ${source.version} → ${version} on ${source.branch}`);
    releaseCommit = await createReleaseCommit(source, manifest, version);
    ok(`${source.branch} is now ${releaseCommit.slice(0, 7)}`);
  }

  const requestId = crypto.randomUUID();
  step("Triggering the Release workflow");
  await dispatchRelease(version, releaseCommit, requestId);

  step("Waiting for the Release run");
  const runId = await releaseRunFor(requestId);
  step(`Watching Release run ${runId}`);
  await run(["gh", "run", "watch", runId, "--repo", REPOSITORY, "--exit-status"]);

  console.log(`\n${green(`Released v${version}.`)}`);
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

/** Read both npm's latest version and whether the exact release target exists. */
export async function releasePackageStatus(
  name: string,
  version: string,
  lookup: (spec: string) => Promise<string | undefined> = publishedVersion,
): Promise<{ latest: string | undefined; targetPublished: boolean }> {
  const [latest, target] = await Promise.all([lookup(name), lookup(`${name}@${version}`)]);
  return { latest, targetPublished: target === version };
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
  // `--version` rather than `--help`: it proves everything `--help` would —
  // the launcher resolved a binary, and that binary runs — and additionally
  // that the bytes npm just served are the ones cut, since the string is
  // inlined from package.json at compile time. Help text is identical in
  // every build ever published, so it cannot tell a stale cache or a
  // mismatched optional dependency from the real thing.
  const expected = `sentry-tui v${version}`;
  const npx = await capture([
    "npx",
    "--yes",
    "--registry",
    REGISTRY,
    `${ALIAS_PACKAGE}@${version}`,
    "--version",
  ]);
  const printed = npx.out.trim();
  if (npx.code !== 0) bad(`npx failed (exit ${npx.code})`);
  else if (printed === expected) ok(`npx runs ${printed}`);
  else bad(`npx printed ${JSON.stringify(printed)}, expected ${JSON.stringify(expected)}`);
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
