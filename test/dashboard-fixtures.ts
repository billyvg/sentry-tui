/**
 * Deterministic Dashboards API data.
 *
 * Kept beside `log-fixtures.ts` rather than in `fixtures.ts` for the same
 * reason: these are one feature's responses, and several people are adding one
 * such file each.
 */

import type { DashboardListItem } from "~/api/dashboards";

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
    prebuiltId: "frontend-overview",
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
