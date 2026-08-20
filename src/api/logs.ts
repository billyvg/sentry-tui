/**
 * Sentry Logs API (OUTP-based structured logging).
 *
 * The endpoint sits at `/organizations/{org}/logs/` and returns structured log
 * entries ingested via the Sentry SDK's `logger.*` API. Each entry has a
 * severity level, message body, timestamp, and arbitrary key-value attributes.
 */

import type { SentryClient } from "~/api/client";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type LogSeverity = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * A single log entry, as returned by the logs search endpoint.
 *
 * Modeled after the OUTP `LogRecord` shape that Sentry ingests, pruned to
 * what the TUI actually renders.
 */
export interface LogEntry {
  /** Server-assigned unique id for the log record. */
  id: string;
  /** ISO-8601 timestamp of when the log was emitted. */
  timestamp: string;
  /** Severity level. */
  severityText: LogSeverity;
  /** Numeric severity matching OTel conventions (1-24). */
  severityNumber: number;
  /** The log message body. */
  body: string;
  /** The project that emitted the log. */
  project: { id: string; slug: string; name?: string };
  /** Trace id, for cross-referencing with the Traces view. */
  traceId?: string;
  /** Span id within the trace. */
  spanId?: string;
  /** Arbitrary key-value attributes attached to the log. */
  attributes: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export const LOG_PAGE_SIZE = 50;
export const DEFAULT_LOG_PERIOD = "1h";

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
 * Fetch log entries from the organization logs endpoint.
 *
 * The real Sentry API uses `/organizations/{org}/logs/` which returns an
 * array of `LogEntry` objects, paginated with the standard cursor.
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
  const page = await client.request<LogEntry[]>(`/organizations/${org}/logs/`, {
    query: {
      query: query || undefined,
      statsPeriod,
      per_page: limit,
      cursor,
      project,
      environment,
    },
    signal,
  });
  return { data: page.data, nextCursor: page.nextCursor };
}
