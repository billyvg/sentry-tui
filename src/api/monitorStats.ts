/**
 * Check-in statistics for the cron and uptime timelines.
 *
 * Two endpoints, one shape. Both take a window and a resolution and answer
 * with buckets already counted per status — which is exactly what a row of
 * character cells wants, so nothing here re-buckets anything. `src/lib/
 * checkInTimeline.ts` folds those buckets onto however many cells the column
 * has; this module's whole job is to ask for the right number of them and to
 * make sure what comes back is the shape it claims to be.
 *
 * ```text
 * cron    GET /organizations/{org}/monitors-stats/  ?monitor=…&since&until&resolution
 * uptime  GET /organizations/{org}/uptime-stats/    ?uptimeDetectorId=…&since&until&resolution
 * ```
 *
 * The two differ in one respect worth knowing before reading the schemas: a
 * cron bucket is nested one level deeper, by *environment*, because a single
 * monitor checks in under several. `selectEnvironment` is what flattens that.
 *
 * Read-only. Neither endpoint has a write side.
 */

import { z } from "zod";

import type { SentryClient } from "~/api/client";
import {
  resolutionForWidth,
  type CronCheckInStatus,
  type StatsBucket,
  type UptimeCheckStatus,
} from "~/lib/checkInTimeline";

/**
 * Per-status counts, as both endpoints emit them.
 *
 * Deliberately permissive: `catchall(z.number())` keeps a status added
 * server-side rather than dropping it, and the timeline draws an unrecognised
 * status as `?` instead of pretending the window was quiet. A non-numeric
 * count is dropped, because the alternative is `NaN` reaching a render.
 */
const statusCountsSchema = z.record(z.string(), z.number()).catch({});

/**
 * `[timestamp, counts]`, uptime's shape — `CheckStatusBucket` in
 * `views/alerts/rules/uptime/types.tsx:87`.
 */
const uptimeBucketSchema = z.tuple([z.number(), statusCountsSchema]);

/**
 * `[timestamp, {env: counts}]`, cron's shape — `MonitorBucket` in
 * `views/insights/crons/types.tsx:203`.
 */
const cronBucketSchema = z.tuple([z.number(), z.record(z.string(), statusCountsSchema).catch({})]);

/**
 * `Record<monitorGuid, MonitorBucket[]>`.
 *
 * Every layer is `.catch()`ed to its empty value. A stats response that
 * surprises us should cost the row its sparkline, never the screen: the
 * timeline is decoration beside a monitor's name, and the name is the part
 * someone came for.
 */
const monitorStatsSchema = z.record(z.string(), z.array(cronBucketSchema).catch([])).catch({});

/** `Record<uptimeDetectorId, CheckStatusBucket[]>`. */
const uptimeStatsSchema = z.record(z.string(), z.array(uptimeBucketSchema).catch([])).catch({});

/** One cron monitor's buckets, still nested by environment. */
export type CronEnvironmentBucket = readonly [
  timestamp: number,
  environments: Readonly<Record<string, Readonly<Record<string, number>>>>,
];

/** Cron stats, keyed by monitor guid. */
export type MonitorStats = Readonly<Record<string, readonly CronEnvironmentBucket[]>>;

/** Uptime stats, keyed by uptime detector id. */
export type UptimeStats = Readonly<Record<string, ReadonlyArray<StatsBucket<UptimeCheckStatus>>>>;

/**
 * Uptime detector ids per request — `MAX_UPTIME_SUBSCRIPTION_IDS`, enforced by
 * `organization_uptime_stats.py:61-65` with a 400 rather than a truncation.
 */
export const MAX_UPTIME_DETECTORS_PER_REQUEST = 100;

/**
 * The window a row's timeline covers by default.
 *
 * A day is what the web's monitor list opens on, and it is the window in which
 * an hourly cron has enough check-ins to draw a shape and a daily one still
 * shows today's.
 */
export const DEFAULT_TIMELINE_WINDOW_SECONDS = 24 * 60 * 60;

/** The time window and bucket size one request covers. */
export interface StatsWindow {
  /** Window start, unix seconds. */
  since: number;
  /** Window end, unix seconds. */
  until: number;
  /** Bucket size in seconds — `resolutionForWidth` picks it from the column. */
  resolution: number;
}

