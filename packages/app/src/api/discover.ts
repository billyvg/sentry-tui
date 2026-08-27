/**
 * The Discover query endpoints — one code path for every tabular screen.
 *
 * Most of Explore is the same request with a different `dataset` and
 * `field[]`: `GET /organizations/{org}/events/` returns rows in a flat tabular
 * format, and `GET /organizations/{org}/events-timeseries/` returns Explore's
 * matching volume timeseries. Screens supply the dataset, the fields, and a row
 * normaliser; nothing here knows what a log or a span is.
 *
 * Manual refresh only — nothing in this module polls. `events/` rate limits
 * are undocumented per dataset and every screen is another caller.
 */

import { fetchPage_listOrganizationEvents, type ListOrganizationEventsData } from "@sentry/api";

import type { SentryClient } from "~/api/client";
import { projectParams } from "~/api/projectParams";
import { chartInterval } from "~/lib/interval";

/**
 * Datasets the `events/` endpoint accepts.
 *
 * Listed rather than left as `string` so a typo is a type error, and left open
 * (`string & {}`) because Sentry adds datasets faster than we can track them.
 */
export type DiscoverDataset =
  | "logs"
  | "spans"
  | "errors"
  | "transactions"
  | "tracemetrics"
  | "profiles"
  | "discover"
  | (string & {});

/** One row of a Discover response: field name → value, exactly as returned. */
export type DiscoverRow = Record<string, unknown>;

export interface QueryDiscoverParams {
  org: string;
  dataset: DiscoverDataset;
  /** Columns to request. Sent as repeated `field=` params, order preserved. */
  fields: readonly string[];
  /** Sort column, `-` prefixed for descending. */
  sort?: string;
  /** Search query in Sentry's search syntax. Empty means unfiltered. */
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  cursor?: string;
  limit?: number;
  /** Attribution string Sentry logs per caller. */
  referrer?: string;
  signal?: AbortSignal;
}

export interface DiscoverPage {
  rows: DiscoverRow[];
  nextCursor: string | null;
}

export const DISCOVER_PAGE_SIZE = 50;

type GeneratedDiscoverDataset = NonNullable<ListOrganizationEventsData["query"]>["dataset"];

const GENERATED_DISCOVER_DATASETS = new Set<DiscoverDataset>([
  "errors",
  "logs",
  "spans",
  "tracemetrics",
]);

/** Envelope the `events/` endpoint returns. */
interface DiscoverResponse {
  data: DiscoverRow[];
}

/**
 * Run a Discover query.
 *
 * @returns The raw rows, plus the cursor for the next page. Reshaping a row
 *   into a domain type is the caller's job — see `listLogs` for the pattern.
 */
export async function queryDiscover(
  client: SentryClient,
  {
    org,
    dataset,
    fields,
    sort,
    query = "",
    statsPeriod,
    project,
    environment,
    cursor,
    limit = DISCOVER_PAGE_SIZE,
    referrer,
    signal,
  }: QueryDiscoverParams,
): Promise<DiscoverPage> {
  if (isGeneratedDiscoverDataset(dataset)) {
    const page = await fetchPage_listOrganizationEvents(
      {
        ...client.generatedOptions(signal),
        path: { organization_id_or_slug: org },
        query: {
          dataset,
          field: [...fields],
          sort,
          query: query || undefined,
          statsPeriod,
          per_page: limit,
          project: projectParams(project),
          environment,
          referrer,
        },
      },
      cursor,
    );

    return { rows: unwrapRows(page.data), nextCursor: page.nextCursor ?? null };
  }

  // Some internal/legacy datasets used by dashboards and profiling are not
  // represented in the public schema yet. Keep those on the flexible path.
  const page = await client.request<DiscoverResponse>(`/organizations/${org}/events/`, {
    query: {
      dataset,
      field: [...fields],
      sort,
      query: query || undefined,
      statsPeriod,
      per_page: limit,
      cursor,
      project: projectParams(project),
      environment,
      referrer,
    },
    signal,
  });

  return { rows: unwrapRows(page.data), nextCursor: page.nextCursor };
}

/** Narrow the open-ended app dataset union to the generated operation's set. */
function isGeneratedDiscoverDataset(dataset: DiscoverDataset): dataset is GeneratedDiscoverDataset {
  return GENERATED_DISCOVER_DATASETS.has(dataset);
}

/**
 * A single `[unixSeconds, [{count: N}]]` bucket from `events-stats/`.
 *
 * The nested array is the endpoint's own shape — one entry per series, of
 * which single-`yAxis` queries have exactly one.
 */
export type TimeseriesBucket = [number, Array<{ count: number }>, { incomplete?: boolean }?];

export interface QueryTimeseriesParams {
  org: string;
  dataset: DiscoverDataset;
  /** Aggregate to plot, e.g. `count()`. */
  yAxis?: string;
  query?: string;
  statsPeriod?: string;
  /**
   * Bucket width. Defaults to the finest the window allows, as Explore's chart
   * does on the web — see `~/lib/interval`.
   */
  interval?: string;
  project?: string[];
  environment?: string[];
  referrer?: string;
  signal?: AbortSignal;
}

