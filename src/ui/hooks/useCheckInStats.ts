import { useEffect, useMemo, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  fetchMonitorStats,
  fetchUptimeStats,
  selectEnvironment,
  timelineWindow,
  type MonitorStats,
  type StatsWindow,
  type UptimeStats,
} from "~/api/monitorStats";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";
import type { CronCheckInStatus, StatsBucket, UptimeCheckStatus } from "~/lib/checkInTimeline";

/** Check-in stats for every visible row, plus the window they cover. */
export interface CheckInStats {
  window: StatsWindow;
  /** Cron buckets by monitor guid. */
  monitors: MonitorStats;
  /** Uptime buckets by detector id. */
  uptime: UptimeStats;
}

export interface CheckInStatsQuery {
  org: string;
  /** Monitor guids of the cron rows on screen. */
  monitorIds: readonly string[];
  /** Detector ids of the uptime rows on screen. */
  uptimeDetectorIds: readonly string[];
  /** Cells the timeline column has — it decides the bucket resolution. */
  width: number;
  project?: readonly string[];
  environment?: readonly string[];
  /** Bump to refetch — the app's global refresh. */
  reloadToken?: number;
}

/**
 * Check-in stats for a whole page of monitor rows, in at most two requests.
 *
 * The web fetches per row (`views/detectors/list/cron.tsx:63` mounts a query
 * inside each `VisualizationCell`), which costs one request per visible
 * monitor. Both endpoints take a *list*, so a table that knows all its rows up
 * front can ask once — and a terminal list always does.
 *
 * Nothing here polls: `reloadToken` is the only way to refetch, as everywhere
 * else in the app. A failure leaves the previous stats on screen rather than
 * blanking every row.
 */
export function useCheckInStats(
  client: SentryClient | null,
  {
    org,
    monitorIds,
    uptimeDetectorIds,
    width,
    project,
    environment,
    reloadToken = 0,
  }: CheckInStatsQuery,
): AsyncStatus<CheckInStats> {
  const [status, setStatus] = useState<AsyncStatus<CheckInStats>>(idle);

  const statusRef = useRef(status);
  statusRef.current = status;

  // Identity of the request, not of the arrays: a re-render that rebuilds the
  // same id list must not refetch, and a resize of one cell must not either —
  // only a change in the resolution the width implies.
  const monitorKey = useMemo(() => [...new Set(monitorIds)].sort().join(","), [monitorIds]);
  const uptimeKey = useMemo(
    () => [...new Set(uptimeDetectorIds)].sort().join(","),
    [uptimeDetectorIds],
  );
  const projectKey = useMemo(() => (project ?? []).join(","), [project]);
  const environmentKey = useMemo(() => (environment ?? []).join(","), [environment]);
  const resolution = timelineWindow(width).resolution;

  useEffect(() => {
    if (!client) return;

    const monitors = monitorKey ? monitorKey.split(",") : [];
    const detectors = uptimeKey ? uptimeKey.split(",") : [];
    const window = timelineWindow(width);

    // Nothing to ask about — stay idle rather than resolving an empty page.
    //
    // A resolved page is a *value*, and `startLoading` carries the last value
    // forward so a refresh doesn't blank the screen. An empty placeholder
    // carried forward that way is indistinguishable from a monitor with no
    // check-ins, so the first real load would draw settled empty rows instead
    // of the pending rail. Caught by `test/monitorTimeline.test.tsx`.
    if (monitors.length === 0 && detectors.length === 0) {
      setStatus(idle);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const [monitorStats, uptimeStats] = await Promise.all([
          fetchMonitorStats(client, {
            org,
            monitors,
            project: projectKey ? projectKey.split(",") : undefined,
            environment: environmentKey ? environmentKey.split(",") : undefined,
            signal,
            ...window,
          }),
          fetchUptimeStats(client, { org, detectorIds: detectors, signal, ...window }),
        ]);
        if (cancelled) return;
        setStatus(resolved({ window, monitors: monitorStats, uptime: uptimeStats }, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `width` is read inside rather than depended on: only the resolution it
    // implies is worth a refetch, and the fold handles the rest of a resize.
  }, [client, org, monitorKey, uptimeKey, projectKey, environmentKey, resolution, reloadToken]);

  return status;
}

/**
 * One cron monitor's buckets out of a fetched page, flattened across
 * environments — what `<CheckInTimeline>` takes.
 *
 * The `undefined` / `[]` distinction is the one the component draws on:
 * `undefined` only while there is no fetched page at all, and an empty array
 * once there is one that simply has nothing for this monitor. A row absent
 * from a settled response has no check-ins, not pending ones —
 * `uptime-stats/` omits a subscription with no timeseries entirely
 * (`organization_uptime_stats.py:_format_response`), so this is a real
 * response, not a defensive branch.
 */
export function cronBuckets(
  stats: CheckInStats | undefined,
  monitorId: string | undefined,
  environment?: string,
): Array<StatsBucket<CronCheckInStatus>> | undefined {
  if (!stats || !monitorId) return undefined;
  return selectEnvironment(stats.monitors[monitorId], environment);
}

/** One uptime detector's buckets out of a fetched page. See `cronBuckets`. */
export function uptimeBuckets(
  stats: CheckInStats | undefined,
  detectorId: string | undefined,
): ReadonlyArray<StatsBucket<UptimeCheckStatus>> | undefined {
  if (!stats || !detectorId) return undefined;
  return stats.uptime[detectorId] ?? [];
}
