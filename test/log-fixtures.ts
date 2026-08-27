/**
 * Test fixtures for structured logs.
 *
 * Two shapes: `rawLogRows` matches what the Discover `/events/?dataset=logs`
 * endpoint actually returns, and `logEntriesFixture` is the normalised form
 * the UI consumes after `listLogs` reshapes it.
 */

import type { LogEntry, LogSeverity, LogTimeseriesBucket } from "~/api/logs";
import type { DiscoverRow } from "~/api/discover";

// ---------------------------------------------------------------------------
// Raw Discover rows (wire format)
// ---------------------------------------------------------------------------

interface RawLogRow extends DiscoverRow {
  "sentry.item_id": string;
  timestamp: string;
  "sentry.severity": string;
  message: string;
  trace?: string;
  project?: string;
}

function makeRaw(
  id: string,
  severity: string,
  message: string,
  project: string,
  trace?: string,
): RawLogRow {
  const base = 1_700_000_000 + Number(id) * 1000;
  return {
    "sentry.item_id": id,
    timestamp: new Date(base * 1000).toISOString(),
    "sentry.severity": severity,
    message,
    project,
    ...(trace ? { trace } : {}),
  };
}

/** Fixture data in the shape the API actually returns (inside `{ data: [...] }`). */
export const rawLogRowsFixture: RawLogRow[] = [
  makeRaw("1", "error", "Failed to process payment: card declined", "billing", "abc123def456"),
  makeRaw("2", "warn", "Rate limit approaching for Stripe API (85% used)", "billing"),
  makeRaw("3", "info", "User login successful", "javascript", "trace_login_001"),
  makeRaw("4", "debug", "Cache miss for key user:profile:u_123, fetching from DB", "backend"),
  makeRaw(
    "5",
    "error",
    "Connection pool exhausted, rejecting new connections",
    "backend",
    "trace_db_001",
  ),
  makeRaw("6", "info", "Inference request completed in 245ms", "ml-service", "trace_ml_001"),
  makeRaw(
    "7",
    "warn",
    "Slow database query detected: SELECT * FROM orders WHERE… (3.2s)",
    "backend",
  ),
  makeRaw("8", "fatal", "Worker process crashed with OOM: allocated 4.2GB, limit 4GB", "worker"),
  makeRaw("9", "info", "Deployment started: v2.14.3 → v2.14.4", "backend"),
  makeRaw("10", "debug", "WebSocket connection established for user u_456", "javascript"),
  makeRaw("11", "trace", "Entering middleware: authenticate", "backend"),
  makeRaw(
    "12",
    "error",
    "Timeout waiting for inference response from model service",
    "ml-service",
    "trace_ml_timeout",
  ),
  makeRaw(
    "13",
    "info",
    "Cron job completed: cleanup_expired_sessions (removed 1,247 sessions)",
    "worker",
  ),
  makeRaw("14", "warn", "Certificate expiring in 7 days for *.example.com", "backend"),
  makeRaw(
    "15",
    "info",
    "Feature flag evaluated: new_checkout_flow = true for user u_42",
    "javascript",
  ),
  makeRaw(
    "16",
    "debug",
    "Background job enqueued: send_welcome_email (queue: email, priority: low)",
    "worker",
  ),
  makeRaw(
    "17",
    "error",
    "Failed to send webhook: connection refused to https://hooks.example.com/events",
    "backend",
    "trace_webhook_001",
  ),
  makeRaw("18", "info", "Search index rebuilt: 42,831 documents in 12.4s", "backend"),
  makeRaw("19", "warn", "Disk usage at 89% on /data volume", "worker"),
  makeRaw(
    "20",
    "info",
    "API request completed: GET /api/v2/users 200 (23ms)",
    "backend",
    "trace_api_001",
  ),
];

// ---------------------------------------------------------------------------
// Normalised entries (what the UI sees after listLogs)
// ---------------------------------------------------------------------------

