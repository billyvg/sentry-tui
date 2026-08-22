import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCredentials, writeCredentials } from "~/api/config";
import { autoLogin, runLogin, runLogout, runStatus } from "~/app/login";
import { VERSION_LABEL } from "~/lib/version";

/**
 * The login command's own output is the thing under test, so stderr is
 * captured rather than printed. `interval: 0` keeps the poll loop instant.
 */
let dir: string;
let written: string[];
const savedEnv: Record<string, string | undefined> = {};
const realWrite = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sentry-tui-login-"));
  for (const name of [
    "SENTRY_TUI_CONFIG_DIR",
    "SENTRY_CLIENT_ID",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_URL",
  ]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env["SENTRY_TUI_CONFIG_DIR"] = dir;
  process.env["SENTRY_CLIENT_ID"] = "client_1";

  written = [];
  process.stderr.write = ((chunk: string) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = realWrite;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

const output = () => written.join("");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(responses: Response[]) {
  let index = 0;
  return (async () =>
    responses[Math.min(index++, responses.length - 1)]!.clone()) as unknown as typeof fetch;
}

describe("runLogin", () => {
  test("shows the code, then saves what the approval returns", async () => {
    const fetchImpl = stubFetch([
      json({
        device_code: "dc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://sentry.io/oauth/device/",
        verification_uri_complete: "https://sentry.io/oauth/device/?user_code=WDJB-MJHT",
        expires_in: 600,
        interval: 0,
      }),
      json({
        access_token: "access_1",
        refresh_token: "refresh_1",
        expires_in: 3600,
        scope: "org:read",
        user: { id: "1", name: "Ada", email: "ada@example.com" },
      }),
    ]);

    const credentials = await runLogin({ noBrowser: true, fetchImpl });

    expect(output()).toContain("WDJB-MJHT");
    expect(output()).toContain("https://sentry.io/oauth/device/");
    expect(output()).toContain("Signed in as ada@example.com");
    expect(credentials.accessToken).toBe("access_1");
    expect((await readCredentials())?.refreshToken).toBe("refresh_1");
  });

  test("explains a denial in terms of what to do next", async () => {
    const fetchImpl = stubFetch([
      json({
        device_code: "dc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://sentry.io/oauth/device/",
        expires_in: 600,
        interval: 0,
      }),
      json({ error: "access_denied" }, 400),
    ]);

    const error = await runLogin({ noBrowser: true, fetchImpl }).catch((e: unknown) => e);

    expect((error as Error).message).toContain("denied");
    expect((error as Error).message).toContain("sentry-tui login");
    expect(await readCredentials()).toBeNull();
  });

  test("tells a self-hosted install how to register its own application", async () => {
    // What a Sentry that doesn't know our client ID answers.
    const fetchImpl = stubFetch([json({ error: "invalid_client" }, 401)]);
    process.env["SENTRY_URL"] = "https://sentry.example.com";

    try {
      const error = await runLogin({ noBrowser: true, fetchImpl }).catch((e: unknown) => e);

      expect((error as Error).message).toContain("sentry.example.com");
      expect((error as Error).message).toContain("SENTRY_CLIENT_ID");
      expect((error as Error).message).toContain("Public Client");
    } finally {
      delete process.env["SENTRY_URL"];
    }
  });
});

describe("autoLogin", () => {
  const realIsTTY = process.stdin.isTTY;
  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  };

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: realIsTTY, configurable: true });
  });

  test("signs in on the spot instead of asking for permission first", async () => {
    setTTY(true);
    const fetchImpl = stubFetch([
      json({
        device_code: "dc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://sentry.io/oauth/device/",
        expires_in: 600,
        interval: 0,
      }),
      json({ access_token: "access_1", expires_in: 3600, scope: "org:read" }),
    ]);

    const credentials = await autoLogin({ noBrowser: true, fetchImpl });

    expect(credentials?.accessToken).toBe("access_1");
    expect(output()).toContain("WDJB-MJHT");
    // No confirmation step, and no pointer at a command they'd have to run.
    expect(output()).not.toContain("[Y/n]");
    expect(output()).not.toContain("sentry-tui login");
  });

  test("stands aside when there is no terminal to sign in from", async () => {
    setTTY(false);
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;

    expect(await autoLogin({ fetchImpl })).toBeNull();
    expect(called).toBe(false);
    expect(await readCredentials()).toBeNull();
  });
});

describe("runLogout", () => {
  test("removes the credential file", async () => {
    await writeCredentials({ accessToken: "access_1" });

    await runLogout();

    expect(await readCredentials()).toBeNull();
    expect(output()).toContain("Signed out");
  });

  test("says so when there was nothing stored", async () => {
    await runLogout();
    expect(output()).toContain("Not signed in");
  });
});

describe("runStatus", () => {
  test("reports the signed-in user, scopes, and expiry", async () => {
    await writeCredentials({
      accessToken: "access_1",
      refreshToken: "refresh_1",
      expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      scopes: ["org:read", "event:read"],
      user: { email: "ada@example.com" },
    });

    await runStatus();

    expect(output()).toContain("Signed in as ada@example.com");
    expect(output()).toContain("org:read event:read");
    expect(output()).toContain("in 2 days");
    expect(output()).toContain("renews automatically");
  });

  test("names the environment variable when one is in play", async () => {
    process.env["SENTRY_AUTH_TOKEN"] = "sntryu_env";
    await runStatus();
    expect(output()).toContain("$SENTRY_AUTH_TOKEN");
  });

  test("points at login when nothing is stored", async () => {
    await runStatus();
    expect(output()).toContain("sentry-tui login");
  });

  test("names the build, signed in or not", async () => {
    await runStatus();
    expect(output()).toContain(`Version:  ${VERSION_LABEL}`);
  });
});