/**
 * Fetch the volume timeseries for a Discover query, for `BarChart`.
 *
 * Same filters as `queryDiscover`, so a screen can pass the identical
 * arguments to both and get a chart that agrees with its table.
 */
export async function queryDiscoverTimeseries(
  client: SentryClient,
  {
    org,
    dataset,
    yAxis = "count()",
    query = "",
    statsPeriod,
    interval = chartInterval(statsPeriod),
    project,
    environment,
    referrer,
    signal,
  }: QueryTimeseriesParams,
): Promise<TimeseriesBucket[]> {
  const page = await client.request<{ data: TimeseriesBucket[] }>(
    `/organizations/${org}/events-stats/`,
    {
      query: {
        dataset,
        yAxis,
        query: query || undefined,
        statsPeriod,
        interval,
        project: projectParams(project),
        environment,
        referrer,
      },
      signal,
    },
  );

  return unwrapBuckets(page.data);
}

interface EventsTimeseriesValue {
  /** Milliseconds since the Unix epoch. */
  timestamp: number;
  value: number | null;
  incomplete?: boolean;
}

interface EventsTimeseriesSeries {
  yAxis: string;
  values: EventsTimeseriesValue[];
}

interface EventsTimeseriesResponse {
  timeSeries: EventsTimeseriesSeries[];
}

export interface QueryExploreTimeseriesParams extends QueryTimeseriesParams {
  /** Attributes that split the response into top series. */
  groupBy?: readonly string[];
  /** Top-series order, in the endpoint's `-field` spelling. */
  sort?: string;
  /** Number of grouped series to return before the Other series. */
  topEvents?: number;
}

/**
 * Fetch the canonical Explore timeseries and adapt it to the chart's bucket
 * shape. Unlike the legacy events-stats route, timestamps arrive in
 * milliseconds and values carry the server's provisional-bucket marker.
 */
export async function queryExploreTimeseries(
  client: SentryClient,
  {
    org,
    dataset,
    yAxis = "count()",
    query = "",
    statsPeriod,
    interval = chartInterval(statsPeriod),
    project,
    environment,
    referrer,
    signal,
    groupBy,
    sort,
    topEvents,
  }: QueryExploreTimeseriesParams,
): Promise<TimeseriesBucket[]> {
  const page = await client.request<EventsTimeseriesResponse>(
    `/organizations/${org}/events-timeseries/`,
    {
      query: {
        dataset,
        yAxis,
        query: query || undefined,
        statsPeriod,
        interval,
        project: projectParams(project),
        environment,
        referrer,
        partial: 1,
        excludeOther: 0,
        sampling: "NORMAL",
        groupBy: groupBy ? [...groupBy] : undefined,
        sort,
        topEvents,
      },
      signal,
    },
  );

  const series = Array.isArray(page.data?.timeSeries) ? page.data.timeSeries : [];
  const combined = new Map<number, { count: number; incomplete: boolean }>();
  for (const item of series.flatMap((entry) =>
    Array.isArray(entry?.values) ? entry.values : [],
  )) {
    if (!item || !Number.isFinite(item.timestamp)) continue;
    const value = item.value === null ? 0 : Number(item.value);
    if (!Number.isFinite(value)) continue;
    const current = combined.get(item.timestamp);
    combined.set(item.timestamp, {
      count: (current?.count ?? 0) + value,
      incomplete: Boolean(current?.incomplete || item.incomplete),
    });
  }
  return [...combined.entries()]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, value]) => [
      timestamp / 1000,
      [{ count: value.count }],
      { incomplete: value.incomplete || undefined },
    ]);
}

/**
 * Take the row array out of whatever the endpoint returned.
 *
 * The client hands back the parsed body as `Page.data`, and the body is itself
 * `{data: [...]}` — but some deployments answer with a bare array. Both shapes
 * are accepted rather than trusted, since a malformed body would otherwise
 * reach the renderer as `undefined.map`.
 */
function unwrapRows(body: DiscoverResponse | DiscoverRow[] | undefined): DiscoverRow[] {
  if (Array.isArray(body)) return body.filter(isRow);
  const rows = body?.data;
  return Array.isArray(rows) ? rows.filter(isRow) : [];
}

function isRow(value: unknown): value is DiscoverRow {
  return typeof value === "object" && value !== null;
}

function unwrapBuckets(
  body: { data: TimeseriesBucket[] } | TimeseriesBucket[] | undefined,
): TimeseriesBucket[] {
  const buckets = Array.isArray(body) ? body : body?.data;
  // Shape-checked, not just unwrapped: the chart destructures every bucket, so
  // one row of the wrong shape is a crash in a render rather than a bad chart.
  return Array.isArray(buckets) ? buckets.filter(isBucket) : [];
}

function isBucket(value: unknown): value is TimeseriesBucket {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number";
}

// ---------------------------------------------------------------------------
// Row readers
// ---------------------------------------------------------------------------

/** Read a field as a string, or `undefined` when absent or empty. */
export function rowString(row: DiscoverRow, field: string): string | undefined {
  const value = row[field];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** Read a field as a finite number, or `undefined` when it isn't one. */
export function rowNumber(row: DiscoverRow, field: string): number | undefined {
  const value = Number(row[field]);
  return Number.isFinite(value) ? value : undefined;
}
