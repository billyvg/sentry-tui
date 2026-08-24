/**
 * Explore › Traces' query builder, driven through the app.
 *
 * The unit tests in `exploreQuery.test.ts` assert what a builder state asks
 * for; these assert that pressing the keys reaches that state and that the
 * request actually changes — the chip row, the menus it opens, and the
 * aggregate table that a group by turns the samples into.
 */

import { describe, expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { exploreTimeseriesFixture, rawSpanRowsFixture } from "./explore-fixtures";
import { renderHarness } from "./helpers";

const SLOW_TEST_TIMEOUT_MS = 20_000;

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 140;
const HEIGHT = 32;

/** String attributes the stub org reports for spans. */
const STRING_ATTRIBUTES = [
  { key: "span.op", name: "span.op", attributeType: "string" },
  { key: "transaction", name: "transaction", attributeType: "string" },
];

/** Numeric ones, which is what the numeric aggregates are offered. */
const NUMBER_ATTRIBUTES = [
  { key: "span.duration", name: "span.duration", attributeType: "number" },
  { key: "span.self_time", name: "span.self_time", attributeType: "number" },
];

/** Rows a grouped query comes back with: one per span op. */
const AGGREGATE_ROWS = [
  { "span.op": "db.query", "count(span.duration)": 1284 },
  { "span.op": "http.client", "count(span.duration)": 431 },
  { "span.op": "cache.get", "count(span.duration)": 96 },
];

interface Recorder {
  client: SentryClient;
  /** Every `events/` request the screen made, newest last. */
  events: URL[];
  last: () => URL;
}

/**
 * A client that answers spans, attributes and the aggregate query, and keeps
 * every `events/` URL so a test can assert what was asked for rather than
 * inferring it from what was drawn.
 */
function recordingClient(): Recorder {
  const events: URL[] = [];

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://sentry.io");
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.pathname.endsWith("/trace-items/attributes/")) {
      return json(
        url.searchParams.get("attributeType") === "number" ? NUMBER_ATTRIBUTES : STRING_ATTRIBUTES,
      );
    }
    if (url.pathname.endsWith("/events-stats/")) return json({ data: exploreTimeseriesFixture });
    if (url.pathname.endsWith("/events/")) {
      events.push(url);
      const fields = url.searchParams.getAll("field");
      const grouped = !fields.includes("id");
      return json({ data: grouped ? AGGREGATE_ROWS : rawSpanRowsFixture });
    }
    return json([]);
  }) as unknown as typeof fetch;

  return {
    client: new SentryClient({ auth, fetchImpl }),
    events,
    last: () => events.at(-1)!,
  };
}

/** Render the app and walk the nav to Explore › Traces. */
async function openTraces(client: SentryClient) {
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await h.openNav(); // content → nav rail
  await h.press((i) => i.pressKey("j")); // Issues → Explore
  await h.press((i) => i.pressEnter()); // open the sidebar
  await h.press((i) => i.pressEnter()); // Traces is the first item
  await h.waitForFrame((f) => f.includes("Visualize"));
  return h;
}

