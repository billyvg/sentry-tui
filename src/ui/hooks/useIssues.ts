import { useCallback, useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { fetchIssueStats, listIssues, type IssueStats, type SortOption } from "~/api/issues";
import type { Group } from "~/api/types";
import {
  type AsyncStatus,
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
} from "~/core/async";

export interface IssuesQuery {
  org: string;
  query: string;
  sort: SortOption;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface IssuesState {
  issues: AsyncStatus<Group[]>;
  /** Tracked separately so rows can render before sparklines arrive. */
  statsLoading: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
  /** One-based page number, for the footer between the cursor controls. */
  page: number;
  /** Request the page named by the most recent `rel="next"` cursor. */
  nextPage: () => boolean;
  /** Request the page named by the most recent `rel="previous"` cursor. */
  previousPage: () => boolean;
}

/**
 * Runs the two-phase issue fetch and exposes it as async state.
 *
 * Phase one (list) settles first so rows are readable and navigable; phase two
 * (stats) merges sparkline data in when it lands. A superseded request is
 * aborted rather than left to resolve out of order.
 */
export function useIssues(
  client: SentryClient | null,
  { org, query, sort, statsPeriod, project, environment, reloadToken = 0 }: IssuesQuery,
): IssuesState {
  const [issues, setIssues] = useState<AsyncStatus<Group[]>>(idle);
  const [statsLoading, setStatsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Read the live value in async callbacks without re-subscribing the effect.
  const issuesRef = useRef(issues);
  issuesRef.current = issues;

  // The cursor which produced the page on screen. Refresh reuses it, while a
  // query/filter change deliberately resets it to the first page.
  const pageCursorRef = useRef<string | undefined>(undefined);
  const pageRef = useRef(1);
  const requestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  /**
   * Fetch one issue page, then fill that page's rows with phase-two stats.
   *
   * One request owns both phases. Moving again while stats are in flight
   * aborts that work so data from the abandoned page cannot land on the next.
   */
  const requestPage = useCallback(
    (cursor: string | undefined, targetPage: number): boolean => {
      if (!client) return false;

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const { signal } = controller;
      const requestId = ++requestIdRef.current;

      setIssues(startLoading(issuesRef.current, Date.now()));
      setStatsLoading(false);

      void (async () => {
        try {
          const result = await listIssues(client, {
            org,
            query,
            sort,
            statsPeriod,
            project,
            environment,
            cursor,
            signal,
          });
          if (signal.aborted || requestId !== requestIdRef.current) return;

          pageCursorRef.current = cursor;
          pageRef.current = targetPage;
          setPage(targetPage);
          setNextCursor(result.nextCursor);
          setPrevCursor(result.prevCursor);
          setIssues(resolved(result.data, Date.now()));

          // Phase two: sparklines for the ids we just rendered.
          if (result.data.length === 0) return;
          setStatsLoading(true);
          try {
            const stats = await fetchIssueStats(client, {
              org,
              groups: result.data.map((group) => group.id),
              statsPeriod,
              project,
              signal,
            });
            if (signal.aborted || requestId !== requestIdRef.current) return;
            setIssues((current) =>
              current.state === "ready"
                ? resolved(mergeStats(current.value, stats), current.fetchedAt)
                : current,
            );
          } finally {
            if (!signal.aborted && requestId === requestIdRef.current) setStatsLoading(false);
          }
        } catch (error) {
          if (signal.aborted || requestId !== requestIdRef.current) return;
          setIssues((current) => rejected(current, toAsyncError(error)));
        }
      })();

      return true;
    },
    [client, org, query, sort, statsPeriod, project, environment],
  );

  const previousRequestPage = useRef<typeof requestPage | null>(null);

  const nextPage = useCallback(
    () =>
      nextCursor === null || issuesRef.current.state === "loading"
        ? false
        : requestPage(nextCursor, pageRef.current + 1),
    [nextCursor, requestPage],
  );

  const previousPage = useCallback(
    () =>
      pageRef.current <= 1 || prevCursor === null || issuesRef.current.state === "loading"
        ? false
        : requestPage(prevCursor, Math.max(1, pageRef.current - 1)),
    [prevCursor, requestPage],
  );

  useEffect(() => {
    if (!client) {
      requestIdRef.current++;
      requestRef.current?.abort();
      return;
    }

    // `requestPage` changes for query/filter changes, so those start over.
    // `reloadToken` alone reuses the current page cursor and page number.
    const queryChanged = previousRequestPage.current !== requestPage;
    previousRequestPage.current = requestPage;
    if (queryChanged) {
      pageCursorRef.current = undefined;
      pageRef.current = 1;
      setPage(1);
      setNextCursor(null);
      setPrevCursor(null);
    }
    requestPage(pageCursorRef.current, pageRef.current);
  }, [client, requestPage, reloadToken]);

  useEffect(
    () => () => {
      requestIdRef.current++;
      requestRef.current?.abort();
    },
    [],
  );

  return { issues, statsLoading, nextCursor, prevCursor, page, nextPage, previousPage };
}

/**
 * Fold phase-two data onto the list rows.
 *
 * `collapse=stats` strips the counts and seen timestamps as well as the graph
 * series, so all of them arrive here — not just `stats`.
 */
function mergeStats(groups: Group[], stats: IssueStats): Group[] {
  return groups.map((group) => {
    const entry = stats[group.id];
    if (!entry) return group;
    return {
      ...group,
      count: entry.count ?? group.count,
      userCount: entry.userCount ?? group.userCount,
      firstSeen: entry.firstSeen ?? group.firstSeen,
      lastSeen: entry.lastSeen ?? group.lastSeen,
      isUnhandled: entry.isUnhandled ?? group.isUnhandled,
      stats: { ...group.stats, ...entry.stats },
    };
  });
}
