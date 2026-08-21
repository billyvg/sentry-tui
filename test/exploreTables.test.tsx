import { describe, expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import type { DiscoverRow } from "~/api/discover";
import type { ExploreEvent } from "~/api/exploreEvents";
import { SentryClient } from "~/api/client";
import { EXPLORE_TABLES, getExploreTable } from "~/core/exploreTables";
import { getScreen } from "~/core/screens";
import { proportionalBar } from "~/lib/sparkline";
import { DataTable } from "~/ui/components/DataTable";
import { layoutColumns } from "~/ui/lib/tableLayout";
import { App } from "~/ui/App";
import { SCREEN_COMPONENTS } from "~/ui/screens/registry";
import {
  EXPLORE_MIN_FLEX,
  exploreColumnsFor,
  formatDuration,
  messagePreview,
} from "~/ui/screens/exploreColumns";
import {
  exploreTimeseriesFixture,
  rawConversationRowsFixture,
  rawErrorRowsFixture,
  rawMetricRowsFixture,
  rawSpanRowsFixture,
} from "./explore-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 140;
const HEIGHT = 32;

/** Position of an item in the Explore sidebar, which is what `j` counts. */
const EXPLORE_ITEM_INDEX: Record<string, number> = {
  Traces: 0,
  Logs: 1,
  Metrics: 2,
  Errors: 3,
  Discover: 4,
  Profiles: 5,
  Replays: 6,
  Releases: 7,
  Conversations: 8,
  "All Queries": 9,
};

/**
 * A client that answers each dataset with its own fixture, so a screen that
 * asks for the wrong one gets nothing and the test says so.
 */
function stubClient(
  rowsByDataset: Record<string, unknown> = {
    spans: rawSpanRowsFixture,
    tracemetrics: rawMetricRowsFixture,
    errors: rawErrorRowsFixture,
  },
  timeseries: unknown = exploreTimeseriesFixture,
) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const dataset = new URL(url, "https://sentry.io").searchParams.get("dataset") ?? "";
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/events-stats/")) return json({ data: timeseries });
    if (url.includes("/events/")) return json({ data: rowsByDataset[dataset] ?? [] });
    return json([]);
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

/** Conversations and Traces are both `dataset=spans`; tell them apart by query. */
function conversationClient(rows: unknown = rawConversationRowsFixture) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const query = new URL(url, "https://sentry.io").searchParams.get("query") ?? "";
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/events-stats/")) return json({ data: exploreTimeseriesFixture });
    if (url.includes("/events/")) {
      return json({ data: query.includes("gen_ai.conversation.id") ? rows : [] });
    }
    return json([]);
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

async function renderApp(client: SentryClient, width = WIDTH, height = HEIGHT) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, { width, height });
}

/** Walk the nav rail to Explore and select `item` from the sidebar. */
async function navigateTo(h: Awaited<ReturnType<typeof renderHarness>>, item: string) {
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await h.press((i) => i.pressTab()); // content → nav rail
  await h.press((i) => i.pressKey("j")); // Issues → Explore
  await h.press((i) => i.pressEnter()); // open the sidebar
  for (let n = 0; n < EXPLORE_ITEM_INDEX[item]!; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registration", () => {
  test("every configured table has a component, and vice versa", () => {
    for (const table of EXPLORE_TABLES) {
      expect(SCREEN_COMPONENTS[table.id]).toBeDefined();
    }
    // The four share one component, so anything else pointing at it would be a
    // screen with no config — which renders an error rather than a table.
    const shared = SCREEN_COMPONENTS["explore.traces"];
    const usingIt = Object.entries(SCREEN_COMPONENTS)
      .filter(([, component]) => component === shared)
      .map(([id]) => id)
      .sort();
    expect(usingIt).toEqual(EXPLORE_TABLES.map((t) => t.id).sort());
  });

  test("Enter is advertised as opening the field panel, not a view", () => {
    for (const table of EXPLORE_TABLES) {
      expect(getScreen(table.id).openLabel).toBe("details");
    }
  });
});

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

