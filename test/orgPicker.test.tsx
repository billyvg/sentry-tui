import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { readConfig } from "~/api/config";
import { App } from "~/ui/App";
import { groupFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

// Selecting an org persists it as the new default, so the suite must not write
// to the developer's real config file.
let configDir: string;
let previousConfigDir: string | undefined;

beforeAll(() => {
  previousConfigDir = process.env["SENTRY_TUI_CONFIG_DIR"];
  configDir = mkdtempSync(join(tmpdir(), "sentry-tui-orgpicker-"));
  process.env["SENTRY_TUI_CONFIG_DIR"] = configDir;
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env["SENTRY_TUI_CONFIG_DIR"];
  else process.env["SENTRY_TUI_CONFIG_DIR"] = previousConfigDir;
  rmSync(configDir, { recursive: true, force: true });
});

const ORGS = [
  { id: "1", slug: "acme", name: "Acme Inc" },
  { id: "2", slug: "globex", name: "Globex" },
];

/** Records which org slug each issue-list request was scoped to. */
function stubClient(orgsResponse: unknown = ORGS) {
  const listedOrgs: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const issueList = url.match(/\/organizations\/([^/]+)\/issues\/(\?|$)/);
    let payload: unknown = [];
    if (issueList) {
      listedOrgs.push(issueList[1]!);
      payload = [
        {
          ...groupFixture,
          metadata: { type: `${issueList[1]}Error`, value: "scoped to this org" },
        },
      ];
    } else if (new URL(url).pathname.endsWith("/organizations/")) {
      payload = orgsResponse;
    } else if (url.includes("issues-stats")) {
      payload = {};
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new SentryClient({ auth, fetchImpl }), listedOrgs };
}

const renderApp = (client: SentryClient) =>
  renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });

test("the nav rail advertises the org picker's key beside the slug", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    const railRow = h
      .frame()
      .split("\n")
      .find((line) => line.includes("acme") && !line.includes("acmeError"));
    expect(railRow).toContain("(o)");
  } finally {
    await h.cleanup();
  }
});

test("o opens the picker and lists the token's organizations", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("Globex"));

    const frame = h.frame();
    expect(frame).toContain("Organization");
    expect(frame).toContain("Acme Inc");
    expect(frame).toContain("Globex");
  } finally {
    await h.cleanup();
  }
});

test("selecting an org refetches the stream against it and stores the default", async () => {
  const { client, listedOrgs } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    expect(listedOrgs).toContain("acme");

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("Globex"));

    // The cursor starts on the current org, so one step down reaches Globex.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("globexError"));
    const frame = h.frame();
    expect(frame).toContain("globex");
    expect(frame).toContain("switched to globex");
    // The old org's rows are gone rather than left behind under the new slug.
    expect(frame).not.toContain("acmeError");
    expect(listedOrgs).toContain("globex");

    expect((await readConfig()).org).toBe("globex");
  } finally {
    await h.cleanup();
  }
});

test("escape closes the picker without switching", async () => {
  const { client, listedOrgs } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("Globex"));

    await h.pressEscape();
    const frame = h.frame();
    expect(frame).not.toContain("Globex");
    expect(frame).toContain("acmeError");
    expect(listedOrgs).not.toContain("globex");
  } finally {
    await h.cleanup();
  }
});

test("the picker explains itself while the list is still empty", async () => {
  const { client } = stubClient([]);
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("No organizations"));
    expect(h.frame()).toContain("No organizations");

    // Enter on a placeholder row is inert — it must not switch to nothing.
    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("acmeError");
  } finally {
    await h.cleanup();
  }
});
