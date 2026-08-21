import { describe, expect, test } from "bun:test";

import {
  bigNumberAggregate,
  formatWidgetValue,
  tableFields,
  tableHeaders,
  tableRowLimit,
  unsupportedReason,
  widgetDataset,
  widgetRenderKind,
  type WidgetRenderKind,
} from "~/api/dashboardWidgets";
import type { DashboardWidget, WidgetDisplayType, WidgetQuery, WidgetType } from "~/api/dashboards";

/**
 * Every display type upstream defines, from `views/dashboards/types.tsx:40-55`.
 * Kept as one exhaustive table so a new display type shows up here as a
 * deliberate decision rather than as a blank card in production.
 */
const DISPLAY_TYPES: ReadonlyArray<[WidgetDisplayType, WidgetRenderKind]> = [
  ["area", "series"],
  ["bar", "series"],
  ["line", "series"],
  ["table", "table"],
  ["big_number", "number"],
  ["details", "unsupported"],
  ["server_tree", "unsupported"],
  ["rage_and_dead_clicks", "unsupported"],
  ["top_n", "table"],
  ["wheel", "unsupported"],
  ["categorical_bar", "bars"],
  ["agents_traces_table", "unsupported"],
  ["text", "unsupported"],
  ["heatmap", "unsupported"],
];

function query(overrides: Partial<WidgetQuery> = {}): WidgetQuery {
  return { name: "", conditions: "", columns: [], aggregates: [], orderby: "", ...overrides };
}

function widget(overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return { title: "W", displayType: "table", queries: [query()], ...overrides };
}

describe("widgetRenderKind", () => {
  for (const [displayType, kind] of DISPLAY_TYPES) {
    test(`${displayType} renders as ${kind}`, () => {
      expect(widgetRenderKind(displayType)).toBe(kind);
    });
  }

  test("covers every display type Sentry defines today", () => {
    expect(DISPLAY_TYPES).toHaveLength(14);
  });

  test("a display type nobody has heard of falls back rather than crashing", () => {
    expect(widgetRenderKind("hologram")).toBe("unsupported");
    expect(widgetRenderKind("")).toBe("unsupported");
  });

  test("the fallback says what it can't draw", () => {
    expect(unsupportedReason(widget({ displayType: "wheel" }))).toContain("wheel");
    expect(unsupportedReason(widget({ displayType: "wheel" }))).toContain("terminal");
  });
});

describe("widgetDataset", () => {
  const cases: ReadonlyArray<[WidgetType | null | undefined, string | null]> = [
    [undefined, "discover"],
    [null, "discover"],
    ["discover", "discover"],
    ["error-events", "errors"],
    ["transaction-like", "transactions"],
    ["spans", "spans"],
    ["logs", "ourlogs"],
    ["tracemetrics", "tracemetrics"],
    ["preprod-app-size", "preprodSize"],
    // Neither reads `events/`, so there is nothing to ask for.
    ["issue", null],
    ["metrics", null],
    ["custom-metrics", null],
    ["something-new", null],
  ];

  for (const [widgetType, dataset] of cases) {
    test(`${String(widgetType)} → ${String(dataset)}`, () => {
      expect(widgetDataset(widgetType)).toBe(dataset);
    });
  }

  test("a widget on an unreachable dataset says so, not that it can't be drawn", () => {
    const reason = unsupportedReason(widget({ displayType: "table", widgetType: "issue" }));
    expect(reason).toContain("issue");
    expect(reason).toContain("events API");
  });
});

describe("query shaping", () => {
  test("a big number shows the aggregate its author picked", () => {
    const q = query({ aggregates: ["count()", "p95(span.duration)"], selectedAggregate: 1 });
    expect(bigNumberAggregate(q)).toBe("p95(span.duration)");
  });

  test("a big number with no selection shows the first aggregate", () => {
    expect(bigNumberAggregate(query({ aggregates: ["count_unique(user)"] }))).toBe(
      "count_unique(user)",
    );
  });

  test("a big number with no aggregates at all still asks for something", () => {
    expect(bigNumberAggregate(query())).toBe("count()");
  });

  test("a table keeps the column order `fields` carries", () => {
    const q = query({
      columns: ["transaction"],
      aggregates: ["count()"],
      fields: ["count()", "transaction"],
    });
    expect(tableFields(q)).toEqual(["count()", "transaction"]);
  });

  test("a table saved before the split falls back to columns then aggregates", () => {
    const q = query({ columns: ["transaction"], aggregates: ["count()"] });
    expect(tableFields(q)).toEqual(["transaction", "count()"]);
  });

  test("aliases become the header where the author set one", () => {
    const q = query({ fields: ["transaction", "count()"], fieldAliases: ["", "Events"] });
    expect(tableHeaders(q, tableFields(q))).toEqual(["transaction", "Events"]);
  });

  test("table rows stay inside the limits the web itself imposes", () => {
    expect(tableRowLimit(widget())).toBe(5);
    expect(tableRowLimit(widget({ limit: 3 }))).toBe(3);
    expect(tableRowLimit(widget({ limit: 500 }))).toBe(10);
    expect(tableRowLimit(widget({ limit: 0 }))).toBe(1);
  });
});

describe("formatWidgetValue", () => {
  test("an absent value is a dash, not NaN", () => {
    expect(formatWidgetValue(undefined)).toBe("—");
    expect(formatWidgetValue(Number.NaN)).toBe("—");
  });

  test("small integers print as themselves", () => {
    expect(formatWidgetValue(0)).toBe("0");
    expect(formatWidgetValue(9999)).toBe("9999");
  });

  test("large integers are abbreviated", () => {
    expect(formatWidgetValue(10_000)).toBe("10k");
    expect(formatWidgetValue(1_460_000)).toBe("1.5m");
    expect(formatWidgetValue(-2_000_000_000)).toBe("-2b");
  });

  test("fractions keep two decimals, so a rate isn't rounded to nothing", () => {
    expect(formatWidgetValue(0.0421)).toBe("0.04");
    expect(formatWidgetValue(99.5)).toBe("99.50");
  });
});
