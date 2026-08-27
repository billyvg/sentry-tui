#!/usr/bin/env bun
/**
 * `bun run demo:seer-prep` — get the default org ready to record the Seer act.
 *
 * Seer only answers for orgs where the Explorer agent is actually enabled, so
 * the demo's Seer act is the one part that can't be recorded against just any
 * account. Rather than discover that mid-take, this picks the org the demo will
 * open on and proves Seer responds for it first.
 *
 *   bun run demo:seer-prep                    # report on the current default org
 *   bun run demo:seer-prep --org acme-prod    # make that org the default, then probe
 *   bun run demo:seer-prep --list             # just list the orgs you can pick from
 *   bun run demo:seer-prep --no-probe         # skip the live query
 *   bun run demo:seer-prep --query "…"        # probe with your own question
 *
 * The probe is a real Seer run against a real org — one question, and the
 * answer is printed so you can judge whether it's worth putting on camera.
 * `--no-probe` skips it.
 */

import { resolveAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { readConfig, writeConfig } from "@sentry-tui/runtime-host/config/index";
import { listOrganizations } from "~/api/issues";
import {
  getSeerSession,
  isSessionSettled,
  sendSeerMessage,
  SEER_POLL_INTERVAL_MS,
  type SeerSession,
} from "~/api/seer";

/** Give up on a probe that never settles, so this can't hang a prep step. */
const PROBE_TIMEOUT_MS = 90_000;

/**
 * The default probe.
 *
 * Deliberately a question the agent can answer from the org's own data, since
 * "Seer replied" and "Seer replied usefully" are different results and only the
 * second one is worth recording.
 */
const DEFAULT_QUERY = "What are the most common errors in this organization right now?";

interface Args {
  org?: string;
  query: string;
  probe: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { query: DEFAULT_QUERY, probe: true, list: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--org" && argv[i + 1]) args.org = argv[++i];
    else if (flag === "--query" && argv[i + 1]) args.query = argv[++i]!;
    else if (flag === "--no-probe") args.probe = false;
    else if (flag === "--list") args.list = true;
    else if (flag === "--help" || flag === "-h") {
      console.log(
        "Usage: bun run demo:seer-prep [--org <slug>] [--list] [--no-probe] [--query <text>]",
      );
      process.exit(0);
    } else if (flag) {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

/** Flatten a settled session into what the agent actually said. */
function answerOf(session: SeerSession): string {
  const spoken = session.blocks
    .filter((block) => block.message.role === "assistant")
    .map((block) => block.message.content?.trim())
    .filter((content): content is string => Boolean(content));
  return spoken.join("\n\n");
}

/** Intermediate steps, so a slow probe shows its work rather than just hanging. */
function stepsOf(session: SeerSession): string[] {
  return session.blocks
    .filter((block) => block.message.role === "tool_use")
    .map((block) => block.message.content?.trim() ?? "")
    .filter(Boolean);
}

const args = parseArgs(Bun.argv.slice(2));

const auth = await resolveAuthProvider();
const client = new SentryClient({ auth });

const config = await readConfig();
const orgs = await listOrganizations(client);

if (orgs.length === 0) {
  console.error("This account isn't a member of any organization.");
  process.exit(1);
}

if (args.org && !orgs.some((org) => org.slug === args.org)) {
  console.error(
    `No organization "${args.org}" on this account. Available:\n` +
      orgs.map((org) => `  ${org.slug}`).join("\n"),
  );
  process.exit(1);
}

// `--org` writes the stored default, which is what the app falls back to and
// therefore what the recording will open on.
if (args.org && args.org !== config.org) {
  await writeConfig({ org: args.org });
  console.log(`Default org is now "${args.org}" (was ${config.org ?? "unset"}).`);
}

const target = args.org ?? config.org;

console.log("\nOrganizations on this account:");
for (const org of orgs) {
  console.log(`  ${org.slug === target ? "▸" : " "} ${org.slug}`);
}

if (!target) {
  console.error("\nNo default org is set. Pick one with:\n  bun run demo:seer-prep --org <slug>");
  process.exit(1);
}

console.log(`\nThe demo will record against "${target}".`);
console.log("Override for a single run with SENTRY_ORG, or change it with --org.");

if (args.list || !args.probe) {
  if (!args.probe) console.log("\nSkipping the live Seer probe (--no-probe).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live probe
// ---------------------------------------------------------------------------

console.log(`\nAsking Seer: "${args.query}"`);

let runId;
try {
  runId = await sendSeerMessage(client, {
    org: target,
    query: args.query,
    pageName: "demo:seer-prep",
  });
} catch (error) {
  console.error(
    `\nSeer refused the request for "${target}":\n  ${error instanceof Error ? error.message : String(error)}\n\n` +
      `That usually means the Explorer agent isn't enabled for this org. Pick a\n` +
      `production org that has it and re-run:\n  bun run demo:seer-prep --org <slug>`,
  );
  process.exit(1);
}

console.log(`Run ${runId} started; polling…`);

const deadline = Date.now() + PROBE_TIMEOUT_MS;
let session: SeerSession | null = null;
let reported = 0;

while (Date.now() < deadline) {
  session = await getSeerSession(client, { org: target, runId });

  const steps = session ? stepsOf(session) : [];
  for (const step of steps.slice(reported)) console.log(`  · ${step}`);
  reported = steps.length;

  if (isSessionSettled(session)) break;
  await Bun.sleep(SEER_POLL_INTERVAL_MS);
}

if (!session) {
  console.error("\nThe run disappeared before it settled. Try again.");
  process.exit(1);
}

if (!isSessionSettled(session)) {
  console.error(
    `\nSeer was still working after ${PROBE_TIMEOUT_MS / 1000}s (status: ${session.status}).\n` +
      `It may just be slow — but a Seer this slow will be a long silence on camera.`,
  );
  process.exit(1);
}

if (session.status === "error") {
  console.error(`\nThe run finished with status "error". This org isn't ready to record.`);
  process.exit(1);
}

const answer = answerOf(session);
console.log(`\n--- Seer answered ---\n${answer || "(nothing)"}\n---------------------`);
console.log(
  `\n"${target}" is ready to record.\n` +
    `Judge the answer above before committing to it — the demo holds on Seer's reply,\n` +
    `so a thin one is a thin beat. Change the question the tape asks in demos/demo.tape.`,
);
