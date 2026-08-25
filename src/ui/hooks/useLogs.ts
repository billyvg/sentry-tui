import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  listLogs,
  listLogTimeseries,
  type LogEntry,
  type LogSort,
  type LogTimeseriesBucket,
} from "~/api/logs";
import {
  type AsyncStatus,
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
} from "~/core/async";

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
  const [logs, setLogs] = useState<AsyncStatus<LogEntry[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const logsRef = useRef(logs);
  logsRef.current = logs;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setLogs(startLoading(logsRef.current, Date.now()));

    void (async () => {
      try {
        const result = await listLogs(client, {
          org,
          query,
          statsPeriod,
          project,
          environment,
          sort,
          signal,
        });
        if (cancelled) return;
        setLogs(resolved(result.data, Date.now()));
        setNextCursor(result.nextCursor);
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setLogs(rejected(logsRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, statsPeriod, project, environment, sort, reloadToken]);

  return { logs, nextCursor };
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
  const [status, setStatus] = useState<AsyncStatus<LogTimeseriesBucket[]>>(idle);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const buckets = await listLogTimeseries(client, {
          org,
          query,
          statsPeriod,
          project,
          environment,
          signal,
        });
        if (cancelled) return;
        setStatus(resolved(buckets, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, statsPeriod, project, environment, reloadToken]);

  return status;
}
