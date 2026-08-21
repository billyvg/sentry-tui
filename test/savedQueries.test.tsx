import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { listDiscoverSavedQueries, listExploreSavedQueries } from "~/api/savedQueries";
import { App } from "~/ui/App";
import { renderHarness } from "./helpers";
import {
  rawDiscoverSavedQueriesFixture,
  rawExploreSavedQueriesFixture,
  savedQueryResultRowsFixture,
} from "./saved-query-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

const PROJECTS = [{ id: "42", slug: "checkout", name: "Checkout", platform: "python" }];

interface StubOptions {
  explore?: unknown;
  discover?: unknown;
  results?: unknown;
  /** Fail every saved-query request, whichever endpoint it went to. */
  failSaved?: boolean;
}

/** Records every URL the app asked for, so query params can be asserted. */
function stubClient({
  explore = rawExploreSavedQueriesFixture,
  discover = rawDiscoverSavedQueriesFixture,
  results = savedQueryResultRowsFixture,
  failSaved = false,
}: StubOptions = {}) {
  const urls: string[] = [];

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes("/explore/saved/") || url.includes("/discover/saved/")) {
      if (failSaved) return json({ detail: "nope" }, 403);
      return json(url.includes("/explore/saved/") ? explore : discover);
    }
    if (url.includes("/projects/")) return json(PROJECTS);
    if (url.includes("/events/")) return json({ data: results });
    return json([]);
  }) as unknown as typeof fetch;

  return { client: new SentryClient({ auth, fetchImpl, maxRetries: 0 }), urls };
}

async function renderApp(client: SentryClient) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

/**
 * Walk the nav to an item in the Explore sidebar. `steps` is how many `j`
 * presses past Traces the item sits — the Explore list is Traces, Logs,
 * Metrics, Errors, Discover, Profiles, Replays, Releases, Conversations,
 * All Queries.
 */
