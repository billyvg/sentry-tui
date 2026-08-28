/**
 * Saved issue views — the web app's Issues › All Views page.
 *
 * Mirrors `sentry/static/app/views/issueList/queries/useFetchGroupSearchViews.tsx`;
 * the response shape is the `GroupSearchViewSerializerResponse` TypedDict in
 * `sentry/api/serializers/models/groupsearchview.py`.
 */

import type { Page, SentryClient } from "~/api/client";
import type { SortOption } from "~/api/issues";

/**
 * Who created the views to return.
 *
 * The endpoint defaults to `me`, so listing the whole org's views takes two
 * requests — which is also how the web page renders them: two tables.
 */
export type ViewCreatedBy = "me" | "others";

/** Page filters saved with a view. `period` is a stats period like `14d`. */
export interface ViewTimeFilters {
  start?: string | null;
  end?: string | null;
  period?: string | null;
  utc?: boolean | null;
}

export interface GroupSearchView {
  id: string;
  name: string;
  query: string;
  querySort: SortOption;
  /** Project IDs. `[-1]` means all projects; `[]` means no project filter. */
  projects: number[];
  environments: string[];
  timeFilters: ViewTimeFilters;
  /** Per-requesting-user; null when never opened. */
  lastVisited: string | null;
  dateCreated: string;
  dateUpdated: string;
  /** Whether the requesting user has starred this view. */
  starred: boolean;
  /** How many users have starred it. */
  stars: number;
  createdBy: { id: string; name?: string; email?: string } | null;
}

/**
 * The web's default "Most Starred" ordering — `getEndpointSort` in
 * `issueViewsList.tsx` sends the two extra sorts as tiebreakers. The endpoint
 * also chains starred views ahead of unstarred ones regardless of sort.
 */
export const VIEW_SORT_OPTIONS = [
  { value: "popularity", label: "Most Starred" },
  { value: "visited", label: "Recently Viewed" },
  { value: "name", label: "Name (A-Z)" },
  { value: "-name", label: "Name (Z-A)" },
  { value: "-created", label: "Created (Newest)" },
  { value: "created", label: "Created (Oldest)" },
] as const;

export type ViewSort = (typeof VIEW_SORT_OPTIONS)[number]["value"];
export const DEFAULT_VIEW_SORT: ViewSort = "popularity";

/** Resolve the All Views state to one of the frontend's simplified sorts. */
export function viewSort(value: string): ViewSort {
  return VIEW_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as ViewSort)
    : DEFAULT_VIEW_SORT;
}

/** Add the frontend's stable tiebreakers to a simplified view sort. */
function endpointSort(sort: ViewSort): string[] {
  switch (sort) {
    case "popularity":
      return ["-popularity", "-visited", "-created"];
    case "visited":
      return ["-visited", "-popularity", "-created"];
    case "name":
      return ["name", "-visited", "-created"];
    case "-name":
      return ["-name", "-visited", "-created"];
    case "created":
      return ["created", "-popularity", "-visited"];
    case "-created":
      return ["-created", "-popularity", "-visited"];
  }
}

export const VIEWS_PAGE_SIZE = 20;

/** Fetch one saved issue view by id for a production URL or session restore. */
export async function fetchGroupSearchView(
  client: SentryClient,
  { org, viewId, signal }: { org: string; viewId: string; signal?: AbortSignal },
): Promise<GroupSearchView> {
  const page = await client.request<GroupSearchView>(
    `/organizations/${org}/group-search-views/${viewId}/`,
    { signal },
  );
  return page.data;
}

export async function listGroupSearchViews(
  client: SentryClient,
  {
    org,
    createdBy,
    sort = DEFAULT_VIEW_SORT,
    limit = VIEWS_PAGE_SIZE,
    cursor,
    signal,
  }: {
    org: string;
    createdBy: ViewCreatedBy;
    sort?: ViewSort;
    limit?: number;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<Page<GroupSearchView[]>> {
  return client.request<GroupSearchView[]>(`/organizations/${org}/group-search-views/`, {
    query: { createdBy, sort: endpointSort(sort), per_page: limit, cursor },
    signal,
  });
}
