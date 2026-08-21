import { describe, expect, test } from "bun:test";

import {
  EXPLORE_TABLES,
  exploreChartTitle,
  exploreEmptyLines,
  exploreQuery,
  getExploreTable,
} from "~/core/exploreTables";
import { getNavGroup } from "~/core/nav";
import { getScreen, stateKeyOf } from "~/core/screens";

const EXPLORE_ITEMS = getNavGroup("explore").sections.flatMap((section) => section.items);

describe("explore table configs", () => {
  test("every config is a registered Explore screen the nav can reach", () => {
    for (const table of EXPLORE_TABLES) {
      const screen = getScreen(table.id);
      expect(screen.group).toBe("explore");
      expect(EXPLORE_ITEMS).toContain(screen.item);
    }
  });

  test("every configured screen is built, not stubbed", () => {
    for (const table of EXPLORE_TABLES) {
      expect(getScreen(table.id).kind).toBe("table");
    }
  });

  test("configured screens share the Discover slice, so filters follow the user", () => {
    const keys = new Set(EXPLORE_TABLES.map((table) => stateKeyOf(getScreen(table.id))));
    expect([...keys]).toEqual(["explore.discover"]);
  });

  test("ids are unique and resolvable", () => {
    const ids = EXPLORE_TABLES.map((table) => table.id);
    expect(ids).toHaveLength(new Set(ids).size);
    for (const id of ids) expect(getExploreTable(id)).toBeDefined();
  });

  test("a screen with no config resolves to undefined rather than a default", () => {
    expect(getExploreTable("explore.logs")).toBeUndefined();
    expect(getExploreTable("issues.feed")).toBeUndefined();
  });

  test("every config requests the field it sorts by", () => {
    for (const table of EXPLORE_TABLES) {
      expect(table.fields).toContain(table.sort.replace(/^-/, ""));
    }
  });

  test("every config requests its id field, so rows have stable keys", () => {
    for (const table of EXPLORE_TABLES) {
      expect(table.fields).toContain(table.idField);
    }
  });

  test("fields within a config are unique", () => {
    for (const table of EXPLORE_TABLES) {
      expect(table.fields).toHaveLength(new Set(table.fields).size);
    }
  });

  test("every config names a referrer, a noun and a placeholder", () => {
    for (const table of EXPLORE_TABLES) {
      expect(table.referrer.startsWith("sentry-tui.")).toBe(true);
      expect(table.noun.length).toBeGreaterThan(0);
      expect(table.searchPlaceholder.length).toBeGreaterThan(0);
    }
  });

  test("referrers are distinct, so per-screen call volume stays attributable", () => {
    const referrers = EXPLORE_TABLES.map((table) => table.referrer);
    expect(referrers).toHaveLength(new Set(referrers).size);
  });
});

describe("field choices match the web app", () => {
  test("Traces asks for spansQueryParams' default fields and sort", () => {
    const traces = getExploreTable("explore.traces")!;
    expect(traces.dataset).toBe("spans");
    expect([...traces.fields]).toEqual([
      "id",
      "span.name",
      "span.description",
      "span.duration",
      "transaction",
      "timestamp",
    ]);
    expect(traces.sort).toBe("-timestamp");
    expect(traces.yAxis).toBe("count(span.duration)");
  });

  test("Metrics reads the tracemetrics dataset", () => {
    const metrics = getExploreTable("explore.metrics")!;
    expect(metrics.dataset).toBe("tracemetrics");
    expect([...metrics.fields]).toContain("metric.name");
    expect([...metrics.fields]).toContain("value");
  });

  test("Errors reads individual events from the errors dataset, not grouped issues", () => {
    const errors = getExploreTable("explore.errors")!;
    expect(errors.dataset).toBe("errors");
    // The issue stream's own columns — counts, users, assignee — are absent by
    // design: this screen is events, and looking like the issue stream would
    // make the distinction invisible.
    for (const grouped of ["count()", "count_unique(user)", "assignee", "lifetimeEvents"]) {
      expect(errors.fields).not.toContain(grouped);
    }
    expect(errors.fields).toContain("level");
  });

  test("Conversations filters spans down to gen-AI client calls", () => {
    const conversations = getExploreTable("explore.conversations")!;
    expect(conversations.dataset).toBe("spans");
    expect(conversations.baseQuery).toBe(
      "has:gen_ai.conversation.id gen_ai.operation.type:ai_client",
    );
    for (const genAi of conversations.fields.filter((f) => f !== "id" && f !== "timestamp")) {
      expect(genAi.startsWith("gen_ai.")).toBe(true);
    }
  });
});

describe("exploreQuery", () => {
  const traces = getExploreTable("explore.traces")!;
  const conversations = getExploreTable("explore.conversations")!;

  test("a table with no base filter sends the user's query untouched", () => {
    expect(exploreQuery(traces, "span.duration:>1s")).toBe("span.duration:>1s");
    expect(exploreQuery(traces, "")).toBe("");
  });

  test("a table with a base filter sends it when nothing is typed", () => {
    const base = conversations.baseQuery!;
    expect(exploreQuery(conversations, "")).toBe(base);
    expect(exploreQuery(conversations, "   ")).toBe(base);
  });

  test("both are ANDed, parenthesised so an OR can't swallow the base filter", () => {
    expect(exploreQuery(conversations, "a OR b")).toBe(
      "(has:gen_ai.conversation.id gen_ai.operation.type:ai_client) and (a OR b)",
    );
  });
});

describe("chart titles and empty states", () => {
  test("a bare count() is named after what it counts", () => {
    expect(exploreChartTitle(getExploreTable("explore.errors")!)).toBe("count(events)");
  });

  test("an aggregate that already names its field is left alone", () => {
    expect(exploreChartTitle(getExploreTable("explore.traces")!)).toBe("count(span.duration)");
    expect(exploreChartTitle(getExploreTable("explore.metrics")!)).toBe("count(value)");
    expect(exploreChartTitle(getExploreTable("explore.conversations")!)).toBe(
      "count_unique(gen_ai.conversation.id)",
    );
  });

  test("a gated dataset's empty state names the flag rather than claiming no results", () => {
    for (const table of EXPLORE_TABLES.filter((t) => t.feature)) {
      const lines = exploreEmptyLines(table, "").filter(Boolean).join(" ");
      expect(lines).toContain(table.feature!);
      expect(lines).toContain("may not have");
    }
  });

  test("the empty state echoes the query that found nothing", () => {
    const table = getExploreTable("explore.traces")!;
    expect(exploreEmptyLines(table, "span.duration:>1s")).toContain("span.duration:>1s");
    // An empty query has nothing to echo, so the line is dropped rather than blank.
    expect(exploreEmptyLines(table, "").filter(Boolean)).toHaveLength(2);
  });
});