describe("columns", () => {
  test("no column draws a field its query never asked for", () => {
    for (const table of EXPLORE_TABLES) {
      const columns = exploreColumnsFor(table.id, { maxDurationMs: 1000 });
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) {
        expect(table.fields).toContain(column.key);
      }
    }
  });

  test("every column set has exactly one flex column that never sheds", () => {
    for (const table of EXPLORE_TABLES) {
      const columns = exploreColumnsFor(table.id, { maxDurationMs: 1000 });
      const flex = columns.filter((c) => c.width === "flex");
      expect(flex).toHaveLength(1);
      expect(flex[0]!.priority).toBeUndefined();
    }
  });

  test("column keys are unique within a table", () => {
    for (const table of EXPLORE_TABLES) {
      const keys = exploreColumnsFor(table.id, { maxDurationMs: 1000 }).map((c) => c.key);
      expect(keys).toHaveLength(new Set(keys).size);
    }
  });

  test("shed priorities are distinct, so the order is not a coin toss", () => {
    for (const table of EXPLORE_TABLES) {
      const priorities = exploreColumnsFor(table.id, { maxDurationMs: 1000 })
        .map((c) => c.priority)
        .filter((p): p is number => p !== undefined);
      expect(priorities).toHaveLength(new Set(priorities).size);
    }
  });

  // The pane is narrower than the terminal by the nav rail, the sidebar and
  // the border, so the widths here are pessimistic on purpose.
  test.each([40, 60, 80, 100, 140])("columns fit and shed in order at %i cells", (available) => {
    for (const table of EXPLORE_TABLES) {
      const columns = exploreColumnsFor(table.id, { maxDurationMs: 1000 });
      const resolved = layoutColumns(columns, available, { gap: 1, minFlex: EXPLORE_MIN_FLEX });
      const used = resolved.reduce((sum, r) => sum + r.width, 0) + Math.max(0, resolved.length - 1);
      expect(used).toBeLessThanOrEqual(available);

      // Whatever survived, the flex column is among it: it carries the row's
      // meaning, so shedding it would leave a table of metadata.
      if (available >= 40) {
        const keys = resolved.map((r) => r.column.key);
        const flexKey = columns.find((c) => c.width === "flex")!.key;
        expect(keys).toContain(flexKey);
      }
    }
  });

  test("the shed order is lowest priority first", () => {
    const traces = exploreColumnsFor("explore.traces", { maxDurationMs: 1000 });
    const layout = { gap: 1, minFlex: EXPLORE_MIN_FLEX };
    const wide = layoutColumns(traces, 140, layout).map((r) => r.column.key);
    const narrow = layoutColumns(traces, 80, layout).map((r) => r.column.key);

    expect(wide).toContain("transaction");
    // `transaction` carries the lowest priority, so it is the first to go.
    expect(narrow).not.toContain("transaction");
    expect(narrow).toContain("span.description");
    expect(narrow).toContain("span.duration");
  });
});

// ---------------------------------------------------------------------------
// The duration bar
// ---------------------------------------------------------------------------

describe("proportionalBar", () => {
  test("occupies exactly the width it is given, whatever the fraction", () => {
    for (const fraction of [-1, 0, 0.001, 0.5, 0.999, 1, 2, NaN]) {
      expect(proportionalBar(fraction, 8)).toHaveLength(8);
    }
  });

  test("a full bar is solid and an empty one is blank", () => {
    expect(proportionalBar(1, 5)).toBe("█████");
    expect(proportionalBar(0, 5)).toBe("     ");
  });

  test("a real but tiny value still leaves a mark", () => {
    expect(proportionalBar(0.0001, 6).trimEnd()).toBe("▏");
  });

  test("sub-cell precision separates values a whole-cell bar would flatten", () => {
    const a = proportionalBar(0.3, 4);
    const b = proportionalBar(0.35, 4);
    expect(a).not.toBe(b);
  });

  test("longer is longer", () => {
    const lengths = [0.2, 0.4, 0.6, 0.8].map((f) => proportionalBar(f, 10).trimEnd().length);
    expect(lengths).toEqual([...lengths].sort((x, y) => x - y));
  });
});

// ---------------------------------------------------------------------------
// Cell formatting
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  test("picks the unit that keeps the number short", () => {
    expect(formatDuration(0.37)).toBe("370\u00b5s");
    expect(formatDuration(8.39)).toBe("8.39ms");
    expect(formatDuration(340.5)).toBe("341ms");
    expect(formatDuration(1240)).toBe("1.24s");
    expect(formatDuration(9010)).toBe("9.01s");
    expect(formatDuration(125_000)).toBe("2.1m");
  });

  test("fits the cell it is given at every magnitude", () => {
    for (const ms of [0.001, 0.37, 8.39, 340.5, 1240, 9010, 125_000, 7_200_000]) {
      expect(formatDuration(ms).length).toBeLessThanOrEqual(7);
    }
  });

  test("a value that isn't one renders as a dash, not as NaN", () => {
    expect(formatDuration(Number.NaN)).toBe("\u2014");
    expect(formatDuration(-1)).toBe("\u2014");
  });
});

