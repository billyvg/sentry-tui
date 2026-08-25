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
  { id: "3", slug: "initech", name: "Initech" },
];

/** Records which org slug each issue-list request was scoped to. */
function stubClient(orgsResponse: unknown = ORGS) {
  const listedOrgs: string[] = [];
  const projectQueries: Array<{ org: string; projects: string[] }> = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const issueList = url.match(/\/organizations\/([^/]+)\/issues\/(\?|$)/);
    let payload: unknown = [];
    if (issueList) {
      listedOrgs.push(issueList[1]!);
      projectQueries.push({
        org: issueList[1]!,
        projects: new URL(url).searchParams.getAll("project"),
      });
      payload = [
        {
          ...groupFixture,
          metadata: { type: `${issueList[1]}Error`, value: "scoped to this org" },
        },
      ];
    } else if (new URL(url).pathname.endsWith("/organizations/")) {
      payload = orgsResponse;
    } else if (url.includes("/projects/")) {
      payload = [{ id: "1", slug: "backend", name: "Backend", platform: "python" }];
    } else if (url.includes("issues-stats")) {
      payload = {};
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new SentryClient({ auth, fetchImpl }), listedOrgs, projectQueries };
}

/** Wait until the serialized preference writes reach disk. */
async function waitForConfig(expected: unknown): Promise<void> {
  const deadline = Date.now() + 1_000;
  let actual: unknown;
  do {
    actual = await readConfig();
    if (JSON.stringify(actual) === JSON.stringify(expected)) return;
    await Bun.sleep(5);
  } while (Date.now() < deadline);
  expect(actual).toEqual(expected);
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
    await h.openNav();
    const railRow = h
      .frame()
      .split("\n")
      .find((line) => line.includes("acme") && !line.includes("acmeError"));
    expect(railRow).toContain("o");
  } finally {
    await h.cleanup();
  }
});

test("o opens the picker and lists the token's organizations by slug", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));

    const frame = h.frame();
    expect(frame).toContain("Organization");
    expect(frame).toContain("globex");
    expect(frame).toContain("initech");
    // Slugs only: the display name is what the nav rail never shows either.
    expect(frame).not.toContain("Globex");
    expect(frame).not.toContain("Acme Inc");
  } finally {
    await h.cleanup();
  }
});

test("selecting an org refetches all accessible projects and stores the default", async () => {
  const { client, listedOrgs, projectQueries } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    expect(listedOrgs).toContain("acme");

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));

    // The cursor starts on the current org, so one step down reaches globex.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("globexError"));
    const frame = h.frame();
    expect(frame).toContain("globex");
    expect(frame).toContain("switched to globex");
    // The old org's rows are gone rather than left behind under the new slug.
    expect(frame).not.toContain("acmeError");
    expect(listedOrgs).toContain("globex");
    expect(projectQueries.findLast((query) => query.org === "globex")?.projects).toEqual(["-1"]);

    expect((await readConfig()).org).toBe("globex");
  } finally {
    await h.cleanup();
  }
});

test("switching organizations loads that org's remembered projects", async () => {
  const { client, projectQueries } = stubClient();
  const h = await renderHarness(
    <App
      onQuit={() => {}}
      client={client}
      org="acme"
      initialProjectsByOrg={{ acme: ["backend"], globex: ["frontend"] }}
    />,
    { width: WIDTH, height: HEIGHT },
  );
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    expect(projectQueries.findLast((query) => query.org === "acme")?.projects).toEqual(["backend"]);

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("globexError"));

    expect(projectQueries.findLast((query) => query.org === "globex")?.projects).toEqual([
      "frontend",
    ]);
  } finally {
    await h.cleanup();
  }
});

test("selecting a project and immediately switching orgs preserves both preferences", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));

    await h.press((i) => i.pressKey("P"));
    await h.waitForFrame((f) => f.includes("┌─ Project "));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.pressEscape();

    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("globexError"));

    await waitForConfig({
      org: "globex",
      projectsByOrg: { acme: ["backend"] },
    });
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
    await h.waitForFrame((f) => f.includes("globex"));

    await h.pressEscape();
    const frame = h.frame();
    expect(frame).not.toContain("globex");
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

test("the command palette opens the picker too", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));

    await h.press((i) => i.pressKey("k", { ctrl: true }));
    await h.press((i) => i.pressKey("switch org"));
    await h.press((i) => i.pressKey("\r"));

    await h.waitForFrame((f) => f.includes("globex"));
    expect(h.frame()).toContain("Organization");
  } finally {
    await h.cleanup();
  }
});

test("the filter box only takes text once the search key focuses it", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));
    expect(h.frame()).toContain("/ filter…");

    // Unfocused, letters are swallowed by the list rather than typed: "i"
    // would otherwise narrow to initech.
    await h.press((i) => i.pressKey("i"));
    expect(h.frame()).toContain("globex");

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("ini"));
    await h.waitForFrame((f) => !f.includes("globex"));

    const frame = h.frame();
    // The typed query reaches the box, and only its match survives. The
    // trailing space matters: the issue row behind the picker reads
    // "● acmeError", which is not the picker row this is looking for.
    expect(frame).toContain("/ ini");
    expect(frame).toContain("initech");
    expect(frame).not.toContain("● acme ");
  } finally {
    await h.cleanup();
  }
});

test("enter takes the filtered match and switches to it", async () => {
  const { client, listedOrgs } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("glob"));
    await h.waitForFrame((f) => !f.includes("initech"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("globexError"));
    expect(listedOrgs).toContain("globex");
  } finally {
    await h.cleanup();
  }
});

test("escape clears the filter before it closes the picker", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("glob"));
    await h.waitForFrame((f) => !f.includes("initech"));

    // First escape restores the full list...
    await h.pressEscape();
    await h.waitForFrame((f) => f.includes("initech"));
    expect(h.frame()).toContain("Organization");

    // ...and the second closes the picker.
    await h.pressEscape();
    expect(h.frame()).not.toContain("Organization");
  } finally {
    await h.cleanup();
  }
});

test("a query that matches nothing says so instead of emptying the box", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("acmeError"));
    await h.press((i) => i.pressKey("o"));
    await h.waitForFrame((f) => f.includes("globex"));

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("zzz"));
    await h.waitForFrame((f) => f.includes("No match"));
    expect(h.frame()).toContain('No match for "zzz"');
  } finally {
    await h.cleanup();
  }
});
