/**
 * Explore › Starred Queries — the dynamic nav section.
 *
 * The failure mode this guards against is not a missing section but a broken
 * sidebar: the fetch runs in the background while someone is trying to
 * navigate, so an empty answer, a slow one and a 403 all have to leave the
 * static IA intact and the cursor working.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { MAX_STARRED_SAVED_QUERIES_IN_NAV } from "~/api/savedQueries";
import { App } from "~/ui/App";
import { useSecondaryNavExtras } from "~/ui/hooks/useSecondaryNavExtras";
import { renderHarness } from "./helpers";
import { rawExploreSavedQueriesFixture, savedQueryResultRowsFixture } from "./saved-query-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

/** A starred-query response of `count` distinctly named queries. */
function starredQueries(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    name: `starred ${i}`,
    dataset: "spans",
    projects: [],
    environment: [],
    starred: true,
    query: [{ fields: ["id"], mode: "samples", orderby: "-timestamp", query: "" }],
  }));
}

const PROJECTS = [{ id: "42", slug: "checkout", name: "Checkout", platform: "python" }];

interface StubOptions {
  saved?: unknown;
  /** Status for the saved-query endpoint. */
  status?: number;
  /** Rows `events/` returns when a query is run. */
  results?: unknown;
  /** Make running a query fail, as a query over a dataset the org lost would. */
  failResults?: boolean;
}

function stubClient({
  saved = rawExploreSavedQueriesFixture,
  status = 200,
  results = savedQueryResultRowsFixture,
  failResults = false,
}: StubOptions = {}) {
  const urls: string[] = [];

  const json = (body: unknown, code = 200) =>
    new Response(JSON.stringify(body), {
      status: code,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes("/explore/saved/")) {
      // `starred=1` filters server-side, so the stub does too — the nav must
      // not be relying on a filter the endpoint already applied.
      const starredOnly = url.includes("starred=1");
      const rows = (saved as Array<{ starred?: boolean }>).filter(
        (q) => !starredOnly || q.starred === true,
      );
      return json(status === 200 ? rows : { detail: "nope" }, status);
    }
    if (url.includes("/projects/")) return json(PROJECTS);
    if (url.includes("/events/")) {
      return failResults ? json({ detail: "unknown dataset" }, 400) : json({ data: results });
    }
    return json([]);
  }) as unknown as typeof fetch;

  return { client: new SentryClient({ auth, fetchImpl, maxRetries: 0 }), urls };
}

