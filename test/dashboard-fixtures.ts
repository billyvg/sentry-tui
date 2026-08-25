/**
 * Deterministic Dashboards API data.
 *
 * Kept beside `log-fixtures.ts` rather than in `fixtures.ts` for the same
 * reason: these are one feature's responses, and several people are adding one
 * such file each.
 */

import type { DashboardDetails, DashboardListItem } from "~/api/dashboards";

/** `GET /organizations/{org}/dashboards/` — the org's own dashboards. */
export const dashboardListFixture: DashboardListItem[] = [
  {
    id: "101",
    title: "Checkout Health",
    widgetDisplay: ["big_number", "line", "table"],
    createdBy: { id: "1", name: "Ada Lovelace", email: "ada@example.com" },
    dateCreated: "2026-06-01T09:00:00Z",
    lastVisited: "2026-08-19T12:00:00Z",
    isFavorited: true,
    permissions: { isEditableByEveryone: true },
    projects: [42],
    environment: [],
  },
  {
    id: "102",
    title: "Mobile Crash Rates",
    widgetDisplay: ["bar", "big_number"],
    createdBy: { id: "2", name: "Grace Hopper", email: "grace@example.com" },
    dateCreated: "2026-05-14T09:00:00Z",
    lastVisited: null,
    isFavorited: false,
    // Restricted to its creator plus two teams — the `Creator +2` access cell.
    permissions: { isEditableByEveryone: false, teamsWithEditAccess: [7, 8] },
    projects: [],
    environment: [],
  },
  {
    id: "103",
    title: "API Latency",
    widgetDisplay: [],
    // No `createdBy` and no `permissions`: the Owner cell falls back to Sentry
    // and the Access cell to `All`.
    dateCreated: "2026-07-02T09:00:00Z",
    isFavorited: false,
    projects: [],
    environment: [],
  },
];

/** `GET /organizations/{org}/dashboards/?filter=onlyPrebuilt`. */
export const prebuiltDashboardsFixture: DashboardListItem[] = [
  {
    id: "900",
    title: "Frontend Overview",
    description: "Web Vitals, errors and throughput for your frontend projects.",
    widgetDisplay: ["big_number", "area", "table"],
    prebuiltId: 14,
    dateCreated: "2026-01-01T00:00:00Z",
    lastVisited: "2026-08-20T08:00:00Z",
    isFavorited: false,
    projects: [],
    environment: [],
  },
];

/** `GET /organizations/{org}/dashboards/starred/`. */
export const starredDashboardsFixture: DashboardListItem[] = [
  {
    id: "101",
    title: "Checkout Health",
    widgetDisplay: ["big_number", "line", "table"],
    isFavorited: true,
    projects: [],
    environment: [],
  },
];

// ---------------------------------------------------------------------------
// Dashboard detail and widgets
// ---------------------------------------------------------------------------

/**
 * `GET /organizations/{org}/dashboards/101/`.
 *
 * One widget per renderable kind, plus the two kinds of fallback: a display
 * type the terminal can't draw (`wheel`) and a dataset it can't read (an issue
 * widget). Laid out out of order on purpose — the grid sorts by `y` then `x`,
 * and the response order is not that order.
 */
export const dashboardDetailFixture: DashboardDetails = {
  id: "101",
  title: "Checkout Health",
  dateCreated: "2026-06-01T09:00:00Z",
  period: "24h",
  projects: [],
  environment: [],
  widgets: [
    {
      id: "w-bars",
      title: "Errors by Browser",
      displayType: "categorical_bar",
      widgetType: "error-events",
      limit: 4,
      layout: { x: 0, y: 2, w: 6, h: 2 },
      queries: [
        {
          name: "",
          conditions: "event.type:error",
          columns: ["browser.name"],
          aggregates: ["count()"],
          orderby: "-count()",
        },
      ],
    },
    {
      id: "w-number",
      title: "Errors Today",
      displayType: "big_number",
      widgetType: "error-events",
      layout: { x: 0, y: 0, w: 2, h: 1 },
      queries: [
        {
          name: "",
          conditions: "event.type:error",
          columns: [],
          aggregates: ["count()"],
          orderby: "",
        },
      ],
    },
    {
      id: "w-series",
      title: "Error Rate",
      displayType: "line",
      widgetType: "spans",
      layout: { x: 2, y: 0, w: 4, h: 2 },
      queries: [{ name: "", conditions: "", columns: [], aggregates: ["count()"], orderby: "" }],
    },
    {
      id: "w-table",
      title: "Slowest Transactions",
      displayType: "table",
      widgetType: "spans",
      limit: 3,
      layout: { x: 0, y: 1, w: 6, h: 2 },
      queries: [
        {
          name: "",
          conditions: "",
          columns: ["transaction"],
          aggregates: ["p95(span.duration)"],
          fields: ["transaction", "p95(span.duration)"],
          fieldAliases: ["", "p95"],
          orderby: "-p95(span.duration)",
        },
      ],
    },
    {
      id: "w-wheel",
      title: "Traffic Wheel",
      displayType: "wheel",
      widgetType: "spans",
      layout: { x: 0, y: 3, w: 6, h: 2 },
      queries: [{ name: "", conditions: "", columns: [], aggregates: ["count()"], orderby: "" }],
    },
    {
      id: "w-issues",
      title: "Unresolved Issues",
      displayType: "table",
      widgetType: "issue",
      limit: 3,
      layout: { x: 0, y: 4, w: 6, h: 2 },
      queries: [
        {
          name: "",
          conditions: "is:unresolved",
          columns: ["title"],
          aggregates: [],
          fields: ["title"],
          orderby: "",
        },
      ],
    },
  ],
};

/** `events/` with `field=count()` — the big-number widget. */
export const widgetCountRowsFixture = [{ "count()": 41234 }];

/** `events/` with `field=transaction` — the table widget. */
export const widgetTableRowsFixture = [
  { transaction: "/checkout", "p95(span.duration)": 1820.4 },
  { transaction: "/cart", "p95(span.duration)": 940 },
  { transaction: "/api/orders", "p95(span.duration)": 415 },
];

/** `events/` with `field=browser.name` — the categorical bar widget. */
export const widgetBarRowsFixture = [
  { "browser.name": "Chrome", "count()": 800 },
  { "browser.name": "Safari", "count()": 420 },
  { "browser.name": "Firefox", "count()": 120 },
];

/** `events-stats/` — the series widget. */
export const widgetTimeseriesFixture: Array<[number, Array<{ count: number }>]> = Array.from(
  { length: 12 },
  (_, i) => [1_700_000_000 + i * 3600, [{ count: (i % 5) * 30 + 10 }]],
);
