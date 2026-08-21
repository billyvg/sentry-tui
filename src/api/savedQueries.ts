/**
 * Saved queries — Explore › All Queries and the legacy Explore › Discover list.
 *
 * Two endpoints answer with two unrelated wire shapes for the same idea: a
 * named, re-runnable query over one dataset.
 *
 * - `GET /organizations/{org}/explore/saved/` is the current one, serialized by
 *   `ExploreSavedQueryModelSerializer` and typed upstream as `ReadableSavedQuery`
 *   (`views/explore/hooks/useGetSavedQueries.tsx:106`).
 * - `GET /organizations/{org}/discover/saved/` is the legacy one, typed upstream
 *   as `SavedQuery extends NewQuery` (`types/organization.tsx:262`), and read by
 *   `views/discover/landing.tsx:111`.
 *
 * Both are normalised into one `SavedQuery` here, so the screen and the results
 * view stay unaware of which endpoint a row came from. Read-only: starring,
 * renaming and deleting are all writes and none of them live here.
 */

import type { SentryClient } from "~/api/client";
import type { DiscoverDataset } from "~/api/discover";

// ---------------------------------------------------------------------------
// Domain type
// ---------------------------------------------------------------------------

/** Which endpoint a saved query came from. */
export type SavedQuerySource = "explore" | "discover";

/**
 * A saved query, flattened to what a terminal can show and re-run.
 *
 * Deliberately lossy: aggregates, group-bys, visualizations and cross-events
 * all survive on the wire but have no home in a table, and building a query
 * editor is out of scope (see the plan's "Deliberately out of scope").
 */
