import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CLIENT_ID,
  OAuthError,
  pollForDeviceToken,
  ReauthRequiredError,
  refreshAccessToken,
  requestDeviceCode,
  resolveClientId,
  resolveSiteUrl,
} from "~/api/oauth";

const SITE = "https://sentry.io";
const CLIENT_ID = "abc123";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Serve one response per call, recording the form each request posted. */
function stubFetch(responses: Array<Response | (() => Response)>) {
  const forms: Array<Record<string, string>> = [];
  const urls: string[] = [];
  let index = 0;
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    urls.push(String(input));
    forms.push(Object.fromEntries(new URLSearchParams(String(init.body ?? ""))));
    const next = responses[Math.min(index++, responses.length - 1)]!;
    // Clone, so a repeated response can have its body read more than once.
    return typeof next === "function" ? next() : next.clone();
  }) as unknown as typeof fetch;
  return { impl, forms, urls };
}

/** A sleep that returns immediately but records what it was asked to wait. */
function fakeClock(startMs = 0) {
  let now = startMs;
  const waited: number[] = [];
  return {
    now: () => now,
    waited,
    sleep: async (ms: number) => {
      waited.push(ms);
      now += ms;
    },
  };
}

const deviceCodeResponse = {
  device_code: "dc_secret",
  user_code: "WDJB-MJHT",
  verification_uri: "https://sentry.io/oauth/device/",
  verification_uri_complete: "https://sentry.io/oauth/device/?user_code=WDJB-MJHT",
  expires_in: 600,
  interval: 5,
};

const tokenResponse = {
  access_token: "sntrys_access",
  refresh_token: "sntrys_refresh",
  expires_in: 2_592_000,
  token_type: "Bearer",
  scope: "org:read event:read",
  user: { id: "1", name: "Ada", email: "ada@example.com" },
};

describe("resolveSiteUrl / resolveClientId", () => {
  test("SENTRY_URL overrides the stored site and loses its trailing slash", () => {
    process.env["SENTRY_URL"] = "https://sentry.example.com/";
    try {
      expect(resolveSiteUrl("https://sentry.io")).toBe("https://sentry.example.com");
    } finally {
      delete process.env["SENTRY_URL"];
    }
  });

  test("falls back to the site the stored token came from", () => {
    expect(resolveSiteUrl("https://sentry.example.com")).toBe("https://sentry.example.com");
    expect(resolveSiteUrl()).toBe("https://sentry.io");
  });

  test("falls back to the application bundled with the binary", () => {
    expect(resolveClientId()).toBe(DEFAULT_CLIENT_ID);
    expect(DEFAULT_CLIENT_ID).not.toBe("");
  });

  test("SENTRY_CLIENT_ID overrides the bundled application, for self-hosted", () => {
    process.env["SENTRY_CLIENT_ID"] = "self_hosted_app";
    try {
      expect(resolveClientId("stored_app")).toBe("self_hosted_app");
    } finally {
      delete process.env["SENTRY_CLIENT_ID"];
    }
  });
});

