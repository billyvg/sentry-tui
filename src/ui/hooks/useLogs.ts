import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, type SentryClient } from "~/api/client";
import { listLogs, listLogTimeseries, type LogEntry, type LogTimeseriesBucket } from "~/api/logs";
import {
  type AsyncError,
  type AsyncStatus,
  idle,
  rejected,
  resolved,
  startLoading,
} from "~/core/async";

function toAsyncError(error: unknown): AsyncError {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export interface LogsQuery {
  org: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
}

export interface LogsState {
  logs: AsyncStatus<LogEntry[]>;
  nextCursor: string | null;
  reload: () => void;
}

/**
 * Fetch structured log entries and expose them as async state.
 *
 * Mirrors `useIssues` in shape: a superseded request is aborted so fast
 * query changes don't race.
 */
export function useLogs(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment }: LogsQuery,
): LogsState {
  const [logs, setLogs] = useState<AsyncStatus<LogEntry[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const logsRef = useRef(logs);
  logsRef.current = logs;

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

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
  }, [client, org, query, statsPeriod, project, environment, reloadToken]);

  return { logs, nextCursor, reload };
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
}

/**
 * Fetch log volume timeseries for the bar chart.
 *
 * Returns the raw bucket array from the events-stats API. The component
 * is responsible for downsampling to fit the available width.
 */
export function useLogTimeseries(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment }: LogTimeseriesQuery,
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
  }, [client, org, query, statsPeriod, project, environment]);

  return status;
}