export interface SavedQuery {
  /** Unique within a source; ids collide across the two endpoints. */
  id: string;
  source: SavedQuerySource;
  name: string;
  /** Human name of the dataset, e.g. `Traces` — what the Type column shows. */
  datasetLabel: string;
  /** The dataset `events/` wants when the query is re-run. */
  dataset: DiscoverDataset;
  /** The search query, in Sentry's search syntax. */
  query: string;
  /** Columns the query selects, in order. */
  fields: string[];
  /** Sort column, `-` prefixed for descending. */
  sort?: string;
  /** Project ids. `[-1]` is the "all projects" sentinel; `[]` means unfiltered. */
  projects: number[];
  environment: string[];
  /** Stats period the query was saved with, e.g. `14d`. */
  statsPeriod?: string;
  /** When the requesting user last opened it. Explore only. */
  lastVisited?: string;
  dateUpdated?: string;
  /** Whether the requesting user has starred it. Explore only. */
  starred: boolean;
  /** Display name of the creator; absent for a query Sentry ships. */
  createdBy?: string;
  /** One of Sentry's own queries rather than someone in the org's. */
  isPrebuilt: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Starred queries the sidebar will list, from
 * `views/explore/hooks/useGetSavedQueries.tsx:190`. It is also the `per_page`
 * the web sends, so the cap costs nothing beyond one small request.
 */
export const MAX_STARRED_SAVED_QUERIES_IN_NAV = 20;

/** Rows the All Queries table asks for. */
export const SAVED_QUERIES_PAGE_SIZE = 50;

/**
 * The web's default ordering for the table: starred first, then most recently
 * viewed (`savedQueriesTable.tsx:66` sends `sortBy: ['starred', sort]` with
 * `sort` defaulting to `recentlyViewed`).
 */
const EXPLORE_SORT = ["starred", "recentlyViewed"];

/** `landing.tsx:63` — the Discover list's default sort. */
const DISCOVER_SORT = "myqueries";

// ---------------------------------------------------------------------------
// Explore saved queries
// ---------------------------------------------------------------------------

/** Datasets an Explore saved query can be saved against. */
type ExploreDataset =
  | "logs"
  | "spans"
  | "segment_spans"
  | "metrics"
  | "replays"
  | "ai_conversations";

/** `DATASET_LABEL_MAP`, `useGetSavedQueries.tsx:307`. */
const EXPLORE_DATASET_LABEL: Record<ExploreDataset, string> = {
  logs: "Logs",
  spans: "Traces",
  segment_spans: "Traces",
  metrics: "Metrics",
  replays: "Replays",
  ai_conversations: "Conversations",
};

/**
 * The `events/` dataset each saved dataset re-runs against.
 *
 * Mirrors `DATASET_TO_TRACE_ITEM_DATASET_MAP` (`useGetSavedQueries.tsx:316`),
 * flattened to the strings `queryDiscover` sends: conversations are spans with
 * a filter, and segment spans are spans.
 */
const EXPLORE_DATASET_TO_EVENTS: Record<ExploreDataset, DiscoverDataset> = {
  logs: "logs",
  spans: "spans",
  segment_spans: "spans",
  metrics: "tracemetrics",
  replays: "replays",
  ai_conversations: "spans",
};

/** One entry of the `query` array on an Explore saved query. */
interface RawExploreQuery {
  fields?: unknown;
  query?: unknown;
  orderby?: unknown;
}

/** `ReadableSavedQuery`, with every field optional — this is untrusted wire data. */
interface RawExploreSavedQuery {
  id?: unknown;
  name?: unknown;
  dataset?: unknown;
  query?: unknown;
  projects?: unknown;
  environment?: unknown;
  range?: unknown;
  lastVisited?: unknown;
  dateUpdated?: unknown;
  starred?: unknown;
  isPrebuilt?: unknown;
  createdBy?: { name?: unknown; email?: unknown } | null;
}

export interface ListSavedQueriesParams {
  org: string;
  /** Only queries the requesting user has starred. */
  starred?: boolean;
  /** Free-text filter on the query's name. */
  search?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/**
 * List the org's Explore saved queries.
 *
 * @returns Queries in the endpoint's order, minus any whose `query` array is
 *   empty — the web drops those too (`useGetSavedQueries.tsx:246`), because a
 *   saved query with no query in it cannot be run or described.
 */
export async function listExploreSavedQueries(
  client: SentryClient,
  { org, starred, search, limit = SAVED_QUERIES_PAGE_SIZE, cursor, signal }: ListSavedQueriesParams,
): Promise<SavedQuery[]> {
  const page = await client.request<RawExploreSavedQuery[]>(
    `/organizations/${org}/explore/saved/`,
    {
      query: {
        sortBy: EXPLORE_SORT,
        per_page: limit,
        starred: starred ? 1 : undefined,
        query: search || undefined,
        cursor,
      },
      signal,
    },
  );

  return asArray(page.data).map(normaliseExplore).filter(isRunnable);
}

function normaliseExplore(raw: RawExploreSavedQuery, index: number): SavedQuery {
  const dataset = exploreDataset(raw.dataset);
  const first = firstQuery(raw.query);

  return {
    id: str(raw.id) ?? String(index),
    source: "explore",
    name: str(raw.name) ?? "Untitled query",
    datasetLabel: EXPLORE_DATASET_LABEL[dataset],
    dataset: EXPLORE_DATASET_TO_EVENTS[dataset],
    query: str(first?.query) ?? "",
    fields: strings(first?.fields),
    sort: str(first?.orderby),
    projects: numbers(raw.projects),
    environment: strings(raw.environment),
    statsPeriod: str(raw.range),
    lastVisited: str(raw.lastVisited),
    dateUpdated: str(raw.dateUpdated),
    starred: raw.starred === true,
    createdBy: raw.isPrebuilt === true ? undefined : actorName(raw.createdBy),
    isPrebuilt: raw.isPrebuilt === true,
  };
}

/** The first of a saved query's query objects — the one the table describes. */
function firstQuery(value: unknown): RawExploreQuery | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  return typeof first === "object" && first !== null ? (first as RawExploreQuery) : undefined;
}

function exploreDataset(value: unknown): ExploreDataset {
  const key = String(value ?? "spans");
  return key in EXPLORE_DATASET_LABEL ? (key as ExploreDataset) : "spans";
}

// ---------------------------------------------------------------------------
// Discover saved queries (legacy)
// ---------------------------------------------------------------------------

/**
 * `SavedQueryDatasets` → what the Type column says.
 *
 * `utils/discover/types.tsx:35`. A query saved before the dataset split carries
 * `discover`, which spans both.
 */
const DISCOVER_DATASET_LABEL: Record<string, string> = {
  "error-events": "Errors",
  "transaction-like": "Transactions",
  discover: "Discover",
};

/** `SavedQueryDatasets` → the `events/` dataset, `DiscoverDatasets` spelling. */
const DISCOVER_DATASET_TO_EVENTS: Record<string, DiscoverDataset> = {
  "error-events": "errors",
  "transaction-like": "transactions",
  discover: "discover",
};

/** `SavedQuery extends NewQuery`, untrusted. */
interface RawDiscoverSavedQuery {
  id?: unknown;
  name?: unknown;
  fields?: unknown;
  query?: unknown;
  orderby?: unknown;
  projects?: unknown;
  environment?: unknown;
  range?: unknown;
  dateUpdated?: unknown;
  queryDataset?: unknown;
  dataset?: unknown;
  createdBy?: { name?: unknown; email?: unknown } | null;
}

/**
 * List the org's legacy Discover saved queries.
 *
 * The `version:2` filter and the `name:"…"` search syntax are the endpoint's,
 * not ours — `landing.tsx:111` builds the same string. Version 1 queries are a
 * pre-Discover-2 format the UI has never rendered.
 */
export async function listDiscoverSavedQueries(
  client: SentryClient,
  { org, search, limit = SAVED_QUERIES_PAGE_SIZE, cursor, signal }: ListSavedQueriesParams,
): Promise<SavedQuery[]> {
  const trimmed = search?.trim();
  const page = await client.request<RawDiscoverSavedQuery[]>(
    `/organizations/${org}/discover/saved/`,
    {
      query: {
        query: trimmed ? `version:2 name:"${trimmed}"` : "version:2",
        sortBy: DISCOVER_SORT,
        per_page: limit,
        cursor,
      },
      signal,
    },
  );

  return asArray(page.data).map(normaliseDiscover).filter(isRunnable);
}

function normaliseDiscover(raw: RawDiscoverSavedQuery, index: number): SavedQuery {
  // `queryDataset` is the saved answer; `dataset` is what the backend inferred.
  // Prefer the saved one, and fall back to the whole of Discover.
  const key = str(raw.queryDataset) ?? "discover";

  return {
    id: str(raw.id) ?? String(index),
    source: "discover",
    name: str(raw.name) ?? "Untitled query",
    datasetLabel: DISCOVER_DATASET_LABEL[key] ?? "Discover",
    dataset: DISCOVER_DATASET_TO_EVENTS[key] ?? "discover",
    query: str(raw.query) ?? "",
    fields: strings(raw.fields),
    // `orderby` is `string | string[]`; only the first sort reaches `events/`.
    sort: Array.isArray(raw.orderby) ? str(raw.orderby[0]) : str(raw.orderby),
    projects: numbers(raw.projects),
    environment: strings(raw.environment),
    statsPeriod: str(raw.range),
    dateUpdated: str(raw.dateUpdated),
    starred: false,
    createdBy: actorName(raw.createdBy),
    isPrebuilt: false,
  };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** List the org's saved queries from whichever endpoint the screen wants. */
export function listSavedQueries(
  client: SentryClient,
  source: SavedQuerySource,
  params: ListSavedQueriesParams,
): Promise<SavedQuery[]> {
  return source === "explore"
    ? listExploreSavedQueries(client, params)
    : listDiscoverSavedQueries(client, params);
}

/**
 * A saved query's projects as the slugs the rest of the app filters by.
 *
 * Saved queries carry project *ids* while `FilterBar` and screen state speak
 * slugs. `-1` is Sentry's "all projects" sentinel, and an id with no slug means
 * the project list hasn't landed or the project is gone; both drop out,
 * because filtering on a number the app reads as a slug matches nothing at
 * all, and no filter is the honest fallback.
 *
 * @param slugById Slug per project id — build it from `useProjects`.
 */
export function savedQueryProjectSlugs(
  query: SavedQuery,
  slugById: ReadonlyMap<string, string>,
): string[] {
  return query.projects
    .filter((id) => id !== -1)
    .map((id) => slugById.get(String(id)))
    .filter((slug): slug is string => slug !== undefined);
}

/**
 * A query with no columns cannot be re-run and has nothing to show, so it is
 * dropped rather than rendered as an empty row.
 */
function isRunnable(query: SavedQuery): boolean {
  return query.fields.length > 0;
}

function asArray<T>(body: T[] | undefined): T[] {
  return Array.isArray(body) ? body.filter((row) => typeof row === "object" && row !== null) : [];
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

/** The creator's display name — their name, else their email. */
function actorName(
  actor: { name?: unknown; email?: unknown } | null | undefined,
): string | undefined {
  if (!actor) return undefined;
  return str(actor.name) ?? str(actor.email);
}