describe("requestDeviceCode", () => {
  test("asks for the TUI's scopes and returns the user-facing code", async () => {
    const { impl, forms, urls } = stubFetch([json(deviceCodeResponse)]);

    const device = await requestDeviceCode({ siteUrl: SITE, clientId: CLIENT_ID, fetchImpl: impl });

    expect(urls[0]).toBe("https://sentry.io/oauth/device/code/");
    expect(forms[0]).toEqual({
      client_id: CLIENT_ID,
      scope: "org:read project:read event:read event:write member:read team:read",
    });
    expect(device.userCode).toBe("WDJB-MJHT");
    expect(device.verificationUriComplete).toContain("user_code=WDJB-MJHT");
    expect(device.intervalSeconds).toBe(5);
  });

  test("surfaces an unknown client id as its OAuth error code", async () => {
    const { impl } = stubFetch([
      json({ error: "invalid_client", error_description: "Invalid client_id" }, 401),
    ]);

    const error = await requestDeviceCode({
      siteUrl: SITE,
      clientId: "nope",
      fetchImpl: impl,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("invalid_client");
  });
});

describe("pollForDeviceToken", () => {
  const device = {
    deviceCode: "dc_secret",
    userCode: "WDJB-MJHT",
    verificationUri: SITE,
    verificationUriComplete: SITE,
    expiresInSeconds: 600,
    intervalSeconds: 5,
  };

  test("waits through authorization_pending and returns credentials", async () => {
    const { impl, forms } = stubFetch([
      json({ error: "authorization_pending" }, 400),
      json({ error: "authorization_pending" }, 400),
      json(tokenResponse),
    ]);
    const clock = fakeClock(1_000_000);

    const credentials = await pollForDeviceToken({
      siteUrl: SITE,
      clientId: CLIENT_ID,
      device,
      fetchImpl: impl,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(forms[0]).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dc_secret",
      client_id: CLIENT_ID,
    });
    expect(clock.waited).toEqual([5000, 5000, 5000]);
    expect(credentials.accessToken).toBe("sntrys_access");
    expect(credentials.refreshToken).toBe("sntrys_refresh");
    expect(credentials.scopes).toEqual(["org:read", "event:read"]);
    expect(credentials.user?.email).toBe("ada@example.com");
    expect(credentials.clientId).toBe(CLIENT_ID);
    // expires_in is relative, so the deadline is computed from our own clock
    // as it stands after the three five-second waits.
    expect(credentials.expiresAt).toBe(new Date(1_015_000 + 2_592_000_000).toISOString());
  });

  test("backs off five seconds per slow_down", async () => {
    const { impl } = stubFetch([
      json({ error: "slow_down" }, 400),
      json({ error: "slow_down" }, 400),
      json(tokenResponse),
    ]);
    const clock = fakeClock();
    const intervals: number[] = [];

    await pollForDeviceToken({
      siteUrl: SITE,
      clientId: CLIENT_ID,
      device,
      fetchImpl: impl,
      sleep: clock.sleep,
      now: clock.now,
      onSlowDown: (seconds) => intervals.push(seconds),
    });

    expect(intervals).toEqual([10, 15]);
    expect(clock.waited).toEqual([5000, 10_000, 15_000]);
  });

  test("stops when the user denies the request", async () => {
    const { impl } = stubFetch([json({ error: "access_denied" }, 400)]);
    const clock = fakeClock();

    const promise = pollForDeviceToken({
      siteUrl: SITE,
      clientId: CLIENT_ID,
      device,
      fetchImpl: impl,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(promise).rejects.toThrow(/access_denied/);
  });

  test("gives up once the code's lifetime has elapsed", async () => {
    const { impl } = stubFetch([json({ error: "authorization_pending" }, 400)]);
    const clock = fakeClock();

    const error = await pollForDeviceToken({
      siteUrl: SITE,
      clientId: CLIENT_ID,
      device: { ...device, expiresInSeconds: 12 },
      fetchImpl: impl,
      sleep: clock.sleep,
      now: clock.now,
    }).catch((e: unknown) => e);

    expect((error as OAuthError).code).toBe("expired_token");
    // Two polls fit inside twelve seconds; the third would be past the deadline.
    expect(clock.waited).toEqual([5000, 5000, 5000]);
  });
});

describe("refreshAccessToken", () => {
  test("exchanges the refresh token and keeps the rotated pair", async () => {
    const { impl, forms, urls } = stubFetch([
      json({ ...tokenResponse, access_token: "sntrys_new", refresh_token: "sntrys_new_refresh" }),
    ]);

    const credentials = await refreshAccessToken({
      siteUrl: SITE,
      clientId: CLIENT_ID,
      refreshToken: "sntrys_refresh",
      fetchImpl: impl,
      now: () => 0,
    });

    expect(urls[0]).toBe("https://sentry.io/oauth/token/");
    expect(forms[0]).toEqual({
      grant_type: "refresh_token",
      refresh_token: "sntrys_refresh",
      client_id: CLIENT_ID,
    });
    expect(credentials.accessToken).toBe("sntrys_new");
    expect(credentials.refreshToken).toBe("sntrys_new_refresh");
  });

  test("asks for a fresh login when the grant is gone", async () => {
    const { impl } = stubFetch([json({ error: "invalid_grant" }, 400)]);

    const error = await refreshAccessToken({
      siteUrl: SITE,
      clientId: CLIENT_ID,
      refreshToken: "stale",
      fetchImpl: impl,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toContain("sentry-tui login");
  });
});
