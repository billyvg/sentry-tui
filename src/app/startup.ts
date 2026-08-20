import {
  createTokenAuthProvider,
  MissingTokenError,
  readConfig,
} from "~/api/auth";
import { SentryClient } from "~/api/client";

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

  const org = args.org ?? process.env["SENTRY_ORG"] ?? config.org;
  if (!org) throw new MissingOrgError();

  return { client: new SentryClient({ auth }), org, tokenSource: auth.describe() };
}

export { MissingTokenError };