describe("messagePreview", () => {
  test("reads the SDK envelope Sentry actually returns", () => {
    const raw = JSON.stringify([
      { role: "user", parts: [{ type: "text", content: "Why is checkout slow?" }] },
    ]);
    expect(messagePreview(raw)).toBe("Why is checkout slow?");
  });

  test("reads the flat {type, text} envelope too", () => {
    expect(messagePreview(JSON.stringify([{ type: "text", text: "hello" }]))).toBe("hello");
  });

  test("a bare string is passed through", () => {
    expect(messagePreview("just a prompt")).toBe("just a prompt");
  });

  test("newlines collapse, because a row is one line", () => {
    expect(messagePreview("line one\n\nline two")).toBe("line one line two");
  });

  test("JSON the API truncated mid-string still shows something", () => {
    const truncated = '[{"role": "user", "parts": [{"content": "the beginning of a pro';
    expect(messagePreview(truncated)).toContain("the beginning of a pro");
  });

  test("an empty field stays empty rather than becoming a dash", () => {
    expect(messagePreview("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

describe("Explore › Traces", () => {
  test("renders the span table with the web's default columns", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("SELECT * FROM orders"));

      const frame = h.frame();
      expect(frame).toContain("Span ID");
      expect(frame).toContain("Description");
      expect(frame).toContain("Duration");
      expect(frame).toContain("Transaction");
      expect(frame).toContain("SELECT * FROM orders");
      expect(frame).toContain("/api/checkout");
      expect(frame).toContain("Search spans…");
    } finally {
      await h.cleanup();
    }
  });

  test("draws durations as proportional bars scaled to the slowest span", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("SELECT * FROM orders"));

      const frame = h.frame();
      // 9010ms is the longest row, so its bar is solid.
      expect(frame).toContain("9.01s");
      expect(frame).toMatch(/█+\s+9\.01s/);
      // 0.42ms against a 9s maximum still gets the smallest possible mark.
      expect(frame).toContain("420µs");
      expect(frame).toMatch(/▏\s+420µs/);
    } finally {
      await h.cleanup();
    }
  });

  test("the chart above the table plots the spans aggregate", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("count(span.duration)"));
      expect(h.frame()).toMatch(/[▁▂▃▄▅▆▇█]/);
    } finally {
      await h.cleanup();
    }
  });

  test("the status bar counts the rows", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("6 spans"));
      expect(h.frame()).toContain("6 spans");
    } finally {
      await h.cleanup();
    }
  });

  test("j and k move the cursor without losing rows", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("SELECT * FROM orders"));

      await h.press((i) => i.pressKey("j"));
      await h.press((i) => i.pressKey("j"));
      await h.press((i) => i.pressKey("k"));

      expect(h.frame()).toContain("SELECT * FROM orders");
      expect(h.frame()).toContain("publish send_welcome_email");
    } finally {
      await h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The field panel
// ---------------------------------------------------------------------------

describe("the field panel", () => {
  test("Enter opens every requested field, including the shed ones", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("SELECT * FROM orders"));
      expect(h.frame()).not.toContain("Row Details");

      await h.press((i) => i.pressEnter());

      const frame = h.frame();
      expect(frame).toContain("Row Details");
      for (const field of getExploreTable("explore.traces")!.fields) {
        expect(frame).toContain(field);
      }
      expect(frame).toContain("a3f2c1d8b4e5f607");
    } finally {
      await h.cleanup();
    }
  });

  test("the panel follows the cursor while it is open", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("SELECT * FROM orders"));

      await h.press((i) => i.pressEnter());
      expect(h.frame()).toContain("a3f2c1d8b4e5f607");

      await h.press((i) => i.pressKey("j"));
      const frame = h.frame();
      expect(frame).toContain("7b9e0a4412cc31de");
      expect(frame).not.toContain("a3f2c1d8b4e5f607");
    } finally {
      await h.cleanup();
    }
  });

  test("Enter again and Escape both close it, without popping the screen", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("SELECT * FROM orders"));

      await h.press((i) => i.pressEnter());
      expect(h.frame()).toContain("Row Details");
      await h.press((i) => i.pressEnter());
      expect(h.frame()).not.toContain("Row Details");

      await h.press((i) => i.pressEnter());
      await h.pressEscape();
      expect(h.frame()).not.toContain("Row Details");
      expect(h.frame()).toContain("SELECT * FROM orders");
    } finally {
      await h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe("Explore › Metrics", () => {
  test("renders metric samples with their units", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Metrics");
      await h.waitForFrame((f) => f.includes("checkout.latency"));

      const frame = h.frame();
      expect(frame).toContain("Metric");
      expect(frame).toContain("checkout.latency");
      expect(frame).toContain("distribution");
      expect(frame).toContain("248.5ms");
      // `none` is the API's word for unitless, and is not shown.
      expect(frame).not.toContain("3 none");
    } finally {
      await h.cleanup();
    }
  });

  test("draws the web's feature badges in the Explore sidebar", async () => {
    const h = await renderApp(stubClient());
    try {
      await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
      await h.press((i) => i.pressTab()); // content → nav rail
      await h.press((i) => i.pressKey("j")); // Issues → Explore
      await h.press((i) => i.pressEnter()); // open the sidebar, without leaving it

      const frame = h.frame();
      expect(frame).toContain("Metrics NEW");
      expect(frame).toContain("Errors ALPHA");
      expect(frame).toContain("Conversations BETA");
      // Only the three the web badges — Traces and Logs carry none.
      expect(frame).toMatch(/Traces\s*│/);
    } finally {
      await h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe("Explore › Errors", () => {
  test("renders individual events, not grouped issues", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Errors");
      await h.waitForFrame((f) => f.includes("TypeError"));

      const frame = h.frame();
      expect(frame).toContain("Event ID");
      expect(frame).toContain("Level");
      expect(frame).toContain("FATAL");
      expect(frame).toContain("ada@example.com");
      expect(frame).toContain("could not connect to server");
      // The issue stream's own furniture is what tells the two screens apart.
      expect(frame).not.toContain("events users");
      expect(frame).not.toContain("Search issues");
    } finally {
      await h.cleanup();
    }
  });

  test("the status bar counts events, not issues", async () => {
    const h = await renderApp(stubClient());
    try {
      await navigateTo(h, "Errors");
      await h.waitForFrame((f) => f.includes("3 events"));
      expect(h.frame()).toContain("3 events");
    } finally {
      await h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

describe("Explore › Conversations", () => {
  test("filters spans to gen-AI client calls and shows the prompt", async () => {
    const h = await renderApp(conversationClient());
    try {
      await navigateTo(h, "Conversations");
      await h.waitForFrame((f) => f.includes("Summarise the last four deploys"));

      const frame = h.frame();
      expect(frame).toContain("Conversation");
      expect(frame).toContain("conv_7f3a91");
      expect(frame).toContain("claude-opus-5");
      expect(frame).toContain("1.4k");
      expect(frame).toContain("$0.0184");
      // Both message encodings read as text, not as JSON.
      expect(frame).toContain("Summarise the last four deploys");
      expect(frame).toContain("Why did the checkout job fail?");
      expect(frame).not.toContain('{"type"');
    } finally {
      await h.cleanup();
    }
  });

  test("an org without the feature gets an honest empty state, not 'no results'", async () => {
    const h = await renderApp(conversationClient([]));
    try {
      await navigateTo(h, "Conversations");
      await h.waitForFrame((f) => f.includes("No AI spans found"));

      const frame = h.frame();
      expect(frame).toContain("No AI spans found");
      expect(frame).toContain("gen-ai-conversations");
      expect(frame).toContain("may not have");
    } finally {
      await h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Skeleton geometry
// ---------------------------------------------------------------------------

/** Indices of the lines that have any ink on them. */
function inkLines(frame: string): number[] {
  return frame
    .split("\n")
    .map((line, i) => (line.trim() === "" ? -1 : i))
    .filter((i) => i >= 0);
}

const FIXTURES_BY_ID: Record<string, DiscoverRow[]> = {
  "explore.traces": rawSpanRowsFixture,
  "explore.metrics": rawMetricRowsFixture,
  "explore.errors": rawErrorRowsFixture,
  "explore.conversations": rawConversationRowsFixture,
};

function renderRows(
  id: string,
  props: Partial<Parameters<typeof DataTable<ExploreEvent>>[0]>,
  width: number,
) {
  const rows = FIXTURES_BY_ID[id]!.map((row, index): ExploreEvent => ({
    id: String(row["id"] ?? index),
    row,
  }));
  return renderHarness(
    <box style={{ width, height: 20, flexDirection: "column" }}>
      <DataTable<ExploreEvent>
        rows={rows}
        columns={exploreColumnsFor(id as never, { maxDurationMs: 9010 })}
        width={width}
        selectedIndex={0}
        focused
        rowKey={(event, index) => `${index}:${event.id}`}
        minFlex={EXPLORE_MIN_FLEX}
        skeletonRows={rows.length}
        {...props}
      />
    </box>,
    { width, height: 20 },
  );
}

describe("skeleton geometry", () => {
  // What `SENTRY_TUI_LATENCY=3000` shows by hand: the placeholder must occupy
  // exactly the lines the data will, or the table jumps when the fetch lands.
  test.each(EXPLORE_TABLES.map((t) => t.id))("%s holds its rows' lines", async (id) => {
    const real = await renderRows(id, {}, 120);
    const realFrame = real.frame();
    await real.cleanup();

    const skeleton = await renderRows(id, { rows: undefined, loading: true }, 120);
    const skeletonFrame = skeleton.frame();
    await skeleton.cleanup();

    expect(inkLines(skeletonFrame)).toEqual(inkLines(realFrame));
  });

  test.each([80, 100, 140])("no row wraps or overflows at %i cells", async (width) => {
    for (const table of EXPLORE_TABLES) {
      const h = await renderRows(table.id, {}, width);
      try {
        for (const line of h.frame().split("\n")) {
          expect(line.length).toBeLessThanOrEqual(width);
        }
        // Header, its rule, and one line per row — a wrapped cell would add one.
        expect(inkLines(h.frame())).toHaveLength(2 + FIXTURES_BY_ID[table.id]!.length);
      } finally {
        await h.cleanup();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Sibling isolation
// ---------------------------------------------------------------------------

/**
 * A client that answers Traces and leaves Metrics in flight until its request
 * is aborted, so anything Metrics shows can only have come from its sibling.
 */
function slowMetricsClient() {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const dataset = new URL(url, "https://sentry.io").searchParams.get("dataset") ?? "";
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (dataset === "tracemetrics") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    if (url.includes("/events-stats/")) return json({ data: exploreTimeseriesFixture });
    if (url.includes("/events/")) return json({ data: rawSpanRowsFixture });
    return json([]);
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

describe("sibling isolation", () => {
  test("a sibling screen never shows the previous one's rows or chart", async () => {
    const h = await renderApp(slowMetricsClient());
    try {
      await navigateTo(h, "Traces");
      await h.waitForFrame((f) => f.includes("SELECT * FROM orders"));
      expect(h.frame()).toContain("count(span.duration)");

      // Straight from Traces to Metrics: same component, same slot. Without a
      // remount React would keep the hook state and paint spans under a
      // Metrics header until the new fetch landed — which here it never does.
      await h.press((i) => i.pressTab());
      await h.press((i) => i.pressEnter());
      await h.press((i) => i.pressKey("j"));
      await h.press((i) => i.pressKey("j"));
      await h.press((i) => i.pressEnter());

      await h.waitForFrame((f) => f.includes("Search metrics…"));
      const frame = h.frame();
      expect(frame).not.toContain("SELECT * FROM orders");
      expect(frame).not.toContain("count(span.duration)");
      expect(frame).toContain("Metric");

      // The rows it draws while waiting are its own skeleton — several runs of
      // dashes with gaps between them — and not six blank rows left behind by
      // Traces, which is what a leaked hook state looks like.
      const skeletonRows = frame.split("\n").filter((line) => /─ +─/.test(line));
      expect(skeletonRows.length).toBeGreaterThan(5);
    } finally {
      await h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Short terminals
// ---------------------------------------------------------------------------

describe("short terminals", () => {
  test("the chart yields to the table when the pane is too short for both", async () => {
    // 20 rows leaves nothing under a ten-row chart once the search box, the
    // filter row and the header have taken their share.
    const short = await renderApp(stubClient(), 140, 20);
    try {
      await navigateTo(short, "Traces");
      await short.waitForFrame((f) => f.includes("SELECT * FROM orders"));
      expect(short.frame()).not.toContain("count(span.duration)");
      // The rows are what the screen is for, and they are still there.
      expect(short.frame()).toContain("Duration");
    } finally {
      await short.cleanup();
    }
  });

  test("and comes back when there is room", async () => {
    const tall = await renderApp(stubClient(), 140, 32);
    try {
      await navigateTo(tall, "Traces");
      await tall.waitForFrame((f) => f.includes("count(span.duration)"));
      expect(tall.frame()).toContain("SELECT * FROM orders");
    } finally {
      await tall.cleanup();
    }
  });
});
