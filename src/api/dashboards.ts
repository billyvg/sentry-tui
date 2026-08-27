/**
 * Dashboards — the org's saved dashboards.
 *
 * `GET /organizations/{org}/dashboards/` backs both list screens: `All
 * Dashboards` is the unfiltered call and `Sentry Built` is the same one with
 * `filter=onlyPrebuilt` (`utils/dashboards/dashboardsApiOptions.tsx:19-41`).
 * The starred list the sidebar draws is its own route
 * (`dashboardsApiOptions.tsx:8-17`).
 *
 * Read-only: nothing here stars, duplicates, or deletes a dashboard.
 */

import type { Page, SentryClient } from "~/api/client";

/**
 * A widget's chart type, as `DisplayType` in `views/dashboards/types.tsx:40-55`.
 *
 * Left open (`string & {}`) because Sentry adds display types faster than a
 * terminal can learn to draw them — an unknown one must render an honest
 * placeholder rather than fail to type-check.
 */
export const WIDGET_DISPLAY_TYPES = [
  "area",
  "bar",
  "line",
  "table",
  "big_number",
  "details",
  "server_tree",
  "rage_and_dead_clicks",
  "top_n",
  "wheel",
  "categorical_bar",
  "agents_traces_table",
  "text",
  "heatmap",
] as const;

export type WidgetDisplayType = (typeof WIDGET_DISPLAY_TYPES)[number] | (string & {});

/** The subset of a Sentry user the dashboard table's Owner column draws. */
export interface DashboardOwner {
  id?: string;
  name?: string;
  email?: string;
}

/**
 * Who may edit a dashboard.
 *
 * Absent, or `isEditableByEveryone`, means everyone — `editAccessSelector.tsx:68`
 * treats the two the same.
 */
export interface DashboardPermissions {
  isEditableByEveryone: boolean;
  /** Team IDs granted edit access when it isn't open to everyone. */
  teamsWithEditAccess?: number[];
}

/** A row of `GET /organizations/{org}/dashboards/`. */
export interface DashboardListItem {
  id: string;
  title: string;
  /** One entry per widget; empty for prebuilts whose config lives in Sentry Web. */
  widgetDisplay: WidgetDisplayType[];
  description?: string;
  createdBy?: DashboardOwner | null;
  dateCreated?: string;
  /** When the requesting user last opened it; absent if never. */
  lastVisited?: string | null;
  /** Whether the requesting user has starred it. */
  isFavorited?: boolean;
  permissions?: DashboardPermissions | null;
  /** Set on Sentry-built (prebuilt) dashboards; absent on the org's own. */
  prebuiltId?: number | null;
  projects?: number[];
  environment?: string[];
}

/**
 * Server-side filters the list endpoint accepts, as `DashboardFilter` in
 * `views/dashboards/types.tsx:13-21`. Only `onlyPrebuilt` is used today.
 */
export type DashboardListFilter = "onlyPrebuilt" | "onlyFavorites" | "owned" | (string & {});

/**
 * Sort orders `organization_dashboards.py:533-627` understands. An unknown one
 * falls back to title order rather than erroring, and `recentlyViewed` degrades
 * to the org-wide last-visited when `dashboards-user-last-visited` is off — so
 * neither depends on a feature flag we cannot read.
 */
export const DASHBOARD_SORT_OPTIONS = [
  { value: "mydashboards", label: "My Dashboards" },
  { value: "title", label: "Name (A-Z)" },
  { value: "-title", label: "Name (Z-A)" },
  { value: "-dateCreated", label: "Newest Created" },
  { value: "dateCreated", label: "Oldest Created" },
  { value: "mostPopular", label: "Most Popular" },
  { value: "recentlyViewed", label: "Recently Viewed" },
] as const;

export type DashboardSort = (typeof DASHBOARD_SORT_OPTIONS)[number]["value"];

/** Sort choices for an ordinary or Sentry-built dashboard list. */
export function dashboardSortOptions(prebuilt: boolean) {
  return prebuilt
    ? DASHBOARD_SORT_OPTIONS.filter((option) => option.value !== "mydashboards")
    : DASHBOARD_SORT_OPTIONS;
}

/** Resolve shared screen state to a sort supported by this dashboard list. */
export function dashboardSort(
  value: string,
  fallback: DashboardSort,
  prebuilt: boolean,
): DashboardSort {
  return dashboardSortOptions(prebuilt).some((option) => option.value === value)
    ? (value as DashboardSort)
    : fallback;
}

/**
 * Rows fetched per list screen.
 *
 * The web pages at `DASHBOARD_TABLE_NUM_ROWS = 25` (`manage/settings.tsx:1`);
 * the terminal list scrolls instead of paging, so it asks for more in one go.
 */
export const DASHBOARDS_PAGE_SIZE = 50;

/** `MAX_STARRED_DASHBOARDS_IN_NAV` — `dashboardsApiOptions.tsx:6`. */
export const STARRED_DASHBOARDS_IN_NAV = 20;

