import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  listSavedQueriesPage,
  type SavedQuery,
  type SavedQueryListSort,
  type SavedQuerySource,
} from "~/api/savedQueries";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export interface SavedQueriesQuery {
  org: string;
  /** Which endpoint to read — see `savedQueryScreens.ts`. */
  source: SavedQuerySource;
  /** Only starred queries. What the nav's Starred Queries section asks for. */
  starred?: boolean;
  /** Free-text filter on the query name. */
  search?: string;
  sort?: SavedQueryListSort;
  limit?: number;
  /**
   * Skip the fetch entirely and stay idle. The nav uses it so the sidebar for
   * Issues doesn't pay for Explore's starred queries.
   */
  enabled?: boolean;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface SavedQueriesState {
  queries: AsyncStatus<SavedQuery[]>;
  nextCursor: string | null;
}

/**
 * Fetch saved queries and expose them as async state.
 *
 * Shaped like `useLogs`: one `AbortController` per request, so a fast change of
 * search text or organization can't land out of order. Manual refresh only.
 */
export function useSavedQueries(
  client: SentryClient | null,
  { org, source, starred, search, sort, limit, enabled = true, reloadToken = 0 }: SavedQueriesQuery,
): SavedQueriesState {
  const [status, setStatus] = useState<AsyncStatus<SavedQuery[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client || !enabled) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const page = await listSavedQueriesPage(client, source, {
          org,
          starred,
          search,
          sort,
          limit,
          signal,
        });
        if (cancelled) return;
        setStatus(resolved(page.data, Date.now()));
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
  }, [client, org, source, starred, search, sort, limit, enabled, reloadToken]);

  return { queries: status, nextCursor };
}
