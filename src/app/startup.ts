import { type AuthProvider, MissingTokenError, resolveAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import {
  configPath,
  credentialsPath,
  migrateLegacyToken,
  normalizeProjectsByOrg,
  readConfig,
  readCredentials,
  writeConfig,
} from "~/api/config";
import { listOrganizations } from "~/api/issues";
import { autoLogin, type LoginOptions } from "~/app/login";
import { identify, traceStartupStep } from "~/telemetry/index";
import * as readline from "node:readline";

export interface AppContext {
  client: SentryClient;
  org: string;
  tokenSource: string;
  projectsByOrg: Record<string, string[]>;
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

export const COMMANDS = ["run", "login", "logout", "status"] as const;
export type Command = (typeof COMMANDS)[number];

export interface CliArgs {
  command: Command;
  org?: string;
  help: boolean;
  /** Print the version and exit, without touching credentials. */
  version: boolean;
  /** Print the login URL instead of launching a browser, wherever we log in. */
  noBrowser: boolean;
}

const isCommand = (value: string | undefined): value is Command =>
  COMMANDS.includes(value as Command);

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: "run", help: false, version: false, noBrowser: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--version" || arg === "-v") args.version = true;
    else if (arg === "--no-browser") args.noBrowser = true;
    else if (arg === "--org" || arg === "-o") {
      // Only take the next token as the value — never swallow the flag after it.
      if (argv[i + 1] && !argv[i + 1]!.startsWith("-")) args.org = argv[++i];
    } else if (isCommand(arg)) args.command = arg;
  }
  return args;
}

export const HELP_TEXT = `sentry-tui — sentry.io in your terminal

Usage:
  sentry-tui [--org <slug>]        Open the TUI
  sentry-tui login [--no-browser]  Sign in again, or switch accounts
  sentry-tui logout                Forget the stored credentials
  sentry-tui status                Show who you're signed in as

Options:
  -o, --org <slug>   Organization to open (or set SENTRY_ORG)
      --no-browser   Print the login URL instead of opening a browser
  -h, --help         Show this help
  -v, --version      Show the version

Environment:
  SENTRY_AUTH_TOKEN    Personal auth token, used ahead of any stored login
  SENTRY_ORG           Default organization slug
  SENTRY_CLIENT_ID     OAuth application to log in through (self-hosted)
  SENTRY_URL           Sentry install to talk to (default https://sentry.io)
  SENTRY_TUI_LATENCY   Artificial request delay in ms, for testing
  SENTRY_TUI_NO_TELEMETRY=1  Stop sentry-tui reporting its own crashes

Files:
  ${configPath()}       preferences (organization and project selections)
  ${credentialsPath()}  credentials, written owner-readable only
`;

/**
 * Relocate a token an older build left in the preferences file. Runs ahead of
 * every command — `status` and `logout` should see the same credentials the
 * app does.
 */
export async function migrateLegacyCredentials(): Promise<void> {
  if (!(await migrateLegacyToken())) return;
  process.stderr.write(
    `Moved your token out of ${configPath()} into ${credentialsPath()} (owner-readable only).\n`,
  );
}

/**
 * Find credentials, running the device flow on the spot when there are none.
 * `autoLogin` declines only when there is no terminal to log in from, and then
 * the original error stands.
 */
async function resolveCredentials(options: LoginOptions = {}): Promise<AuthProvider> {
  try {
    return await resolveAuthProvider();
  } catch (error) {
    if (!(error instanceof MissingTokenError)) throw error;
    if (!(await autoLogin(options))) throw error;
    return await resolveAuthProvider();
  }
}

/**
 * Resolve everything the UI needs before the renderer starts, so credential
 * problems print as plain text instead of flashing inside an alternate screen.
 */
export async function bootstrap(args: CliArgs): Promise<AppContext> {
  const config = await readConfig();

  const auth = await traceStartupStep("resolve credentials", async () => {
    const provider = await resolveCredentials({ noBrowser: args.noBrowser });
    // Surface a missing or unrenewable token now rather than mid-render.
    await provider.getToken();
    return provider;
  });

  let org = args.org ?? process.env["SENTRY_ORG"] ?? config.org;

  const client = new SentryClient({ auth });

  if (!org) {
    org = await traceStartupStep("resolve organization", () => promptForOrg(client));
  }

  // Who this is, for the crash reports. An OAuth login already stored the
  // account, so this costs no request; an environment-token user has no stored
  // account and is known only by the organization they opened.
  identify({ user: (await readCredentials())?.user, org });

  return {
    client,
    org,
    tokenSource: auth.describe(),
    projectsByOrg: normalizeProjectsByOrg(config.projectsByOrg),
  };
}

export { MissingTokenError };