/**
 * The window to draw in a column `width` cells wide, ending now.
 *
 * The resolution is derived from the width rather than fixed, which is what
 * makes the row reflow on resize instead of clipping — see
 * `resolutionForWidth`.
 *
 * @param width Cells the timeline column has.
 * @param now Milliseconds since the epoch; injectable so tests are deterministic.
 */
export function timelineWindow(
  width: number,
  { windowSeconds = DEFAULT_TIMELINE_WINDOW_SECONDS, now = Date.now() } = {},
): StatsWindow {
  const until = Math.floor(now / 1000);
  return {
    since: until - windowSeconds,
    until,
    resolution: resolutionForWidth(windowSeconds, width),
  };
}

/** Query parameters both endpoints share — `StatsMixin._parse_args`. */
function windowQuery({ since, until, resolution }: StatsWindow) {
  return { since, until, resolution: `${resolution}s` };
}

export interface MonitorStatsParams extends StatsWindow {
  org: string;
  /** Monitor guids, from a cron detector's `dataSources[0].queryObj.id`. */
  monitors: readonly string[];
  /** Project ids or slugs to scope to; the org's accessible projects otherwise. */
  project?: readonly string[];
  environment?: readonly string[];
  signal?: AbortSignal;
}

/**
 * Check-in counts for one or more cron monitors.
 *
 * @returns Buckets per monitor guid. An empty object for an empty `monitors`
 *   list, without a request — the endpoint answers `{}` for one anyway.
 */
export async function fetchMonitorStats(
  client: SentryClient,
  { org, monitors, project, environment, signal, ...window }: MonitorStatsParams,
): Promise<MonitorStats> {
  if (monitors.length === 0) return {};
  const page = await client.request<unknown>(`/organizations/${org}/monitors-stats/`, {
    query: {
      monitor: [...monitors],
      project: project ? [...project] : undefined,
      environment: environment ? [...environment] : undefined,
      ...windowQuery(window),
    },
    signal,
  });
  return monitorStatsSchema.parse(page.data) as MonitorStats;
}

export interface UptimeStatsParams extends StatsWindow {
  org: string;
  /** Uptime detector ids — the detector's own id, not a data source's. */
  detectorIds: readonly string[];
  signal?: AbortSignal;
}

/**
 * Check counts for one or more uptime monitors.
 *
 * @returns Buckets per detector id. The endpoint 400s on an empty id list and
 *   on more than `MAX_UPTIME_DETECTORS_PER_REQUEST`, so both are handled here
 *   rather than surfaced as a failed row.
 */
export async function fetchUptimeStats(
  client: SentryClient,
  { org, detectorIds, signal, ...window }: UptimeStatsParams,
): Promise<UptimeStats> {
  const ids = [...new Set(detectorIds)].slice(0, MAX_UPTIME_DETECTORS_PER_REQUEST);
  if (ids.length === 0) return {};
  const page = await client.request<unknown>(`/organizations/${org}/uptime-stats/`, {
    query: { uptimeDetectorId: ids, ...windowQuery(window) },
    signal,
  });
  return uptimeStatsSchema.parse(page.data) as UptimeStats;
}

/**
 * Flatten one cron monitor's environment-nested buckets to the timeline's shape.
 *
 * Mirrors `selectCheckInData` (`crons/utils/selectCheckInData.tsx`), with one
 * addition: passing no environment sums across all of them. The web always has
 * an environment to hand because it draws one timeline per environment in a
 * stack; a table row has one line, so the unscoped total is what it draws.
 *
 * @param environment Environment name to isolate, or omitted for every one.
 */
export function selectEnvironment(
  buckets: readonly CronEnvironmentBucket[] | undefined,
  environment?: string,
): Array<StatsBucket<CronCheckInStatus>> {
  return (buckets ?? []).map(([timestamp, environments]) => {
    if (environment !== undefined) {
      return [
        timestamp,
        (environments[environment] ?? {}) as Partial<Record<CronCheckInStatus, number>>,
      ];
    }
    const totals: Record<string, number> = {};
    for (const counts of Object.values(environments ?? {})) {
      for (const [status, count] of Object.entries(counts ?? {})) {
        totals[status] = (totals[status] ?? 0) + count;
      }
    }
    return [timestamp, totals as Partial<Record<CronCheckInStatus, number>>];
  });
}