export interface ListDashboardsParams {
  org: string;
  /** Server-side filter, e.g. `onlyPrebuilt` for the Sentry Built screen. */
  filter?: DashboardListFilter;
  /** Free-text title match, from the screen's search bar. */
  query?: string;
  sort?: DashboardSort;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/** List the org's dashboards. */
export async function listDashboards(
  client: SentryClient,
  { org, filter, query, sort, limit = DASHBOARDS_PAGE_SIZE, cursor, signal }: ListDashboardsParams,
): Promise<Page<DashboardListItem[]>> {
  const page = await client.request<DashboardListItem[]>(`/organizations/${org}/dashboards/`, {
    query: {
      filter,
      query: query || undefined,
      sort,
      // Match Web's manage list: favorites must stay on the loaded page even
      // when an organization has more dashboards than `per_page` can hold.
      pin: "favorites",
      per_page: limit,
      cursor,
    },
    signal,
  });
  return page;
}

/**
 * The dashboards the requesting user has starred, for the sidebar section.
 *
 * Its own route rather than `?filter=onlyFavorites`, matching
 * `starredDashboardsApiOptions` — the two are ordered differently, and the
 * starred one is what the nav is built from.
 */
export async function listStarredDashboards(
  client: SentryClient,
  {
    org,
    limit = STARRED_DASHBOARDS_IN_NAV,
    signal,
  }: { org: string; limit?: number; signal?: AbortSignal },
): Promise<DashboardListItem[]> {
  const page = await client.request<DashboardListItem[]>(
    `/organizations/${org}/dashboards/starred/`,
    { query: { per_page: limit }, signal },
  );
  return Array.isArray(page.data) ? page.data : [];
}

// ---------------------------------------------------------------------------
// Dashboard detail and its widgets
// ---------------------------------------------------------------------------

/**
 * One or more aggregates over one filter — `WidgetQuery` in
 * `views/dashboards/types.tsx:115-143`.
 *
 * `fields` is the legacy union of `columns` and `aggregates`, kept because it
 * is what carries a table widget's column *order*; `columns` and `aggregates`
 * are what everything else reads.
 */
export interface WidgetQuery {
  name: string;
  /** Search query in Sentry's syntax; empty means unfiltered. */
  conditions: string;
  /** Grouping columns, e.g. `transaction`. */
  columns: string[];
  /** Aggregate expressions, e.g. `count()`, `p95(span.duration)`. */
  aggregates: string[];
  /** Sort field, `-` prefixed for descending. */
  orderby: string;
  /** Column order for a table widget; `[...columns, ...aggregates]` otherwise. */
  fields?: string[];
  /** Display names for `fields`, positionally. */
  fieldAliases?: string[];
  /** Which aggregate a big-number widget shows, when it has several. */
  selectedAggregate?: number;
}

/**
 * A widget's slot on the web's 6-column react-grid-layout
 * (`views/dashboards/types.tsx:179-182`).
 *
 * The terminal doesn't reproduce the grid — it stacks widgets one per row — but
 * `y` then `x` is still the reading order the author laid out.
 */
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minH?: number;
}

/**
 * The dataset a widget queries, as `WidgetType` in
 * `views/dashboards/types.tsx:57-68`. Not every one is reachable through
 * `events/` — see `widgetDataset`.
 */
export type WidgetType =
  | "discover"
  | "issue"
  | "metrics"
  | "custom-metrics"
  | "error-events"
  | "transaction-like"
  | "spans"
  | "logs"
  | "tracemetrics"
  | "preprod-app-size"
  | (string & {});

/** A widget on a dashboard — `Widget` in `views/dashboards/types.tsx:157-177`. */
export interface DashboardWidget {
  id?: string;
  title: string;
  description?: string | null;
  displayType: WidgetDisplayType;
  widgetType?: WidgetType | null;
  queries: WidgetQuery[];
  interval?: string;
  /** `topEvents` for a top-N or categorical widget; null when unset. */
  limit?: number | null;
  layout?: WidgetLayout | null;
}

/** `GET /organizations/{org}/dashboards/{id}/`. */
export interface DashboardDetails {
  id: string;
  title: string;
  widgets: DashboardWidget[];
  dateCreated?: string;
  createdBy?: DashboardOwner | null;
  /** Saved page filters. Project ids, not slugs. */
  projects?: number[];
  environment?: string[] | null;
  /** Saved stats period, e.g. `"14d"`; absent when the dashboard pins dates. */
  period?: string;
  start?: string;
  end?: string;
  isFavorited?: boolean;
  permissions?: DashboardPermissions | null;
  prebuiltId?: number | null;
}

/** Fetch a dashboard and its widgets. One request; the widgets fetch their own data. */
export async function getDashboard(
  client: SentryClient,
  { org, id, signal }: { org: string; id: string; signal?: AbortSignal },
): Promise<DashboardDetails> {
  const page = await client.request<DashboardDetails>(`/organizations/${org}/dashboards/${id}/`, {
    signal,
  });
  const dashboard = page.data;
  // Widgets are what the whole screen is; a body without them would reach the
  // renderer as `undefined.map`.
  return { ...dashboard, widgets: Array.isArray(dashboard?.widgets) ? dashboard.widgets : [] };
}
