import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listDetectorOpenPeriods, type DetectorOpenPeriod } from "~/api/detectors";
import { listWorkflows, type Workflow } from "~/api/workflows";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export interface DetectorDetailQuery {
  org: string;
  /** The detector the view was opened on. */
  detectorId: string;
  /** Bump to refetch — the app's global refresh. */
  reloadToken?: number;
}

export interface DetectorOpenPeriodsQuery extends DetectorDetailQuery {
  /** Relative window selected on the monitor list, such as `14d`. */
  statsPeriod: string;
}

export interface DetectorOpenPeriodsPage {
  /** Newest open periods in the requested window. */
  rows: DetectorOpenPeriod[];
  /** More rows exist beyond this page. */
  nextCursor: string | null;
  /** Total rows in the window when Sentry returns `X-Hits`. */
  totalCount?: number;
}

/**
 * The open periods of a detector's most recent issue.
 *
 * Shaped like every other fetch hook in the app: one request per detector, the
 * superseded one aborted, no polling. The response keeps its cursor and total
 * so the detail cannot mistake a capped page for a complete result.
 */
export function useDetectorOpenPeriods(
  client: SentryClient | null,
  { org, detectorId, statsPeriod, reloadToken = 0 }: DetectorOpenPeriodsQuery,
): AsyncStatus<DetectorOpenPeriodsPage> {
  const [status, setStatus] = useState<AsyncStatus<DetectorOpenPeriodsPage>>(idle);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client || !detectorId) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const page = await listDetectorOpenPeriods(client, {
          org,
          detectorId,
          statsPeriod,
          signal,
        });
        if (cancelled) return;
        setStatus(
          resolved(
            {
              rows: Array.isArray(page.data) ? page.data : [],
              nextCursor: page.nextCursor,
              ...(page.totalCount === undefined ? {} : { totalCount: page.totalCount }),
            },
            Date.now(),
          ),
        );
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, detectorId, statsPeriod, reloadToken]);

  return status;
}

/**
 * The alerts wired to one detector.
 *
 * The same `workflows/` client `Monitors › Alerts` lists from, with the
 * `detector` filter the web's detail drawer sends — one client, two callers.
 */
export function useDetectorWorkflows(
  client: SentryClient | null,
  { org, detectorId, reloadToken = 0 }: DetectorDetailQuery,
): AsyncStatus<Workflow[]> {
  const [status, setStatus] = useState<AsyncStatus<Workflow[]>>(idle);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client || !detectorId) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const page = await listWorkflows(client, { org, detector: [detectorId], signal });
        if (cancelled) return;
        setStatus(resolved(Array.isArray(page.data) ? page.data : [], Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, detectorId, reloadToken]);

  return status;
}
