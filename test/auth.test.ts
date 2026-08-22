import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOAuthAuthProvider, MissingTokenError, resolveAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import {
  clearCredentials,
  configPath,
  credentialsPath,
  migrateLegacyToken,
  readConfig,
  readCredentials,
  type StoredCredentials,
  writeConfig,
  writeCredentials,
} from "~/api/config";

/** Every test in this file writes to a throwaway config directory. */
let dir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentry-tui-auth-"));
  for (const name of ["SENTRY_TUI_CONFIG_DIR", "SENTRY_AUTH_TOKEN", "SENTRY_TOKEN"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env["SENTRY_TUI_CONFIG_DIR"] = dir;
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const oauthCredentials = (overrides: Partial<StoredCredentials> = {}): StoredCredentials => ({
  accessToken: "access_1",
  refreshToken: "refresh_1",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  clientId: "client_1",
  siteUrl: "https://sentry.io",
  ...overrides,
});

describe("credential storage", () => {
  test("keeps secrets out of the file the app rewrites", async () => {
    await writeConfig({ org: "acme" });
    await writeCredentials({ accessToken: "sntryu_secret" });

    expect(await Bun.file(configPath()).text()).not.toContain("sntryu_secret");
    expect((await readCredentials())?.accessToken).toBe("sntryu_secret");
  });

  test("writes the credential file owner-readable only", async () => {
    await writeCredentials({ accessToken: "sntryu_secret" });
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);

    // Re-asserted on every write, not just the first.
    await writeCredentials({ accessToken: "sntryu_other" });
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });

  test("reports no credentials when the file is absent or empty", async () => {
    expect(await readCredentials()).toBeNull();
    await writeCredentials({ accessToken: "" });
    expect(await readCredentials()).toBeNull();
  });

  test("clearCredentials removes the file and says whether it had to", async () => {
    expect(await clearCredentials()).toBe(false);
    await writeCredentials({ accessToken: "sntryu_secret" });
    expect(await clearCredentials()).toBe(true);
    expect(await readCredentials()).toBeNull();
  });
});

describe("migrateLegacyToken", () => {
  test("moves a token out of config.json and keeps the preferences", async () => {
    await writeConfig({ org: "acme", token: "sntryu_legacy" });

    expect(await migrateLegacyToken()).toBe(true);

    expect(await readConfig()).toEqual({ org: "acme" });
    expect((await readCredentials())?.accessToken).toBe("sntryu_legacy");
  });

  test("does not clobber credentials that already exist", async () => {
    await writeCredentials({ accessToken: "current" });
    await writeConfig({ token: "sntryu_legacy" });

    expect(await migrateLegacyToken()).toBe(true);

    expect((await readCredentials())?.accessToken).toBe("current");
    expect(await readConfig()).toEqual({});
  });

  test("is a no-op when there is nothing to move", async () => {
    await writeConfig({ org: "acme" });
    expect(await migrateLegacyToken()).toBe(false);
  });
});

describe("resolveAuthProvider", () => {
  test("prefers an environment token over a stored login", async () => {
    await writeCredentials(oauthCredentials());
    process.env["SENTRY_AUTH_TOKEN"] = "sntryu_from_env";

    const provider = await resolveAuthProvider();

    expect(await provider.getToken()).toBe("sntryu_from_env");
    expect(provider.describe()).toBe("$SENTRY_AUTH_TOKEN");
    // Nothing to renew: env tokens are used exactly as given.
    expect(provider.refresh).toBeUndefined();
  });

  test("uses a stored personal token without pretending it can refresh", async () => {
    await writeCredentials({ accessToken: "sntryu_stored" });

    const provider = await resolveAuthProvider();

    expect(await provider.getToken()).toBe("sntryu_stored");
    expect(provider.describe()).toBe("the credentials file");
    expect(provider.refresh).toBeUndefined();
  });

  test("points at `sentry-tui login` when there is nothing at all", async () => {
    expect(resolveAuthProvider()).rejects.toThrow(MissingTokenError);

    // OAuth is the only way in we advertise — no token-minting detour.
    const message = new MissingTokenError().message;
    expect(message).toContain("sentry-tui login");
    for (const leak of ["SENTRY_AUTH_TOKEN", "auth-tokens", "personal", "sntryu_"]) {
      expect(message).not.toContain(leak);
    }
  });
});

describe("createOAuthAuthProvider", () => {
  test("uses the stored token while it is still good", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return json({});
    }) as unknown as typeof fetch;

    const provider = createOAuthAuthProvider({ credentials: oauthCredentials(), fetchImpl });

    expect(await provider.getToken()).toBe("access_1");
    expect(calls).toBe(0);
  });

  test("renews just before expiry and persists the rotated pair", async () => {
    const fetchImpl = (async () =>
      json({
        access_token: "access_2",
        refresh_token: "refresh_2",
        expires_in: 2_592_000,
      })) as unknown as typeof fetch;

    const provider = createOAuthAuthProvider({
      // Inside the skew window: still valid, but not for long.
      credentials: oauthCredentials({ expiresAt: new Date(Date.now() + 30_000).toISOString() }),
      fetchImpl,
    });

    expect(await provider.getToken()).toBe("access_2");

    const persisted = await readCredentials();
    expect(persisted?.accessToken).toBe("access_2");
    expect(persisted?.refreshToken).toBe("refresh_2");
    // Fields the refresh response doesn't repeat survive.
    expect(persisted?.clientId).toBe("client_1");
  });

  test("a renewal keeps the signed-in account", async () => {
    // A refresh response carries tokens and nothing else — no `user`. Losing
    // the account here is quiet and lasting: the file is rewritten without it,
    // so `status` stops naming who you are and every crash report from then on
    // is anonymous, until the next full login.
    const fetchImpl = (async () =>
      json({
        access_token: "access_2",
        refresh_token: "refresh_2",
        expires_in: 2_592_000,
      })) as unknown as typeof fetch;

    const provider = createOAuthAuthProvider({
      credentials: oauthCredentials({
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        user: { id: "147086", name: "Someone", email: "someone@example.test" },
      }),
      fetchImpl,
    });

    await provider.getToken();

    expect((await readCredentials())?.user).toEqual({
      id: "147086",
      name: "Someone",
      email: "someone@example.test",
    });
  });

  test("shares one refresh between concurrent callers", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      await Bun.sleep(1);
      return json({ access_token: `access_${calls + 1}`, refresh_token: "r", expires_in: 3600 });
    }) as unknown as typeof fetch;

    const provider = createOAuthAuthProvider({
      credentials: oauthCredentials({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      fetchImpl,
    });

    const tokens = await Promise.all([
      provider.getToken(),
      provider.getToken(),
      provider.getToken(),
    ]);

    // A second refresh would have invalidated the first one's rotated token.
    expect(calls).toBe(1);
    expect(tokens).toEqual(["access_2", "access_2", "access_2"]);
  });

  test("refuses to refresh a token that has no refresh token", async () => {
    const provider = createOAuthAuthProvider({
      credentials: { accessToken: "sntryu_stored" },
    });
    expect(await provider.refresh?.()).toBe(false);
  });
});

describe("SentryClient 401 recovery", () => {
  test("renews once and replays the request", async () => {
    const requests: Array<string | undefined> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith("/oauth/token/")) {
        return json({ access_token: "access_2", refresh_token: "refresh_2", expires_in: 3600 });
      }
      const authorization = new Headers(init.headers).get("Authorization") ?? undefined;
      requests.push(authorization);
      return authorization === "Bearer access_2"
        ? json([{ slug: "acme" }])
        : new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const auth = createOAuthAuthProvider({ credentials: oauthCredentials(), fetchImpl });
    const client = new SentryClient({ auth, fetchImpl, maxRetries: 0 });

    const page = await client.request<Array<{ slug: string }>>("/organizations/");

    expect(page.data).toEqual([{ slug: "acme" }]);
    expect(requests).toEqual(["Bearer access_1", "Bearer access_2"]);
  });

  test("reports the original 401 when there is nothing to renew", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    await writeCredentials({ accessToken: "sntryu_stored" });
    const auth = await resolveAuthProvider();
    const client = new SentryClient({ auth, fetchImpl, maxRetries: 0 });

    expect(client.request("/organizations/")).rejects.toThrow(/Unauthorized/);
    await Bun.sleep(1);
    expect(calls).toBe(1);
  });
});