async function navigateToExplore(h: Awaited<ReturnType<typeof renderHarness>>, steps: number) {
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  for (let n = 0; n < steps; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

const ALL_QUERIES_STEPS = 9;

async function openAllQueries(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await navigateToExplore(h, ALL_QUERIES_STEPS);
}

/**
 * Mount straight onto an Explore saved-query screen.
 *
 * Reaching All Queries by keyboard is twelve presses, each a render pass; the
 * routing test below still walks it, everything else starts there.
 */
async function renderAt(client: SentryClient, screen: "explore.all-queries" | "explore.discover") {
  return renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen={screen} />,
    { width: WIDTH, height: HEIGHT },
  );
}

// ---------------------------------------------------------------------------
// API normalisation
// ---------------------------------------------------------------------------

test("explore saved queries flatten their nested query object", async () => {
  const { client, urls } = stubClient();
  const queries = await listExploreSavedQueries(client, { org: "acme" });

  // The `query: []` fixture row is dropped: nothing to run, nothing to show.
  expect(queries.map((q) => q.name)).toEqual([
    "Slow checkout spans",
    "Billing errors",
    "Sentry p95 overview",
  ]);

  const [spans, logs, prebuilt] = queries;
  expect(spans).toMatchObject({
    id: "501",
    source: "explore",
    datasetLabel: "Traces",
    dataset: "spans",
    query: "span.op:http.client",
    sort: "-span.duration",
    statsPeriod: "24h",
    starred: true,
    createdBy: "Ada Lovelace",
    isPrebuilt: false,
  });
  expect(spans?.fields).toEqual(["id", "span.description", "span.duration", "timestamp"]);

  // `segment_spans` is Traces too, and a prebuilt query has no creator.
  expect(logs).toMatchObject({ datasetLabel: "Logs", dataset: "logs" });
  expect(prebuilt).toMatchObject({
    datasetLabel: "Traces",
    dataset: "spans",
    isPrebuilt: true,
    createdBy: undefined,
  });

  // The web's ordering, and its starred filter left off.
  expect(urls[0]).toContain("sortBy=starred&sortBy=recentlyViewed");
  expect(urls[0]).not.toContain("starred=1");
});

test("starred=1 and the nav cap reach the endpoint", async () => {
  const { client, urls } = stubClient();
  await listExploreSavedQueries(client, { org: "acme", starred: true, limit: 20 });

  expect(urls[0]).toContain("starred=1");
  expect(urls[0]).toContain("per_page=20");
});

test("legacy Discover queries normalise onto the same shape", async () => {
  const { client, urls } = stubClient();
  const queries = await listDiscoverSavedQueries(client, { org: "acme" });

  expect(queries).toHaveLength(1);
  expect(queries[0]).toMatchObject({
    id: "900",
    source: "discover",
    name: "Unhandled by release",
    datasetLabel: "Errors",
    dataset: "errors",
    query: "error.unhandled:true",
    // Only the first of the `orderby` array survives — `events/` takes one.
    sort: "-count()",
    statsPeriod: "14d",
    starred: false,
    createdBy: "Alan Turing",
  });

  // The endpoint's own `version:2` filter, and its default sort.
  expect(urls[0]).toContain("version%3A2");
  expect(urls[0]).toContain("sortBy=myqueries");
});

test("a Discover search is sent as the endpoint's name: syntax", async () => {
  const { client, urls } = stubClient();
  await listDiscoverSavedQueries(client, { org: "acme", search: "release" });

  // `URLSearchParams` spells a space `+`, so decoding alone doesn't restore it.
  const query = decodeURIComponent(urls[0]!).replace(/\+/g, " ");
  expect(query).toContain('version:2 name:"release"');
});

// ---------------------------------------------------------------------------
// All Queries
// ---------------------------------------------------------------------------

test("All Queries lists the org's saved queries", async () => {
  const h = await renderApp(stubClient().client);
  try {
    await openAllQueries(h);
    await h.waitForFrame((f) => f.includes("Slow checkout spans"));

    const frame = h.frame();
    expect(frame).toContain("All Queries");
    // Headers, in the web's order.
    expect(frame).toContain("Name");
    expect(frame).toContain("Type");
    expect(frame).toContain("Query");
    expect(frame).toContain("Creator");
    expect(frame).toContain("Last Viewed");
    // Rows.
    expect(frame).toContain("Billing errors");
    expect(frame).toContain("span.op:http.client");
    expect(frame).toContain("Ada Lovelace");
    // A prebuilt query is Sentry's, not nobody's.
    expect(frame).toContain("Sentry");
    // Starred state is rendered; starring is a write and is not offered.
    expect(frame).toContain("★");
  } finally {
    await h.cleanup();
  }
});

test("All Queries says the surface may be disabled rather than 'no results'", async () => {
  const h = await renderAt(stubClient({ explore: [] }).client, "explore.all-queries");
  try {
    await h.waitForFrame((f) => f.includes("No saved queries found"));

    expect(h.frame()).toContain("may not have Explore saved queries enabled");
  } finally {
    await h.cleanup();
  }
});

test("a failed saved-query fetch shows an error rather than an empty table", async () => {
  const h = await renderAt(stubClient({ failSaved: true }).client, "explore.all-queries");
  try {
    await h.waitForFrame((f) => f.includes("Failed to load saved queries"));

    expect(h.frame()).toContain("Failed to load saved queries");
  } finally {
    await h.cleanup();
  }
});

test("Enter runs the saved query and shows its own columns", async () => {
  const { client, urls } = stubClient();
  const h = await renderAt(client, "explore.all-queries");
  try {
    await h.waitForFrame((f) => f.includes("Slow checkout spans"));

    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("POST /api/checkout"));

    const frame = h.frame();
    // The saved query's own fields are the columns, not a fixed set.
    expect(frame).toContain("span.description");
    expect(frame).toContain("span.duration");
    expect(frame).toContain("POST /api/checkout");
    expect(frame).toContain("GET /api/cart");
    // Its name labels the view.
    expect(frame).toContain("Slow checkout spans");

    // The request carried the saved query's dataset, fields, sort and filters,
    // with its project id resolved to the slug the rest of the app filters by.
    const events = decodeURIComponent(urls.find((url) => url.includes("/events/")) ?? "");
    expect(events).toContain("dataset=spans");
    expect(events).toContain("field=span.description");
    expect(events).toContain("sort=-span.duration");
    expect(events).toContain("query=span.op:http.client");
    expect(events).toContain("statsPeriod=24h");
    expect(events).toContain("project=checkout");
    expect(events).toContain("environment=production");
  } finally {
    await h.cleanup();
  }
});

