import type { StoredCredentials } from "~/api/config";

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) against Sentry.
 *
 * This module speaks the protocol and nothing else: no storage, no printing,
 * no prompts. `src/app/login.ts` drives it and owns the user interaction.
 *
 * Sentry's endpoints live at the site root, not under `/api/0`:
 *   POST {site}/oauth/device/code/   → device_code + user_code
 *   POST {site}/oauth/token/         → poll, then refresh
 */

export const DEFAULT_SITE_URL = "https://sentry.io";

/**
 * The public OAuth application `sentry-tui` polls as. Public clients (RFC 6749
 * §2.1) carry no secret, so shipping this in the binary is by design.
 * Self-hosted installs override it with `SENTRY_CLIENT_ID`.
 */
export const DEFAULT_CLIENT_ID = "";

/** Scopes the TUI requests — the same set a personal token needs. */
export const REQUIRED_SCOPES = [
  "org:read",
  "project:read",
  "event:read",
  "event:write",
  "member:read",
  "team:read",
] as const;

/** Grant type identifier from RFC 8628 §3.4. */
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** RFC 8628 §3.5: each `slow_down` adds five seconds to the poll interval. */
const SLOW_DOWN_INCREMENT_SECONDS = 5;

export const APPLICATION_SETTINGS_URL = "https://sentry.io/settings/account/api/applications/";

/** An `error` code the OAuth endpoints returned, per RFC 6749 §5.2. */
export class OAuthError extends Error {
  readonly code: string;

  constructor(code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
    this.name = "OAuthError";
    this.code = code;
  }
}

/** The stored grant is gone — only a fresh `sentry-tui login` fixes this. */
export class ReauthRequiredError extends Error {
  constructor(reason: string) {
    super([reason, "", "Run `sentry-tui login` to sign in again."].join("\n"));
    this.name = "ReauthRequiredError";
  }
}

export class MissingClientIdError extends Error {
  constructor() {
    super(
      [
        "No OAuth client ID configured, so the device flow can't start.",
        "",
        `Create a public OAuth application at ${APPLICATION_SETTINGS_URL}`,
        '(tick "Public Client" — a CLI cannot keep a secret), then:',
        "",
        "  export SENTRY_CLIENT_ID=<client id>",
        "",
        "Or skip OAuth entirely and use a personal token — see `sentry-tui --help`.",
      ].join("\n"),
    );
    this.name = "MissingClientIdError";
  }
}

/** `SENTRY_URL` wins, then whatever the stored credentials were issued by. */
export function resolveSiteUrl(stored?: string): string {
  const url = process.env["SENTRY_URL"]?.trim() || stored?.trim() || DEFAULT_SITE_URL;
  return url.replace(/\/+$/, "");
}

/** `SENTRY_CLIENT_ID` wins, then the app the stored token came from. */
export function resolveClientId(stored?: string): string {
  const clientId = process.env["SENTRY_CLIENT_ID"]?.trim() || stored?.trim() || DEFAULT_CLIENT_ID;
  if (!clientId) throw new MissingClientIdError();
  return clientId;
}

