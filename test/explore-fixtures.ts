/**
 * Wire-format fixtures for the four Discover-backed Explore tables.
 *
 * Each set is what `/organizations/{org}/events/` returns for that dataset —
 * flat rows keyed by the field names the config asks for — so a test exercises
 * the same normalisation the app does rather than a pre-digested shape.
 */

import type { DiscoverRow, TimeseriesBucket } from "~/api/discover";

/** Fixed base so timestamps are stable: 2023-11-14T22:13:20Z. */
const BASE_SECONDS = 1_700_000_000;

function isoAt(offsetSeconds: number): string {
  return new Date((BASE_SECONDS + offsetSeconds) * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Traces (dataset=spans)
// ---------------------------------------------------------------------------

/**
 * Six spans spanning four orders of magnitude of duration, so the
 * proportional bar has something to be proportional to.
 */
export const rawSpanRowsFixture: DiscoverRow[] = [
  {
    id: "a3f2c1d8b4e5f607",
    "span.name": "db.query",
    "span.description": "SELECT * FROM orders WHERE customer_id = %s",
    "span.duration": 1240,
    transaction: "/api/orders",
    timestamp: isoAt(0),
  },
  {
    id: "7b9e0a4412cc31de",
    "span.name": "http.client",
    "span.description": "GET /api/organizations/acme/projects/",
    "span.duration": 340.5,
    transaction: "/dashboard",
    timestamp: isoAt(-5),
  },
  {
    id: "c10ff33ab9007e21",
    "span.name": "cache.get",
    "span.description": "GET user:profile:u_123",
    "span.duration": 0.42,
    transaction: "/dashboard",
    timestamp: isoAt(-11),
  },
  {
    id: "d44b18e9902af7c3",
    "span.name": "queue.publish",
    "span.description": "publish send_welcome_email",
    "span.duration": 12.75,
    transaction: "/api/signup",
    timestamp: isoAt(-19),
  },
  {
    id: "e5510cbb7734a8f0",
    "span.name": "db.transaction",
    "span.description": "BEGIN; UPDATE inventory SET stock = stock - 1; COMMIT",
    "span.duration": 8420,
    transaction: "/api/checkout",
    timestamp: isoAt(-27),
  },
  {
    id: "f60a2d3cc1b95e44",
    "span.name": "http.server",
    "span.description": "POST /api/checkout",
    "span.duration": 9010,
    transaction: "/api/checkout",
    timestamp: isoAt(-33),
  },
];

// ---------------------------------------------------------------------------
// Metrics (dataset=tracemetrics)
// ---------------------------------------------------------------------------

export const rawMetricRowsFixture: DiscoverRow[] = [
  {
    id: "m0000000000000001",
    "metric.name": "checkout.latency",
    "metric.type": "distribution",
    value: 248.5,
    "metric.unit": "millisecond",
    project: "backend",
    timestamp: isoAt(0),
  },
  {
    id: "m0000000000000002",
    "metric.name": "cart.items",
    "metric.type": "gauge",
    value: 3,
    "metric.unit": "none",
    project: "backend",
    timestamp: isoAt(-7),
  },
  {
    id: "m0000000000000003",
    "metric.name": "signup.completed",
    "metric.type": "counter",
    value: 1,
    "metric.unit": "none",
    project: "javascript",
    timestamp: isoAt(-14),
  },
];

// ---------------------------------------------------------------------------
// Errors (dataset=errors)
// ---------------------------------------------------------------------------

export const rawErrorRowsFixture: DiscoverRow[] = [
  {
    id: "9f1c2b3a4d5e6f70",
    title: "TypeError: Cannot read property 'id' of undefined",
    level: "error",
    project: "javascript",
    "user.display": "ada@example.com",
    timestamp: isoAt(0),
  },
  {
    id: "80a1b2c3d4e5f601",
    title: "OperationalError: could not connect to server",
    level: "fatal",
    project: "backend",
    "user.display": "grace@example.com",
    timestamp: isoAt(-42),
  },
  {
    id: "71b2c3d4e5f60712",
    title: "Deprecation: legacy checkout endpoint called",
    level: "warning",
    project: "backend",
    "user.display": "",
    timestamp: isoAt(-90),
  },
];

// ---------------------------------------------------------------------------
// Timeseries
// ---------------------------------------------------------------------------

/** Twelve five-minute buckets, for the chart above any of the tables. */
export const exploreTimeseriesFixture: TimeseriesBucket[] = Array.from(
  { length: 12 },
  (_, i): TimeseriesBucket => [BASE_SECONDS + i * 300, [{ count: 40 + i * 7 }]],
);

/** `/events-timeseries/` response for Explore, including its provisional tail. */
export const exploreEventsTimeseriesFixture = {
  timeSeries: [
    {
      yAxis: "count()",
      values: exploreTimeseriesFixture.map(([timestamp, values], index) => ({
        timestamp: timestamp * 1000,
        value: values[0]?.count ?? 0,
        incomplete: index === exploreTimeseriesFixture.length - 1,
      })),
      meta: { interval: 300_000, valueType: "integer", valueUnit: null },
    },
  ],
};
