import { createTokenAuthProvider, MissingTokenError, readConfig, writeConfig } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { listOrganizations } from "~/api/issues";
import * as readline from "node:readline";

export interface AppContext {
  client: SentryClient;
  org: string;
  tokenSource: string;
}

export class MissingOrgError extends Error {
  constructor() {
    super(
      [
        "No Sentry organization configured.",
        "",
        "Pass one with --org <slug>, or set SENTRY_ORG.",
      ].join("\n"),
    );
    this.name = "MissingOrgError";
  }
}

/**
 * Prompt the user to pick one of their Sentry organizations interactively.
 * Returns the selected org slug, or throws if the user cancels.
 */
async function promptForOrg(client: SentryClient): Promise<string> {
  process.stderr.write("No default organization configured.\n\n");
  process.stderr.write("Fetching your organizations…\n");

  let orgs: Awaited<ReturnType<typeof listOrganizations>>;
  try {
    orgs = await listOrganizations(client);
  } catch (err) {
    throw new Error(
      `Failed to fetch organizations: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (orgs.length === 0) {
    throw new Error("No organizations found for this token. Check your auth token scopes.");
  }

  if (orgs.length === 1) {
    const org = orgs[0]!;
    process.stderr.write(`\nFound one organization: ${org.name} (${org.slug})\n`);
    await writeConfig({ org: org.slug });
    process.stderr.write(`Saved as default org. You can change it later in the config file.\n\n`);
    return org.slug;
  }

  process.stderr.write("\nYour organizations:\n");
  for (let i = 0; i < orgs.length; i++) {
    const o = orgs[i]!;
    process.stderr.write(`  ${i + 1}) ${o.name} (${o.slug})\n`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question("\nSelect an organization [number]: ", resolve);
  });
  rl.close();

  const index = Number.parseInt(answer.trim(), 10) - 1;
  if (Number.isNaN(index) || index < 0 || index >= orgs.length) {
    throw new Error("Invalid selection. Run again to retry.");
  }

  const selected = orgs[index]!;
  await writeConfig({ org: selected.slug });
  process.stderr.write(`\nSaved "${selected.slug}" as default org.\n\n`);
  return selected.slug;
}

export interface CliArgs {
  org?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    if (arg === "--org" || arg === "-o") args.org = argv[++i];
  }
  return args;
}

export const HELP_TEXT = `sentry-tui — sentry.io in your terminal

Usage:
  sentry-tui [--org <slug>]

Options:
  -o, --org <slug>   Organization to open (or set SENTRY_ORG)
  -h, --help         Show this help

Environment:
  SENTRY_AUTH_TOKEN    Personal auth token (see README for scopes)
  SENTRY_ORG           Default organization slug
  SENTRY_TUI_LATENCY   Artificial request delay in ms, for testing
`;

/**
 * Resolve everything the UI needs before the renderer starts, so credential
 * problems print as plain text instead of flashing inside an alternate screen.
 */
export async function bootstrap(args: CliArgs): Promise<AppContext> {
  const config = await readConfig();
  const auth = createTokenAuthProvider(config);

  // Surface a missing token now rather than as a failed request later.
  await auth.getToken();

  let org = args.org ?? process.env["SENTRY_ORG"] ?? config.org;

  const client = new SentryClient({ auth });

  if (!org) {
    org = await promptForOrg(client);
  }

  return { client, org, tokenSource: auth.describe() };
}

export { MissingTokenError };
