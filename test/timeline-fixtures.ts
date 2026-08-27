/**
 * Deterministic check-in stats for the cron and uptime timelines.
 *
 * Both endpoints answer relative to the window they were asked for, so these
 * are factories rather than constants: a test picks its own `since` and gets
 * buckets that land where it expects them to. Kept beside the other
 * per-feature fixture files rather than in `fixtures.ts`.
 */

import type { CronEnvironmentBucket, MonitorStats, UptimeStats } from "~/api/monitorStats";
import type { CronCheckInStatus, StatsBucket, UptimeCheckStatus } from "~/lib/checkInTimeline";
import { NIGHTLY_ROLLUP_ID, SESSION_CLEANUP_ID } from "./monitor-fixtures";

export { NIGHTLY_ROLLUP_ID, SESSION_CLEANUP_ID } from "./monitor-fixtures";

export const HOUR_SECONDS = 3600;
export const DAY_SECONDS = 24 * HOUR_SECONDS;

/** Detector id of the uptime fixture. */
export const CHECKOUT_UPTIME_ID = "774";

/**
 * A day of hourly cron buckets under one environment.
 *
 * `failures` maps an hour offset to the counts for that hour; every other hour
 * is a clean check-in. This is the shape `monitors-stats/` returns: the counts
 * sit one level down, under the environment name.
 */
export function cronDay(
  since: number,
  {
    environment = "production",
    failures = {},
    hours = 24,
  }: {
    environment?: string;
    failures?: Readonly<Record<number, Partial<Record<CronCheckInStatus, number>>>>;
    hours?: number;
  } = {},
): CronEnvironmentBucket[] {
  return Array.from({ length: hours }, (_, hour) => [
    since + hour * HOUR_SECONDS,
    { [environment]: { ok: 1, ...failures[hour] } },
  ]);
}

/**
 * `GET /organizations/{org}/monitors-stats/` for both cron fixtures.
 *
 * `nightly-billing-rollup` is clean; `session-cleanup` fails at hour 6 and
 * times out at hour 14, which is what makes a row worth looking at.
 */
export function monitorStatsFixture(since: number): MonitorStats {
  return {
    [NIGHTLY_ROLLUP_ID]: cronDay(since),
    [SESSION_CLEANUP_ID]: cronDay(since, {
      failures: { 6: { ok: 0, error: 2 }, 14: { ok: 0, timeout: 1 } },
    }),
  };
}

/** A day of hourly uptime checks, four per hour, with the named hours failing. */
export function uptimeDay(
  since: number,
  {
    incidents = [],
    failures = [],
    hours = 24,
  }: { incidents?: readonly number[]; failures?: readonly number[]; hours?: number } = {},
): Array<StatsBucket<UptimeCheckStatus>> {
  return Array.from({ length: hours }, (_, hour) => {
    if (incidents.includes(hour)) return [since + hour * HOUR_SECONDS, { failure_incident: 4 }];
    if (failures.includes(hour)) return [since + hour * HOUR_SECONDS, { success: 3, failure: 1 }];
    return [since + hour * HOUR_SECONDS, { success: 4 }];
  });
}

/** `GET /organizations/{org}/uptime-stats/`. */
export function uptimeStatsFixture(since: number): UptimeStats {
  return { [CHECKOUT_UPTIME_ID]: uptimeDay(since, { failures: [9], incidents: [10, 11] }) };
}

/**
 * A response with every kind of junk the normalizers have to survive: a null
 * bucket list, a count that is a string, a status nobody has heard of, and a
 * bucket whose timestamp is missing.
 */
export const malformedMonitorStats: unknown = {
  [NIGHTLY_ROLLUP_ID]: null,
  [SESSION_CLEANUP_ID]: [
    [1_760_000_000, { production: { ok: "3", teleported: 2 } }],
    [null, { production: { ok: 1 } }],
    "not-a-bucket",
  ],
};
