import {
  credentialsPath,
  readCredentials,
  type StoredCredentials,
  writeCredentials,
} from "~/api/config";
import {
  MissingClientIdError,
  REQUIRED_SCOPES,
  refreshAccessToken,
  resolveClientId,
  resolveSiteUrl,
} from "~/api/oauth";

/**
 * The seam between the app and however a token was obtained: an OAuth device
 * login, an environment variable, or a personal token on disk. Call sites only
 * ever see `getToken()`.
 */
export interface AuthProvider {
  getToken(): Promise<string>;
  /** Human-readable source, for `--version`-style output and error messages. */
  describe(): string;
  /**
   * Recover from a 401 by getting a new access token. Returns false when this
   * provider has nothing to refresh with, so the caller reports the original
   * failure instead of retrying.
   */
  refresh?(): Promise<boolean>;
}

export { REQUIRED_SCOPES };
export const TOKEN_SETTINGS_URL = "https://sentry.io/settings/account/api/auth-tokens/";

/** Refresh this long before expiry, so a request never races the deadline. */
const EXPIRY_SKEW_MS = 60_000;

export class MissingTokenError extends Error {
  constructor() {
    super(
      [
        "No Sentry credentials found.",
        "",
        "Sign in with:",
        "  sentry-tui login",
        "",
        "Or use a personal token instead — create one at",
        `${TOKEN_SETTINGS_URL}`,
        `with scopes: ${REQUIRED_SCOPES.join(" ")}`,
        "then either:",
        "  export SENTRY_AUTH_TOKEN=sntryu_…",
        `  or write {"accessToken": "sntryu_…"} to ${credentialsPath()}`,
      ].join("\n"),
    );
    this.name = "MissingTokenError";
  }
}

/** A token we hold outright: nothing to refresh, nothing to expire. */
export function createStaticAuthProvider(token: string, label: string): AuthProvider {
  return {
    async getToken() {
      return token;
    },
    describe() {
      return label;
    },
  };
}

/**
 * Resolution order matches `getsentry/cli`: SENTRY_AUTH_TOKEN wins over the
 * legacy SENTRY_TOKEN, and a stored token is the last resort. Blank or
 * whitespace-only values count as unset.
 */
export function createTokenAuthProvider(stored: { token?: string } = {}): AuthProvider {
  const fromEnv = (name: string) => {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
  };

  // Labels are shown in error messages, so they name the source without
  // leaking an absolute path from the user's home directory.
  const sources: Array<{ token: string | undefined; label: string }> = [
    { token: fromEnv("SENTRY_AUTH_TOKEN"), label: "$SENTRY_AUTH_TOKEN" },
    { token: fromEnv("SENTRY_TOKEN"), label: "$SENTRY_TOKEN" },
    { token: stored.token?.trim() || undefined, label: "the credentials file" },
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

export interface OAuthProviderOptions {
  credentials: StoredCredentials;
  /** Where rotated tokens go. Defaults to the credential file. */
  persist?: (credentials: StoredCredentials) => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * An OAuth access token that renews itself.
 *
 * Sentry rotates the refresh token on every use, so each refresh is persisted
 * immediately; losing the new pair would lock the user out. Concurrent callers
 * share one in-flight refresh — the client fires several requests at startup,
 * and a second refresh would invalidate the first one's result.
 */
export function createOAuthAuthProvider({
  credentials,
  persist = writeCredentials,
  fetchImpl,
  now = Date.now,
}: OAuthProviderOptions): AuthProvider {
  let current = credentials;
  let inFlight: Promise<void> | null = null;

  const expiresSoon = () => {
    if (!current.expiresAt) return false;
    const expiry = Date.parse(current.expiresAt);
    return !Number.isNaN(expiry) && expiry - now() <= EXPIRY_SKEW_MS;
  };

  const renew = async () => {
    const refreshToken = current.refreshToken;
    if (!refreshToken) throw new MissingTokenError();

    const updated = await refreshAccessToken({
      siteUrl: resolveSiteUrl(current.siteUrl),
      clientId: resolveClientId(current.clientId),
      refreshToken,
      fetchImpl,
      now,
    });
    // Keep fields the refresh response doesn't repeat, like the signed-in user.
    current = { ...current, ...updated };
    await persist(current);
  };

  const renewOnce = () => {
    inFlight ??= renew().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    async getToken() {
      if (current.refreshToken && expiresSoon()) await renewOnce();
      return current.accessToken;
    },
    describe() {
      return current.refreshToken ? "your sentry-tui login" : "the credentials file";
    },
    async refresh() {
      if (!current.refreshToken) return false;
      await renewOnce();
      return true;
    },
  };
}

/**
 * Pick the provider for however this machine is set up. Environment tokens win
 * so a one-off `SENTRY_AUTH_TOKEN=… sentry-tui` overrides a stored login.
 */
export async function resolveAuthProvider(
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AuthProvider> {
  const fromEnv = process.env["SENTRY_AUTH_TOKEN"]?.trim() || process.env["SENTRY_TOKEN"]?.trim();
  if (fromEnv) return createTokenAuthProvider();

  const credentials = await readCredentials();
  if (!credentials) throw new MissingTokenError();

  if (!credentials.refreshToken) {
    return createStaticAuthProvider(credentials.accessToken, "the credentials file");
  }

  return createOAuthAuthProvider({ credentials, fetchImpl: options.fetchImpl });
}

export { MissingClientIdError };
