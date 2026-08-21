/**
 * Deterministic Monitors API data.
 *
 * Kept beside `dashboard-fixtures.ts` rather than in `fixtures.ts` for the
 * same reason: these are one feature's responses, and several people are
 * adding one such file each.
 *
 * The list covers all five detector types the row draws differently, plus the
 * three shapes that have caught rows out before: a disabled detector, one with
 * no owner and no last issue, and one whose data source came back without a
 * `queryObj`.
 */

import type { Detector } from "~/api/detectors";

/** `GET /organizations/{org}/detectors/` — one of each type. */
export const detectorListFixture: Detector[] = [
  {
    id: "1",
    name: "checkout p95 latency",
    type: "metric_issue",
    enabled: true,
    projectId: "42",
    owner: { id: "1", name: "Ada Lovelace", type: "user", email: "ada@example.com" },
    workflowIds: ["11", "12"],
    latestGroup: {
      id: "900",
      title: "Metric breached: p95(span.duration)",
      shortId: "JAVASCRIPT-7",
      lastSeen: "2026-08-21T11:00:00Z",
      project: { id: "42", slug: "checkout" },
    },
    config: { detectionType: "static" },
    conditionGroup: {
      id: "5",
      logicType: "any",
      conditions: [{ id: "6", type: "gt", comparison: 500, conditionResult: 75 }],
    },
    dataSources: [
      {
        id: "20",
        type: "snuba_query_subscription",
        queryObj: {
          id: "21",
          snubaQuery: {
            id: "22",
            aggregate: "p95(span.duration)",
            dataset: "events_analytics_platform",
            query: "transaction:/checkout span.op:http.server",
            timeWindow: 3600,
            environment: "production",
          },
        },
      },
    ],
  },
  {
    id: "2",
    name: "nightly-billing-rollup",
    type: "monitor_check_in_failure",
    enabled: true,
    projectId: "43",
    owner: { id: "7", name: "billing-team", type: "team" },
    workflowIds: [],
    latestGroup: null,
    dataSources: [
      {
        id: "30",
        type: "cron_monitor",
        queryObj: {
          id: "cron-1",
          slug: "nightly-billing-rollup",
          name: "nightly-billing-rollup",
          config: { schedule: "0 9 * * *", schedule_type: "crontab", timezone: "UTC" },
          environments: [{ name: "production", status: "ok", lastCheckIn: "2026-08-21T09:00:12Z" }],
        },
      },
    ],
  },
  {
    id: "3",
    name: "marketing site uptime",
    type: "uptime_domain_failure",
    enabled: true,
    projectId: "44",
    owner: null,
    workflowIds: ["13"],
    latestGroup: {
      id: "901",
      title: "Downtime detected for https://example.com",
      lastSeen: "2026-08-20T22:13:00Z",
      project: { id: "44", slug: "marketing" },
    },
    config: { mode: "manual", downtimeThreshold: 3, recoveryThreshold: 1 },
    dataSources: [
      {
        id: "40",
        type: "uptime_subscription",
        queryObj: {
          url: "https://example.com/pricing?utm_source=sentry-tui-fixture",
          intervalSeconds: 60,
          method: "GET",
          timeoutMs: 10000,
        },
      },
    ],
  },
  {
    id: "4",
    name: "android download size",
    type: "preprod_size_analysis",
    // Disabled: the whole row renders muted.
    enabled: false,
    projectId: "45",
    owner: { id: "2", name: "Grace Hopper", type: "user" },
    workflowIds: [],
    latestGroup: null,
    config: { measurement: "download_size", thresholdType: "absolute" },
    dataSources: [],
  },
  {
    id: "5",
    name: "All Errors",
    type: "error",
    enabled: true,
    projectId: "42",
    owner: null,
    workflowIds: [],
    latestGroup: {
      id: "902",
      title: "TypeError: undefined is not a function",
      lastSeen: "2026-08-21T10:30:00Z",
      project: { id: "42", slug: "checkout" },
    },
    dataSources: [],
  },
  {
    id: "6",
    name: "session-cleanup",
    type: "monitor_check_in_failure",
    enabled: true,
    projectId: "43",
    owner: null,
    workflowIds: [],
    // A data source with no `queryObj` — the row keeps its project and drops
    // the schedule rather than throwing.
    dataSources: [{ id: "31", type: "cron_monitor", queryObj: null }],
  },
];

/** `GET /organizations/{org}/projects/` — the ids the detectors above point at. */
export const monitorProjectsFixture = [
  { id: "42", slug: "checkout", name: "Checkout", platform: "javascript" },
  { id: "43", slug: "billing", name: "Billing", platform: "python" },
  { id: "44", slug: "marketing", name: "Marketing", platform: "javascript-react" },
  { id: "45", slug: "mobile", name: "Mobile", platform: "android" },
];
