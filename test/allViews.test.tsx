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
    // Project ids go to the API as-is; the "all projects" sentinel is dropped.
    expect(url!.searchParams.getAll("project")).toEqual(["42"]);
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

test("a saved view opened before the project list lands keeps its filter", async () => {
  // The regression this guards: `projects` used to be mapped to slugs through
  // the project list, so a view opened in the window before that request
  // resolved applied with *no* project filter — silently scoped to the whole
  // org — and recomputing the rows afterwards did not fix the opened view.
  let releaseProjects: (() => void) | undefined;
  const projectsLanded = new Promise<void>((resolve) => {
    releaseProjects = resolve;
  });

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
      await projectsLanded;
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

  const client = new SentryClient({ auth, fetchImpl });
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

    expect(lastIssuesUrl(urls)?.searchParams.getAll("project")).toEqual(["42"]);
  } finally {
    releaseProjects?.();
    await h.cleanup();
  }
});

test("the filter chip shows the project's slug once the list lands", async () => {
  // The id is what goes to the API; the chip is the half that still needs the
  // project list, and it must resolve rather than showing a bare number.
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
    await h.waitForFrame((f) => f.includes("backend"));

    const frame = h.frame();
    expect(frame).toContain("backend");
    expect(frame).not.toContain("42");
  } finally {
    await h.cleanup();
  }
});
