import { type AuthProvider, MissingTokenError, resolveAuthProvider } from "~/api/auth";
import { ApiError, SentryClient } from "~/api/client";
import {
  configPath,
  credentialsPath,
  migrateLegacyToken,
  normalizeBooleansByOrg,
  normalizeProjectsByOrg,
  normalizeSeerCodeModeByOrg,
  readConfig,
  readCredentials,
  writeConfig,
} from "@sentry-tui/runtime-host/config/index";
import { listOrganizations } from "~/api/issues";
import { autoLogin, type LoginOptions } from "@sentry-tui/runtime-host/startup/login";
import {
  parseSentryUrl,
  recordSentryUrlFailure,
  type SentryUrlFailure,
  type SentryUrlLocation,
} from "~/core/sentryUrl";
import { identify, traceStartupStep } from "@sentry-tui/runtime-host/telemetry/index";
import * as readline from "node:readline";

export interface AppContext {
  client: SentryClient;
  org: string;
  tokenSource: string;
  projectsByOrg: Record<string, string[]>;
  seerCodeModeByOrg: Record<string, "off" | "on" | "only">;
  seerBashModeByOrg: Record<string, boolean>;
  seerShowThinkingByOrg: Record<string, boolean>;
  user?: { id?: string; name?: string; email?: string };
  initialLocation?: SentryUrlLocation;
}

/** Expected CLI input failure, already counted and safe to print plainly. */
export class SentryUrlInputError extends Error {
  constructor(failure: SentryUrlFailure) {
    const prefix = failure.kind === "invalid" ? "Invalid Sentry URL" : "Not implemented";
    super(`${prefix}: ${failure.message}`);
    this.name = "SentryUrlInputError";
  }
}

/** Expected startup state when the authenticated token can see no organizations. */
export class MissingOrgError extends Error {
  constructor() {
    super("No organizations found for this token. Check your auth token scopes.");
    this.name = "MissingOrgError";
  }
}

/** Expected CLI input failure when the organization picker cannot use an answer. */
export class InvalidOrgSelectionError extends Error {
  constructor() {
    super("Invalid selection. Run again to retry.");
    this.name = "InvalidOrgSelectionError";
  }
}

export type StartupFailureKind =
  | "missing_credentials"
  | "missing_organizations"
  | "invalid_org_selection"
  | "handled_at_source"
  | "unexpected";

/** Decide whether a startup failure needs a metric, no action, or an error report. */
export function classifyStartupFailure(error: unknown): StartupFailureKind {
  if (error instanceof MissingTokenError) return "missing_credentials";
  if (error instanceof MissingOrgError) return "missing_organizations";
  if (error instanceof InvalidOrgSelectionError) return "invalid_org_selection";
  // URL failures count themselves at the parser, and the API client has
  // already applied its report-or-ignore policy based on the response status.
  if (error instanceof SentryUrlInputError || error instanceof ApiError) return "handled_at_source";
  return "unexpected";
}

/** Turn the picker answer into the zero-based organization index. */
export function parseOrgSelection(answer: string, organizationCount: number): number {
  const index = Number.parseInt(answer.trim(), 10) - 1;
  if (Number.isNaN(index) || index < 0 || index >= organizationCount) {
    throw new InvalidOrgSelectionError();
  }
  return index;
}

/**
 * Prompt the user to pick one of their Sentry organizations interactively.
 * Returns the selected org slug, or throws if the user cancels.
 */
async function promptForOrg(client: SentryClient): Promise<string> {
  process.stderr.write("No default organization configured.\n\n");
  process.stderr.write("Fetching your organizations…\n");

  const orgs = await listOrganizations(client);

  if (orgs.length === 0) {
    throw new MissingOrgError();
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

  const selected = orgs[parseOrgSelection(answer, orgs.length)]!;
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
  /** Production web URL to open after startup. */
  url?: string;
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
    else if (arg?.includes("://") && args.url === undefined) args.url = arg;
  }
  return args;
}

export const HELP_TEXT = `sentry-tui — sentry.io in your terminal

Usage:
  sentry-tui [--org <slug>]        Open the TUI
  sentry-tui <url> [--org <slug>]  Open a sentry.io URL in the TUI
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
  SENTRY_TUI_THEME     Color theme: auto, light, or dark (default auto)
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
export async function bootstrap(
  args: CliArgs,
  options: Pick<LoginOptions, "fetchImpl"> = {},
): Promise<AppContext> {
  const config = await readConfig();

  let initialLocation: SentryUrlLocation | undefined;
  if (args.url) {
    const result = parseSentryUrl(args.url);
    if (result.kind !== "location") {
      recordSentryUrlFailure(result, "cli");
      throw new SentryUrlInputError(result);
    }
    initialLocation = result.location;
    if (args.org && args.org !== initialLocation.org) {
      const failure: SentryUrlFailure = {
        kind: "invalid",
        reason: "organization_mismatch",
        message: `--org ${args.org} conflicts with organization ${initialLocation.org} in the URL.`,
      };
      recordSentryUrlFailure(failure, "cli");
      throw new SentryUrlInputError(failure);
    }
  }

  const auth = await traceStartupStep("resolve credentials", async () => {
    const provider = await resolveCredentials({ noBrowser: args.noBrowser, ...options });
    // Surface a missing or unrenewable token now rather than mid-render.
    await provider.getToken();
    return provider;
  });

  let org = initialLocation?.org ?? args.org ?? process.env["SENTRY_ORG"] ?? config.org;

  const client = new SentryClient({ auth, ...options });

  if (!org) {
    org = await traceStartupStep("resolve organization", () => promptForOrg(client));
  }

  // Who this is, for the crash reports. An OAuth login already stored the
  // account, so this costs no request; an environment-token user has no stored
  // account and is known only by the organization they opened.
  const user = (await readCredentials())?.user;
  identify({ user, org });

  return {
    client,
    org,
    tokenSource: auth.describe(),
    projectsByOrg: normalizeProjectsByOrg(config.projectsByOrg),
    seerCodeModeByOrg: normalizeSeerCodeModeByOrg(config.seerCodeModeByOrg),
    seerBashModeByOrg: normalizeBooleansByOrg(config.seerBashModeByOrg),
    seerShowThinkingByOrg: normalizeBooleansByOrg(config.seerShowThinkingByOrg),
    user,
    initialLocation,
  };
}

export { MissingTokenError };
