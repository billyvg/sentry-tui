/**
 * Sentry Logs — the `dataset=logs` view of Discover.
 *
 * Logs are queried through `/organizations/{org}/events/`, not a dedicated
 * `/logs/` route, so everything here is a thin domain layer over
 * `queryDiscover`: pick the fields, name the sort, reshape the flat row.
 */

import type { SentryClient } from "~/api/client";
import {
  queryDiscover,
  queryDiscoverTimeseries,
  rowString,
  type DiscoverRow,
  type TimeseriesBucket,
} from "~/api/discover";

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

const LOG_SORT = "-timestamp";

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

/** Fetch log entries via the Discover `events` endpoint. */
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
  const page = await queryDiscover(client, {
    org,
    dataset: "logs",
    fields: LOG_FIELDS,
    sort: LOG_SORT,
    query,
    statsPeriod,
    project,
    environment,
    cursor,
    limit,
    signal,
  });

  return { data: page.rows.map(normalise), nextCursor: page.nextCursor };
}

/** Reshape a flat Discover row into the structured `LogEntry` the UI needs. */
function normalise(row: DiscoverRow, index: number): LogEntry {
  return {
    id: rowString(row, "sentry.item_id") ?? String(index),
    timestamp: rowString(row, "timestamp") ?? "",
    severityText: parseSeverity(row["sentry.severity"]),
    body: rowString(row, "message") ?? "",
    traceId: rowString(row, "trace"),
    projectSlug: rowString(row, "project"),
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
export type LogTimeseriesBucket = TimeseriesBucket;

export interface ListLogTimeseriesParams {
  org: string;
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  signal?: AbortSignal;
}

/** Fetch aggregated log volume over time, for the bar chart. */
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
  return queryDiscoverTimeseries(client, {
    org,
    dataset: "logs",
    yAxis: "count()",
    query,
    statsPeriod,
    project,
    environment,
    referrer: "sentry-tui.logs-chart",
    signal,
  });
}
