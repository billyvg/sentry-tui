import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, type SentryClient } from "~/api/client";
import {
  fetchIssueStats,
  listIssues,
  type SortOption,
} from "~/api/issues";
import type { Group } from "~/api/types";
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

export interface IssuesQuery {
  org: string;
  query: string;
  sort: SortOption;
  statsPeriod: string;
}

export interface IssuesState {
  issues: AsyncStatus<Group[]>;
  /** Tracked separately so rows can render before sparklines arrive. */
  statsLoading: boolean;
  nextCursor: string | null;
  reload: () => void;
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
  { org, query, sort, statsPeriod }: IssuesQuery,
): IssuesState {
  const [issues, setIssues] = useState<AsyncStatus<Group[]>>(idle);
  const [statsLoading, setStatsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Read the live value in async callbacks without re-subscribing the effect.
  const issuesRef = useRef(issues);
  issuesRef.current = issues;

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setIssues(startLoading(issuesRef.current, Date.now()));

    void (async () => {
      try {
        const page = await listIssues(client, {
          org,
          query,
          sort,
          statsPeriod,
          signal,
        });
        if (cancelled) return;

        setIssues(resolved(page.data, Date.now()));
        setNextCursor(page.nextCursor);

        // Phase two: sparklines for the ids we just rendered.
        if (page.data.length === 0) return;
        setStatsLoading(true);
        try {
          const stats = await fetchIssueStats(client, {
            org,
            groups: page.data.map((g) => g.id),
            statsPeriod,
            signal,
          });
          if (cancelled) return;
          setIssues((current) =>
            current.state === "ready"
              ? resolved(mergeStats(current.value, stats), current.fetchedAt)
              : current,
          );
        } finally {
          if (!cancelled) setStatsLoading(false);
        }
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setIssues(rejected(issuesRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, sort, statsPeriod, reloadToken]);

  return { issues, statsLoading, nextCursor, reload };
}

function mergeStats(
  groups: Group[],
  stats: Record<string, unknown>,
): Group[] {
  return groups.map((group) => {
    const entry = stats[group.id] as Group["stats"] | undefined;
    return entry ? { ...group, stats: { ...group.stats, ...entry } } : group;
  });
}
