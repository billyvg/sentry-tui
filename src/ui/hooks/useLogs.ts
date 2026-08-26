import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import {
  listLogs,
  listLogTimeseries,
  type LogEntry,
  type LogSort,
  type LogTimeseriesBucket,
} from "~/api/logs";
import { mapAsyncStatus, valueOf, type AsyncStatus } from "~/core/async";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";

export interface LogsQuery {
  org: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  sort?: LogSort;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface LogsState {
  logs: AsyncStatus<LogEntry[]>;
  nextCursor: string | null;
}

/**
 * Fetch structured log entries and expose them as async state.
 *
 * Mirrors `useIssues` in shape: a superseded request is aborted so fast
 * query changes don't race.
 */
export function useLogs(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, sort, reloadToken = 0 }: LogsQuery,
): LogsState {
  const loader = useCallback(
    (signal: AbortSignal) =>
      client
        ? listLogs(client, {
            org,
            query,
            statsPeriod,
            project,
            environment,
            sort,
            signal,
          })
        : null,
    [client, org, query, statsPeriod, project, environment, sort],
  );
  const { status } = useAsyncFetch(loader, { reloadKey: reloadToken });

  return {
    logs: mapAsyncStatus(status, (page) => page.data),
    nextCursor: valueOf(status)?.nextCursor ?? null,
  };
}

// ---------------------------------------------------------------------------
// Time-series hook (bar chart)
// ---------------------------------------------------------------------------

export interface LogTimeseriesQuery {
  org: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

/**
 * Fetch log volume timeseries for the bar chart.
 *
 * Returns the raw bucket array from the events-stats API. The component
 * is responsible for downsampling to fit the available width.
 */
export function useLogTimeseries(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, reloadToken = 0 }: LogTimeseriesQuery,
): AsyncStatus<LogTimeseriesBucket[]> {
  const loader = useCallback(
    (signal: AbortSignal) =>
      client
        ? listLogTimeseries(client, {
            org,
            query,
            statsPeriod,
            project,
            environment,
            signal,
          })
        : null,
    [client, org, query, statsPeriod, project, environment],
  );

  return useAsyncFetch(loader, { reloadKey: reloadToken }).status;
}
