import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { queryDiscover, type DiscoverDataset, type DiscoverRow } from "~/api/discover";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export interface DiscoverRowsQuery {
  org: string;
  dataset: DiscoverDataset;
  /**
   * Columns to select. Must be referentially stable — it is an effect
   * dependency, so a fresh array each render would refetch forever. A saved
   * query's own `fields` array is stable; a derived one needs a `useMemo`.
   */
  fields: readonly string[];
  sort?: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  /** Attribution string Sentry logs per caller. */
  referrer?: string;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface DiscoverRowsState {
  rows: AsyncStatus<DiscoverRow[]>;
  nextCursor: string | null;
}

/**
 * Run a Discover query and expose the raw rows as async state.
 *
 * A screen with a fixed shape reshapes
 * its rows into a domain type, but a saved query's columns are only known at
 * runtime, so its rows stay in the endpoint's own flat form.
 */
export function useDiscoverRows(
  client: SentryClient | null,
  {
    org,
    dataset,
    fields,
    sort,
    query,
    statsPeriod,
    project,
    environment,
    referrer,
    reloadToken = 0,
  }: DiscoverRowsQuery,
): DiscoverRowsState {
  const [status, setStatus] = useState<AsyncStatus<DiscoverRow[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client || fields.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const page = await queryDiscover(client, {
          org,
          dataset,
          fields,
          sort,
          query,
          statsPeriod,
          project,
          environment,
          referrer,
          signal,
        });
        if (cancelled) return;
        setStatus(resolved(page.rows, Date.now()));
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    client,
    org,
    dataset,
    fields,
    sort,
    query,
    statsPeriod,
    project,
    environment,
    referrer,
    reloadToken,
  ]);

  return { rows: status, nextCursor };
}
