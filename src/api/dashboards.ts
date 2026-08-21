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
export type WidgetDisplayType =
  | "area"
  | "bar"
  | "line"
  | "table"
  | "big_number"
  | "details"
  | "server_tree"
  | "rage_and_dead_clicks"
  | "top_n"
  | "wheel"
  | "categorical_bar"
  | "agents_traces_table"
  | "text"
  | "heatmap"
  | (string & {});

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
  /** One entry per widget — its length is the table's Widgets column. */
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
  prebuiltId?: string | null;
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
export type DashboardSort =
  | "recentlyViewed"
  | "mostPopular"
  | "mydashboards"
  | "title"
  | "dateCreated";

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
  return client.request<DashboardListItem[]>(`/organizations/${org}/dashboards/`, {
    query: {
      filter,
      query: query || undefined,
      sort,
      per_page: limit,
      cursor,
    },
    signal,
  });
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
