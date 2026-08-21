import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listDetectors, type Detector } from "~/api/detectors";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export interface DetectorsQuery {
  org: string;
  /** The whole query, base filter included — built by `buildDetectorQuery`. */
  query?: string;
  /** Sort key, e.g. `-latestGroup`. */
  sortBy?: string;
  /** Project slugs or ids; empty means every project. */
  project?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

/**
 * Fetch the detectors one Monitors screen lists.
 *
 * Shaped like `useDashboards`: one request per query, the superseded one
 * aborted so typing in the search bar cannot land an older page on top of a
 * newer one. Manual refresh only — nothing here polls.
 */
export function useDetectors(
  client: SentryClient | null,
  { org, query, sortBy, project, reloadToken = 0 }: DetectorsQuery,
): AsyncStatus<Detector[]> {
  const [status, setStatus] = useState<AsyncStatus<Detector[]>>(idle);

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
        const page = await listDetectors(client, { org, query, sortBy, project, signal });
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
  }, [client, org, query, sortBy, project, reloadToken]);

  return status;
}
