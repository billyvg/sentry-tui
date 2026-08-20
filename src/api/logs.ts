/**
 * Sentry Logs API — structured logging via the Discover `events` endpoint.
 *
 * Logs are queried through `/organizations/{org}/events/` with
 * `dataset=logs`, not a dedicated `/logs/` route. The response shape is the
 * standard Discover tabular format: `{ data: Array<Record<string, unknown>> }`.
 */

import type { SentryClient } from "~/api/client";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type LogSeverity = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * A normalised log entry, assembled from the flat Discover row.
 *
 * The raw API returns fields like `sentry.item_id`, `sentry.severity`,
 * `timestamp`, `message`, and `trace`. We reshape those into something
 * the UI can render without worrying about column names.
 */
export interface LogEntry {
  /** Server-assigned unique id for the log record. */
  id: string;
  /** ISO-8601 timestamp of when the log was emitted. */
  timestamp: string;
  /** Severity level. */
  severityText: LogSeverity;
  /** The log message body. */
  body: string;
  /** Trace id, for cross-referencing with the Traces view. */
  traceId?: string;
  /** The project name from the Discover row. */
  projectSlug?: string;
}

// ---------------------------------------------------------------------------
// Wire types (what the API actually returns)
// ---------------------------------------------------------------------------

/** A single row from `/events/?dataset=logs`. */
interface RawLogRow {
  "sentry.item_id"?: string;
  timestamp?: string;
  "sentry.severity"?: string;
  message?: string;
  trace?: string;
  project?: string;
  [key: string]: unknown;
}

/** The Discover response envelope. */
interface DiscoverResponse {
  data: RawLogRow[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LOG_PAGE_SIZE = 50;
export const DEFAULT_LOG_PERIOD = "1h";

/** Columns requested from the Discover endpoint. */
const LOG_FIELDS = [
  "sentry.item_id",
  "trace",
  "sentry.severity",
  "timestamp",
  "message",
  "project",
] as const;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface ListLogsParams {
  org: string;
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Fetch log entries via the Discover `events` endpoint.
 *
 * The web app hits `GET /organizations/{org}/events/?dataset=logs&field=…`,
 * which returns rows in the standard Discover tabular format.
 */
export async function listLogs(
  client: SentryClient,
  {
    org,
    query = "",
    statsPeriod = DEFAULT_LOG_PERIOD,
    project,
    environment,
    cursor,
    limit = LOG_PAGE_SIZE,
    signal,
  }: ListLogsParams,
): Promise<{ data: LogEntry[]; nextCursor: string | null }> {
  const page = await client.request<DiscoverResponse>(`/organizations/${org}/events/`, {
    query: {
      dataset: "logs",
      field: [...LOG_FIELDS],
      sort: "-timestamp",
      query: query || undefined,
      statsPeriod,
      per_page: limit,
      cursor,
      project,
      environment,
    },
    signal,
  });

  const rows = Array.isArray(page.data) ? page.data : (page.data?.data ?? []);
  return { data: rows.map(normalise), nextCursor: page.nextCursor };
}

/** Reshape a flat Discover row into the structured `LogEntry` the UI needs. */
function normalise(row: RawLogRow, index: number): LogEntry {
  return {
    id: String(row["sentry.item_id"] ?? index),
    timestamp: String(row.timestamp ?? ""),
    severityText: parseSeverity(row["sentry.severity"]),
    body: String(row.message ?? ""),
    traceId: row.trace ? String(row.trace) : undefined,
    projectSlug: row.project ? String(row.project) : undefined,
  };
}

function parseSeverity(raw: unknown): LogSeverity {
  const valid: LogSeverity[] = ["trace", "debug", "info", "warn", "error", "fatal"];
  const s = String(raw ?? "info").toLowerCase() as LogSeverity;
  return valid.includes(s) ? s : "info";
}

// ---------------------------------------------------------------------------
// Time-series (bar chart)
// ---------------------------------------------------------------------------

/** A single `[unixSeconds, [{count: N}]]` bucket from the events-stats API. */
export type LogTimeseriesBucket = [number, Array<{ count: number }>];

export interface ListLogTimeseriesParams {
  org: string;
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  signal?: AbortSignal;
}

/**
 * Fetch aggregated log volume over time.
 *
 * Hits `GET /organizations/{org}/events-stats/?dataset=logs&yAxis=count()`
 * which returns `{ data: [[timestamp, [{count: N}]], …] }`.
 */
export async function listLogTimeseries(
  client: SentryClient,
  {
    org,
    query = "",
    statsPeriod = DEFAULT_LOG_PERIOD,
    project,
    environment,
    signal,
  }: ListLogTimeseriesParams,
): Promise<LogTimeseriesBucket[]> {
  const page = await client.request<{ data: LogTimeseriesBucket[] }>(
    `/organizations/${org}/events-stats/`,
    {
      query: {
        dataset: "logs",
        yAxis: "count()",
        query: query || undefined,
        statsPeriod,
        project,
        environment,
        referrer: "sentry-tui.logs-chart",
      },
      signal,
    },
  );

  return Array.isArray(page.data) ? page.data : (page.data?.data ?? []);
}