test("Escape returns from a query's results to the list", async () => {
  const h = await renderAt(stubClient().client, "explore.all-queries");
  try {
    await h.waitForFrame((f) => f.includes("Slow checkout spans"));

    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("POST /api/checkout"));

    await h.pressEscape();
    await h.waitForFrame((f) => f.includes("Billing errors"));
    expect(h.frame()).not.toContain("POST /api/checkout");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Discover — the same screen over the legacy endpoint
// ---------------------------------------------------------------------------

test("Discover lists the legacy saved queries under its own column headings", async () => {
  const h = await renderAt(stubClient().client, "explore.discover");
  try {
    await h.waitForFrame((f) => f.includes("Unhandled by release"));

    const frame = h.frame();
    expect(frame).toContain("Legacy saved queries");
    expect(frame).toContain("Unhandled by release");
    expect(frame).toContain("Errors");
    // The legacy store records edits, not views.
    expect(frame).toContain("Last Edited");
    expect(frame).not.toContain("Last Viewed");
  } finally {
    await h.cleanup();
  }
});

test("Discover's empty state names Discover, not saved queries in general", async () => {
  const h = await renderAt(stubClient({ discover: [] }).client, "explore.discover");
  try {
    await h.waitForFrame((f) => f.includes("No saved queries found"));

    expect(h.frame()).toContain("may not have Discover enabled");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Narrow terminals
// ---------------------------------------------------------------------------

for (const width of [80, 100, 140]) {
  test(`the All Queries row fits in ${width} columns`, async () => {
    const h = await renderHarness(
      <App onQuit={() => {}} client={stubClient().client} org="acme" />,
      { width, height: HEIGHT },
    );
    try {
      await openAllQueries(h);
      await h.waitForFrame((f) => f.includes("Slow checkout spans"));

      for (const line of h.frame().split("\n")) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
      // The name and the query survive every width — they are what makes the
      // row identifiable.
      expect(h.frame()).toContain("Slow checkout spans");
      expect(h.frame()).toContain("Name");
      expect(h.frame()).toContain("Query");

      if (width === 80) {
        // Shed rather than squeezed: the web keeps star, name and query at its
        // small breakpoint too, and the query stays long enough to read.
        expect(h.frame()).not.toContain("Creator");
        expect(h.frame()).not.toContain("Last Viewed");
        expect(h.frame()).toContain("span.op:http.client");
      } else {
        expect(h.frame()).toContain("Creator");
      }
    } finally {
      await h.cleanup();
    }
  });

  test(`a query's results fit in ${width} columns`, async () => {
    const h = await renderHarness(
      <App onQuit={() => {}} client={stubClient().client} org="acme" />,
      { width, height: HEIGHT },
    );
    try {
      await openAllQueries(h);
      await h.waitForFrame((f) => f.includes("Slow checkout spans"));
      await h.press((i) => i.pressEnter());
      await h.waitForFrame((f) => f.includes("POST /api/checkout"));

      for (const line of h.frame().split("\n")) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
      // Columns shed right to left; the first field and the prose one stay.
      expect(h.frame()).toContain("span.description");
      expect(h.frame()).toContain("POST /api/checkout");
    } finally {
      await h.cleanup();
    }
  });
}
