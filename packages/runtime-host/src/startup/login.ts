import {
  clearCredentials,
  credentialsPath,
  readConfig,
  readCredentials,
  type StoredCredentials,
  writeCredentials,
} from "@sentry-tui/runtime-host/config/index";
import {
  OAuthError,
  pollForDeviceToken,
  requestDeviceCode,
  resolveClientId,
  resolveSiteUrl,
  unknownClientMessage,
} from "~/api/oauth";
import { VERSION_LABEL } from "@sentry-tui/runtime-host/version";

/**
 * The interactive half of the device flow: everything the user sees while
 * `src/api/oauth.ts` talks to the server.
 *
 * Output goes to stderr so `sentry-tui login` composes in a pipeline and so
 * nothing collides with the TUI's own use of stdout.
 */

const out = (line = "") => process.stderr.write(`${line}\n`);

/** Best-effort browser launch; a headless box just reads the URL instead. */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  } catch {
    // No browser here — the printed URL is the fallback.
  }
}

export interface LoginOptions {
  /** Skip the browser launch and just print the URL. */
  noBrowser?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Run the device flow end to end and store the resulting credentials.
 * Returns the credentials so callers can continue straight into the app.
 */
export async function runLogin({
  noBrowser = false,
  fetchImpl,
}: LoginOptions = {}): Promise<StoredCredentials> {
  const stored = await readCredentials();
  const siteUrl = resolveSiteUrl(stored?.siteUrl);
  const clientId = resolveClientId(stored?.clientId);

  let device: Awaited<ReturnType<typeof requestDeviceCode>>;
  try {
    device = await requestDeviceCode({ siteUrl, clientId, fetchImpl });
  } catch (error) {
    if (error instanceof OAuthError && error.code === "invalid_client") {
      throw new Error(unknownClientMessage(siteUrl));
    }
    throw error;
  }

  out();
  out(`  Your code:  ${device.userCode}`);
  out(`  Enter it at: ${device.verificationUri}`);
  out();

  if (noBrowser) {
    out(`  Or open directly: ${device.verificationUriComplete}`);
  } else {
    out("  Opening your browser…");
    openBrowser(device.verificationUriComplete);
  }
  out("  Waiting for you to approve…");

  let credentials: StoredCredentials;
  try {
    credentials = await pollForDeviceToken({
      siteUrl,
      clientId,
      device,
      onSlowDown: (seconds) => out(`  (server asked us to slow down — polling every ${seconds}s)`),
      fetchImpl,
    });
  } catch (error) {
    throw describePollFailure(error);
  }

  await writeCredentials(credentials);

  const who = credentials.user?.email ?? credentials.user?.name;
  out();
  out(who ? `  Signed in as ${who}.` : "  Signed in.");
  out(`  Credentials saved to ${credentialsPath()} (owner-readable only).`);
  out();

  return credentials;
}

/** Turn protocol error codes into something worth reading. */
function describePollFailure(error: unknown): Error {
  if (!(error instanceof OAuthError))
    return error instanceof Error ? error : new Error(String(error));
  if (error.code === "access_denied") {
    return new Error("Login was denied in the browser. Run `sentry-tui login` to try again.");
  }
  if (error.code === "expired_token") {
    return new Error("The login code expired. Run `sentry-tui login` to get a new one.");
  }
  return error;
}

export async function runLogout(): Promise<void> {
  const cleared = await clearCredentials();
  out(cleared ? `Signed out — removed ${credentialsPath()}.` : "Not signed in; nothing to remove.");
  out("The token itself stays valid until it expires or you revoke it in Sentry.");
}

/** `sentry-tui status` — what credentials are in play, and for how long. */
export async function runStatus(): Promise<void> {
  const envVar = process.env["SENTRY_AUTH_TOKEN"]?.trim()
    ? "SENTRY_AUTH_TOKEN"
    : process.env["SENTRY_TOKEN"]?.trim()
      ? "SENTRY_TOKEN"
      : undefined;

  const config = await readConfig();
  const credentials = await readCredentials();

  if (envVar) {
    out(`Authenticated with $${envVar} (environment tokens never refresh).`);
  } else if (!credentials) {
    out("Not signed in. Run `sentry-tui login`.");
  } else {
    const who = credentials.user?.email ?? credentials.user?.name;
    out(who ? `Signed in as ${who}.` : "Signed in.");
    out(`  Source:   ${credentialsPath()}`);
    out(`  Site:     ${resolveSiteUrl(credentials.siteUrl)}`);
    if (credentials.scopes?.length) out(`  Scopes:   ${credentials.scopes.join(" ")}`);
    out(
      `  Expires:  ${credentials.expiresAt ? describeExpiry(credentials.expiresAt) : "never"}${
        credentials.refreshToken ? " (renews automatically)" : ""
      }`,
    );
  }

  const org = process.env["SENTRY_ORG"]?.trim() || config.org;
  out(`  Org:      ${org ?? "not set"}`);
  // Outside the branches above: a bug report from someone who never signed in
  // still needs to say which build produced it.
  out(`  Version:  ${VERSION_LABEL}`);
}

function describeExpiry(expiresAt: string, now: number = Date.now()): string {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return expiresAt;

  const seconds = Math.round((expiry - now) / 1000);
  if (seconds <= 0) return `expired (${expiresAt})`;

  const units: Array<[number, string]> = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const count = Math.round(seconds / size);
      return `in ${count} ${name}${count === 1 ? "" : "s"} (${expiresAt})`;
    }
  }
  return `in under a minute (${expiresAt})`;
}

/**
 * Sign in from a cold start, when the app was launched with no credentials at
 * all. There is exactly one way in, so this runs the device flow outright
 * rather than asking permission to run it — the browser opening is the answer
 * to "how do I sign in", not a second question.
 *
 * Returns null when there is no terminal in front of us: a piped or scripted
 * run has nobody to read the code, so the caller reports the original "no
 * credentials" error instead of blocking on a login nobody can complete.
 */
export async function autoLogin(options: LoginOptions = {}): Promise<StoredCredentials | null> {
  if (!process.stdin.isTTY) return null;

  out("No Sentry credentials found — signing you in.");
  return await runLogin(options);
}
