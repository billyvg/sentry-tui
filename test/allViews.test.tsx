/**
 * Issues › All Views — listing saved searches and applying one to the stream.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { groupsFixture, savedViewsFixture } from "./fixtures";
import { renderHarness, type Harness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

/** Index of "All Views" in the flattened Issues nav item list. */
const ALL_VIEWS_INDEX = 8;

function stubClient() {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = groupsFixture;
    if (url.includes("group-search-views")) {
      const createdBy = new URL(url).searchParams.get("createdBy");
      payload = createdBy === "me" ? savedViewsFixture.mine : savedViewsFixture.others;
    } else if (url.includes("issues-stats")) {
      payload = {};
    } else if (url.includes("/projects/")) {
      payload = [{ id: "42", slug: "backend", name: "Backend", platform: "python" }];
    } else if (url.includes("/environments/")) {
      payload = [];
    } else if (url.includes("/issues/?")) {
      urls.push(url);
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { urls, client: new SentryClient({ auth, fetchImpl }) };
}

async function openAllViews(h: Harness) {
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressEnter());
  for (let n = 0; n < ALL_VIEWS_INDEX; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

function lastIssuesUrl(urls: string[]): URL | undefined {
  const url = urls.at(-1);
  return url ? new URL(url) : undefined;
}

test("All Views lists both sections of saved views", async () => {
  const { client } = stubClient();
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await openAllViews(h);
    await h.waitForFrame((f) => f.includes("Prod errors"));

    const frame = h.frame();
    expect(frame).toContain("Created by Me");
    expect(frame).toContain("Created by Others");
    expect(frame).toContain("Prod errors");
    expect(frame).toContain("Team backlog");
    // The saved query is shown alongside the name.
    expect(frame).toContain("is:unresolved level:error");
  } finally {
    await h.cleanup();
  }
});

test("opening a saved view applies its query, sort, period and filters", async () => {
  const { urls, client } = stubClient();
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await openAllViews(h);
    await h.waitForFrame((f) => f.includes("Prod errors"));

    urls.length = 0;
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Prod errors") && f.includes("Last Seen"));

    const url = lastIssuesUrl(urls);
    expect(url).toBeDefined();
    expect(url!.searchParams.get("query")).toBe("is:unresolved level:error");
    expect(url!.searchParams.get("sort")).toBe("freq");
    expect(url!.searchParams.get("statsPeriod")).toBe("7d");
    // Project 42 resolves to its slug; the "all projects" sentinel is dropped.
    expect(url!.searchParams.getAll("project")).toEqual(["backend"]);
    expect(url!.searchParams.getAll("environment")).toEqual(["production"]);
    // The stream header names the saved view.
    expect(h.frame()).toContain("Prod errors");
  } finally {
    await h.cleanup();
  }
});

test("Escape from an opened saved view returns to the list", async () => {
  const { client } = stubClient();
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await openAllViews(h);
    await h.waitForFrame((f) => f.includes("Prod errors"));

    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Last Seen"));
    expect(h.frame()).not.toContain("Created by Others");

    await h.pressEscape();
    await h.waitForFrame((f) => f.includes("Created by Others"));
    expect(h.frame()).toContain("Created by Me");
  } finally {
    await h.cleanup();
  }
});