describe("the query builder row", () => {
  test(
    "draws the table's defaults, labelled",
    async () => {
      const { client } = recordingClient();
      const h = await openTraces(client);
      const frame = h.frame();

      expect(frame).toContain("Visualize");
      expect(frame).toContain("count");
      // `count(span.duration)` counts spans, and the chip says so — as the
      // web's own field list does.
      expect(frame).toContain("spans");
      expect(frame).toContain("Group by");
      expect(frame).toContain("Sort");
      expect(frame).toContain("timestamp");
      expect(frame).toContain("Desc");

      await h.cleanup();
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "is absent from a table that has no attributes to offer",
    async () => {
      const { client } = recordingClient();
      const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
        width: WIDTH,
        height: HEIGHT,
      });
      await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
      await h.openNav();
      await h.press((i) => i.pressKey("j"));
      await h.press((i) => i.pressEnter());
      for (let n = 0; n < 3; n++) await h.press((i) => i.pressKey("j")); // → Errors
      await h.press((i) => i.pressEnter());
      await h.waitForFrame((f) => f.includes("Search error events"));

      expect(h.frame()).not.toContain("Visualize");

      await h.cleanup();
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});

describe("grouping", () => {
  test(
    "picking a group by turns the samples into aggregates",
    async () => {
      const recorder = recordingClient();
      const h = await openTraces(recorder.client);
      expect(recorder.last().searchParams.getAll("field")).toContain("id");

      await h.press((i) => i.pressKey("B"));
      await h.waitForFrame((f) => f.includes("Group By"));
      expect(h.frame()).toContain("span.op");

      await h.press((i) => i.pressKey("j")); // — → span.op
      await h.press((i) => i.pressEnter());
      await h.waitForFrame((f) => f.includes("db.query"));

      const url = recorder.last();
      expect(url.searchParams.getAll("field")).toEqual(["span.op", "count(span.duration)"]);
      expect(url.searchParams.get("sort")).toBe("-count(span.duration)");

      // The table is now one row per group, headed by what it grouped on.
      const frame = h.frame();
      expect(frame).toContain("count(span.duration)");
      expect(frame).toContain("db.query");
      expect(frame).toContain("1.3k");

      await h.cleanup();
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "the chip says what is grouped, and clearing it goes back to samples",
    async () => {
      const recorder = recordingClient();
      const h = await openTraces(recorder.client);

      await h.press((i) => i.pressKey("B"));
      await h.waitForFrame((f) => f.includes("Group By"));
      await h.press((i) => i.pressKey("j"));
      await h.press((i) => i.pressEnter());
      await h.waitForFrame((f) => f.includes("db.query"));

      await h.press((i) => i.pressKey("B"));
      await h.waitForFrame((f) => f.includes("Group By"));
      await h.press((i) => i.pressEnter()); // the "—" row, which clears it
      await h.waitForFrame((f) => f.includes("SELECT"));

      expect(recorder.last().searchParams.getAll("field")).toContain("id");

      await h.cleanup();
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});

describe("visualize and sort", () => {
  test(
    "choosing an aggregate re-asks for it, and the chart title follows",
    async () => {
      const recorder = recordingClient();
      const h = await openTraces(recorder.client);

      await h.press((i) => i.pressKey("V"));
      await h.waitForFrame((f) => f.includes("p95"));
      for (let n = 0; n < 5; n++) await h.press((i) => i.pressKey("j")); // count → p95
      await h.press((i) => i.pressEnter());
      await h.waitForFrame((f) => f.includes("p95(span.duration)"));

      // Samples mode still asks for the sample columns; only the chart moved.
      expect(recorder.last().searchParams.getAll("field")).toContain("id");
      expect(h.frame()).toContain("span.duration");

      await h.cleanup();
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "the direction chip flips the sort in place",
    async () => {
      const recorder = recordingClient();
      const h = await openTraces(recorder.client);
      expect(recorder.last().searchParams.get("sort")).toBe("-timestamp");

      await h.press((i) => i.pressKey("O"));
      await h.waitForFrame((f) => f.includes("Asc"));
      expect(recorder.last().searchParams.get("sort")).toBe("timestamp");

      await h.cleanup();
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "the sort menu offers the columns the query returns",
    async () => {
      const recorder = recordingClient();
      const h = await openTraces(recorder.client);

      await h.press((i) => i.pressKey("S"));
      await h.waitForFrame((f) => f.includes("Sort By"));
      const frame = h.frame();
      expect(frame).toContain("span.description");
      expect(frame).toContain("transaction");

      // The cursor opens on the sort in force, which is the last row here.
      await h.press((i) => i.pressKey("k")); // timestamp → transaction
      await h.press((i) => i.pressEnter());
      await h.waitForFrame((f) => !f.includes("Sort By"));
      expect(recorder.last().searchParams.get("sort")).toBe("-transaction");

      await h.cleanup();
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});