export interface DeviceCode {
  deviceCode: string;
  /** Shown to the user, formatted `XXXX-XXXX`. */
  userCode: string;
  verificationUri: string;
  /** Same page with the code pre-filled — what we open in a browser. */
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

interface Transport {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface Endpoint extends Transport {
  siteUrl: string;
  clientId: string;
}

async function postForm(
  url: string,
  form: Record<string, string>,
  { fetchImpl = fetch, signal }: Transport,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OAuthError(
      "network_error",
      error instanceof Error ? error.message : "request failed",
    );
  }

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new OAuthError("invalid_response", `HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return { status: response.status, body };
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function toOAuthError(body: Record<string, unknown>, status: number): OAuthError {
  const code = str(body["error"]) ?? `http_${status}`;
  return new OAuthError(code, str(body["error_description"]));
}

/** RFC 8628 §3.1 — ask for a device code and the code the user will type. */
export async function requestDeviceCode({
  siteUrl,
  clientId,
  scopes = REQUIRED_SCOPES,
  ...transport
}: Endpoint & { scopes?: readonly string[] }): Promise<DeviceCode> {
  const { status, body } = await postForm(
    `${siteUrl}/oauth/device/code/`,
    { client_id: clientId, scope: scopes.join(" ") },
    transport,
  );

  if (status !== 200) throw toOAuthError(body, status);

  const deviceCode = str(body["device_code"]);
  const userCode = str(body["user_code"]);
  const verificationUri = str(body["verification_uri"]);
  if (!deviceCode || !userCode || !verificationUri) {
    throw new OAuthError("invalid_response", "device authorization response was incomplete");
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: str(body["verification_uri_complete"]) ?? verificationUri,
    expiresInSeconds: num(body["expires_in"]) ?? 600,
    intervalSeconds: num(body["interval"]) ?? 5,
  };
}

export interface PollOptions extends Endpoint {
  device: DeviceCode;
  /** Injected in tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called when the server asks us to back off, for a status line. */
  onSlowDown?: (intervalSeconds: number) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * RFC 8628 §3.4/§3.5 — poll the token endpoint until the user approves.
 *
 * Resolves with credentials on approval; throws {@link OAuthError} with code
 * `access_denied` or `expired_token` when the user says no or takes too long.
 */
export async function pollForDeviceToken({
  siteUrl,
  clientId,
  device,
  sleep = realSleep,
  now = Date.now,
  onSlowDown,
  ...transport
}: PollOptions): Promise<StoredCredentials> {
  const deadline = now() + device.expiresInSeconds * 1000;
  let intervalSeconds = device.intervalSeconds;

  while (true) {
    await sleep(intervalSeconds * 1000);
    if (transport.signal?.aborted) throw new OAuthError("aborted", "login cancelled");

    const { status, body } = await postForm(
      `${siteUrl}/oauth/token/`,
      { grant_type: DEVICE_CODE_GRANT, device_code: device.deviceCode, client_id: clientId },
      transport,
    );

    if (status === 200) {
      return credentialsFromTokenResponse(body, { clientId, siteUrl, now });
    }

    const code = str(body["error"]);
    if (code === "authorization_pending") {
      // Keep waiting — the user hasn't finished in the browser yet.
    } else if (code === "slow_down") {
      intervalSeconds += SLOW_DOWN_INCREMENT_SECONDS;
      onSlowDown?.(intervalSeconds);
    } else {
      throw toOAuthError(body, status);
    }

    if (now() >= deadline) {
      throw new OAuthError("expired_token", "the code expired before it was approved");
    }
  }
}

/**
 * RFC 6749 §6 — trade the refresh token for a new access token.
 *
 * Sentry rotates both tokens on every refresh, so the result must be persisted
 * or the next refresh fails with `invalid_grant`.
 */
export async function refreshAccessToken({
  siteUrl,
  clientId,
  refreshToken,
  now = Date.now,
  ...transport
}: Endpoint & { refreshToken: string; now?: () => number }): Promise<StoredCredentials> {
  const { status, body } = await postForm(
    `${siteUrl}/oauth/token/`,
    { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId },
    transport,
  );

  if (status !== 200) {
    const error = toOAuthError(body, status);
    // The grant is gone (rotated, revoked, or the app was deactivated).
    if (error.code === "invalid_grant" || error.code === "invalid_client") {
      throw new ReauthRequiredError("Your Sentry login is no longer valid.");
    }
    throw error;
  }

  return credentialsFromTokenResponse(body, { clientId, siteUrl, now });
}

/**
 * Map a token endpoint response onto stored credentials.
 *
 * `expires_in` is preferred over the absolute `expires_at` the server also
 * sends: relative seconds can't be thrown off by clock skew between us and it.
 */
export function credentialsFromTokenResponse(
  body: Record<string, unknown>,
  { clientId, siteUrl, now = Date.now }: { clientId: string; siteUrl: string; now?: () => number },
): StoredCredentials {
  const accessToken = str(body["access_token"]);
  if (!accessToken) throw new OAuthError("invalid_response", "token response had no access_token");

  const expiresIn = num(body["expires_in"]);
  const scope = str(body["scope"]);
  const user = (body["user"] ?? {}) as Record<string, unknown>;

  return {
    accessToken,
    refreshToken: str(body["refresh_token"]),
    expiresAt:
      expiresIn !== undefined
        ? new Date(now() + expiresIn * 1000).toISOString()
        : parseInstant(body["expires_at"]),
    scopes: scope ? scope.split(" ").filter(Boolean) : undefined,
    clientId,
    siteUrl,
    user: { id: str(user["id"]), name: str(user["name"]), email: str(user["email"]) },
  };
}

function parseInstant(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
