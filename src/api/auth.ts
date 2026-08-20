import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The seam between the app and however a token was obtained. v1 reads a
 * personal token; an OAuth device flow can be added later without touching a
 * single call site.
 */
export interface AuthProvider {
  getToken(): Promise<string>;
  /** Human-readable source, for `--version`-style output and error messages. */
  describe(): string;
}

export const CONFIG_DIR = join(homedir(), ".config", "sentry-tui");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/** Scopes a personal token needs for everything the TUI does. */
export const REQUIRED_SCOPES = [
  "org:read",
  "project:read",
  "event:read",
  "event:write",
  "member:read",
  "team:read",
] as const;

export const TOKEN_SETTINGS_URL = "https://sentry.io/settings/account/api/auth-tokens/";

export class MissingTokenError extends Error {
  constructor() {
    super(
      [
        "No Sentry auth token found.",
        "",
        `Create a personal token at ${TOKEN_SETTINGS_URL}`,
        `with scopes: ${REQUIRED_SCOPES.join(" ")}`,
        "",
        "Then either:",
        "  export SENTRY_AUTH_TOKEN=sntryu_…",
        `  or write {"token": "sntryu_…"} to ${CONFIG_PATH}`,
      ].join("\n"),
    );
    this.name = "MissingTokenError";
  }
}

export interface StoredConfig {
  token?: string;
  org?: string;
}

export async function readConfig(): Promise<StoredConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (!(await file.exists())) return {};
    return (await file.json()) as StoredConfig;
  } catch {
    // A corrupt config shouldn't be fatal — fall back to env vars.
    return {};
  }
}

/**
 * Resolution order matches `getsentry/cli`: SENTRY_AUTH_TOKEN wins over the
 * legacy SENTRY_TOKEN, and the stored config is the last resort. Blank or
 * whitespace-only values count as unset.
 */
export function createTokenAuthProvider(config: StoredConfig = {}): AuthProvider {
  const fromEnv = (name: string) => {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
  };

  // Labels are shown in error messages, so they name the source without
  // leaking an absolute path from the user's home directory.
  const sources: Array<{ token: string | undefined; label: string }> = [
    { token: fromEnv("SENTRY_AUTH_TOKEN"), label: "$SENTRY_AUTH_TOKEN" },
    { token: fromEnv("SENTRY_TOKEN"), label: "$SENTRY_TOKEN" },
    { token: config.token?.trim() || undefined, label: "the config file" },
  ];

  const resolved = sources.find((s) => s.token);

  return {
    async getToken() {
      if (!resolved?.token) throw new MissingTokenError();
      return resolved.token;
    },
    describe() {
      return resolved?.label ?? "none";
    },
  };
}