/** Move the rail cursor to Explore and open its sidebar, leaving it open. */
async function openExploreSidebar(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

async function renderApp(client: SentryClient) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

test("starred queries appear as their own section below All Queries", async () => {
  const { client, urls } = stubClient();
  const h = await renderApp(client);
  try {
    await openExploreSidebar(h);
    await h.waitForFrame((f) => f.includes("Starred Queries"));

    const frame = h.frame();
    expect(frame).toContain("Starred Queries");
    // The two starred fixture queries, and not the unstarred one.
    expect(frame).toContain("Slow checkout");
    expect(frame).toContain("Billing errors");
    expect(frame).not.toContain("Sentry p95");
    // Below the static IA, as the web draws it.
    expect(frame.indexOf("All Queries")).toBeLessThan(frame.indexOf("Starred Queries"));

    // The request is the web's: starred only, capped at the nav's own limit.
    const saved = urls.find((url) => url.includes("/explore/saved/"));
    expect(saved).toContain("starred=1");
    expect(saved).toContain(`per_page=${MAX_STARRED_SAVED_QUERIES_IN_NAV}`);
  } finally {
    await h.cleanup();
  }
});

/**
 * Move the sidebar cursor onto the first starred item and commit it. Nine
 * static Explore items sit above All Queries, which sits above the section.
 */
async function selectFirstStarred(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.waitForFrame((f) => f.includes("Starred Queries"));
  for (let n = 0; n < 10; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

test("selecting a starred query runs it, on the filters it was saved with", async () => {
  const { client, urls } = stubClient();
  const h = await renderApp(client);
  try {
    await openExploreSidebar(h);
    await selectFirstStarred(h);

    // It lands on the query itself, not on the list the query lives in.
    await h.waitForFrame((f) => f.includes("POST /api/checkout"));
    const frame = h.frame();
    expect(frame).toContain("Slow checkout spans");
    expect(frame).toContain("span.description");
    expect(frame).not.toContain("Not implemented yet");
    // The list is not what's on screen — the results are.
    expect(frame).not.toContain("Saved Explore queries");

    // Its own dataset, fields, sort, period and projects, with the project id
    // resolved to the slug the rest of the app filters by.
    const events = decodeURIComponent(urls.find((url) => url.includes("/events/")) ?? "");
    expect(events).toContain("dataset=spans");
    expect(events).toContain("sort=-span.duration");
    expect(events).toContain("statsPeriod=24h");
    expect(events).toContain("project=checkout");
    expect(events).toContain("environment=production");
  } finally {
    await h.cleanup();
  }
});

test("escape from a starred query's results lands on All Queries", async () => {
  const h = await renderApp(stubClient().client);
  try {
    await openExploreSidebar(h);
    await selectFirstStarred(h);
    await h.waitForFrame((f) => f.includes("POST /api/checkout"));

    // The item's target is what Escape comes back to, so the way out of a
    // starred query is the list it belongs to rather than wherever you were.
    await h.pressEscape();
    await h.waitForFrame((f) => f.includes("Saved Explore queries"));
    expect(h.frame()).toContain("Billing errors");
    expect(h.frame()).not.toContain("POST /api/checkout");
  } finally {
    await h.cleanup();
  }
});

test("a starred query that no longer runs shows the error, not a blank pane", async () => {
  // The query is still starred and still in the nav, but running it fails —
  // its dataset was turned off, or the fields no longer exist.
  const h = await renderApp(stubClient({ failResults: true }).client);
  try {
    await openExploreSidebar(h);
    await selectFirstStarred(h);

    await h.waitForFrame((f) => f.includes("Failed to run the query"));
    const frame = h.frame();
    expect(frame).toContain("Failed to run the query");
    // Named, so it's clear which starred item failed.
    expect(frame).toContain("Slow checkout spans");

    // And it is not a dead end: Escape still returns to the list.
    await h.pressEscape();
    await h.waitForFrame((f) => f.includes("Saved Explore queries"));
  } finally {
    await h.cleanup();
  }
});

test("nothing starred means no section, and the static nav is untouched", async () => {
  const h = await renderApp(stubClient({ saved: [] }).client);
  try {
    await openExploreSidebar(h);
    await h.waitForFrame((f) => f.includes("Traces"));

    const frame = h.frame();
    expect(frame).not.toContain("Starred Queries");
    expect(frame).toContain("Traces");
    expect(frame).toContain("All Queries");

    // The cursor still walks the static list and commits.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Search logs"));
  } finally {
    await h.cleanup();
  }
});

test("a failed starred-query fetch costs a section, not the nav", async () => {
  const h = await renderApp(stubClient({ saved: [], status: 403 }).client);
  try {
    await openExploreSidebar(h);
    await h.waitForFrame((f) => f.includes("Traces"));

    const frame = h.frame();
    expect(frame).not.toContain("Starred Queries");
    // Nothing about the failure leaks into the sidebar.
    expect(frame).not.toContain("Forbidden");

    // And the sidebar still navigates.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Search logs"));
  } finally {
    await h.cleanup();
  }
});

test("the sidebar for another group does not pay for Explore's fetch", async () => {
  const { client, urls } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    // Issues is the group on screen at start.
    expect(urls.some((url) => url.includes("/explore/saved/"))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The cap, read straight off the hook
// ---------------------------------------------------------------------------

/** Prints what the hook returns, so the cap can be asserted past the viewport. */
function ExtrasProbe({ client }: { client: SentryClient }) {
  const extras = useSecondaryNavExtras(client, "acme", "explore", 0);
  const section = extras.sections[0];
  return <text>{`items=${section?.items.length ?? 0} title=${section?.title ?? "none"}`}</text>;
}

test("the section is capped at MAX_STARRED_SAVED_QUERIES_IN_NAV", async () => {
  // More than the cap, in case the endpoint ignores `per_page`.
  const { client } = stubClient({ saved: starredQueries(MAX_STARRED_SAVED_QUERIES_IN_NAV + 5) });
  const h = await renderHarness(<ExtrasProbe client={client} />, { width: 60, height: 4 });
  try {
    await h.waitForFrame((f) => f.includes("items="));
    await h.waitForFrame((f) => !f.includes("items=0"));
    expect(h.frame()).toContain(`items=${MAX_STARRED_SAVED_QUERIES_IN_NAV}`);
    expect(h.frame()).toContain("title=Starred Queries");
  } finally {
    await h.cleanup();
  }
});