function makeLog(
  id: string,
  severity: LogSeverity,
  body: string,
  projectSlug: string,
  traceId?: string,
): LogEntry {
  const base = 1_700_000_000 + Number(id) * 1000;
  return {
    id,
    timestamp: new Date(base * 1000).toISOString(),
    severityText: severity,
    body,
    projectSlug,
    ...(traceId ? { traceId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Timeseries buckets (for the bar chart)
// ---------------------------------------------------------------------------

/**
 * 24 five-minute buckets covering two hours, simulating realistic log volume.
 * Timestamps start at 2023-11-14T14:00:00 UTC (1700000400).
 */
export const logTimeseriesFixture: LogTimeseriesBucket[] = Array.from(
  { length: 24 },
  (_, i): LogTimeseriesBucket => {
    const ts = 1700000400 + i * 300; // 5-min intervals
    // Create a realistic-looking volume pattern: base ~100k with a couple spikes.
    const base = 95_000 + Math.floor(Math.sin(i * 0.5) * 15_000);
    const spike = i === 7 || i === 8 ? 250_000 : 0;
    return [ts, [{ count: base + spike }]];
  },
);

/** `/events-timeseries/` response containing the log-volume fixture. */
export const logEventsTimeseriesFixture = {
  timeSeries: [
    {
      yAxis: "count()",
      values: logTimeseriesFixture.map(([timestamp, values]) => ({
        timestamp: timestamp * 1000,
        value: values[0]?.count ?? 0,
      })),
      meta: { interval: 300_000, valueType: "integer", valueUnit: null },
    },
  ],
};

// ---------------------------------------------------------------------------
// Normalised entries (what the UI sees after listLogs)
// ---------------------------------------------------------------------------

export const logEntriesFixture: LogEntry[] = [
  makeLog("1", "error", "Failed to process payment: card declined", "billing", "abc123def456"),
  makeLog("2", "warn", "Rate limit approaching for Stripe API (85% used)", "billing"),
  makeLog("3", "info", "User login successful", "javascript", "trace_login_001"),
  makeLog("4", "debug", "Cache miss for key user:profile:u_123, fetching from DB", "backend"),
  makeLog(
    "5",
    "error",
    "Connection pool exhausted, rejecting new connections",
    "backend",
    "trace_db_001",
  ),
  makeLog("6", "info", "Inference request completed in 245ms", "ml-service", "trace_ml_001"),
  makeLog(
    "7",
    "warn",
    "Slow database query detected: SELECT * FROM orders WHERE… (3.2s)",
    "backend",
  ),
  makeLog("8", "fatal", "Worker process crashed with OOM: allocated 4.2GB, limit 4GB", "worker"),
  makeLog("9", "info", "Deployment started: v2.14.3 → v2.14.4", "backend"),
  makeLog("10", "debug", "WebSocket connection established for user u_456", "javascript"),
  makeLog("11", "trace", "Entering middleware: authenticate", "backend"),
  makeLog(
    "12",
    "error",
    "Timeout waiting for inference response from model service",
    "ml-service",
    "trace_ml_timeout",
  ),
  makeLog(
    "13",
    "info",
    "Cron job completed: cleanup_expired_sessions (removed 1,247 sessions)",
    "worker",
  ),
  makeLog("14", "warn", "Certificate expiring in 7 days for *.example.com", "backend"),
  makeLog(
    "15",
    "info",
    "Feature flag evaluated: new_checkout_flow = true for user u_42",
    "javascript",
  ),
  makeLog(
    "16",
    "debug",
    "Background job enqueued: send_welcome_email (queue: email, priority: low)",
    "worker",
  ),
  makeLog(
    "17",
    "error",
    "Failed to send webhook: connection refused to https://hooks.example.com/events",
    "backend",
    "trace_webhook_001",
  ),
  makeLog("18", "info", "Search index rebuilt: 42,831 documents in 12.4s", "backend"),
  makeLog("19", "warn", "Disk usage at 89% on /data volume", "worker"),
  makeLog(
    "20",
    "info",
    "API request completed: GET /api/v2/users 200 (23ms)",
    "backend",
    "trace_api_001",
  ),
];
