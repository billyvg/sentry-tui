import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  listReplayErrors,
  listReplays,
  type Replay,
  type ReplayError,
  type ReplaySort,
} from "~/api/replays";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export interface ReplaysQuery {
  org: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  sort?: ReplaySort;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface ReplaysState {
  replays: AsyncStatus<Replay[]>;
  nextCursor: string | null;
}

/**
 * Fetch the org's replays and expose them as async state.
 *
 * Same shape as `useLogs`: one `AbortController` per request, so a superseded
 * query can't land after the one that replaced it. Manual refresh only — the
 * replay index is never polled.
 */
export function useReplays(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, sort, reloadToken = 0 }: ReplaysQuery,
): ReplaysState {
  const [replays, setReplays] = useState<AsyncStatus<Replay[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const replaysRef = useRef(replays);
  replaysRef.current = replays;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setReplays(startLoading(replaysRef.current, Date.now()));

    void (async () => {
      try {
        const result = await listReplays(client, {
          org,
          query,
          statsPeriod,
          project,
          environment,
          sort,
          signal,
        });
        if (cancelled) return;
        setReplays(resolved(result.data, Date.now()));
        setNextCursor(result.nextCursor);
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setReplays(rejected(replaysRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, statsPeriod, project, environment, sort, reloadToken]);

  return { replays, nextCursor };
}

// ---------------------------------------------------------------------------
// The errors behind one replay
// ---------------------------------------------------------------------------

export interface ReplayErrorsQuery {
  org: string;
  replayId: string;
  statsPeriod: string;
  environment?: string[];
  /**
   * The replay's own error count. Zero means there is nothing to ask for, and
   * the query is skipped rather than sent — the detail pane says so itself.
   */
  count: number;
  reloadToken?: number;
}

/**
 * Fetch the error events recorded during one replay.
 *
 * Resolves to an empty list without a request when the replay reports no
 * errors, so opening a clean session costs nothing.
 */
export function useReplayErrors(
  client: SentryClient | null,
  { org, replayId, statsPeriod, environment, count, reloadToken = 0 }: ReplayErrorsQuery,
): AsyncStatus<ReplayError[]> {
  const [status, setStatus] = useState<AsyncStatus<ReplayError[]>>(idle);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client) return;
    if (count <= 0) {
      setStatus(resolved([], Date.now()));
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const errors = await listReplayErrors(client, {
          org,
          replayId,
          statsPeriod,
          environment,
          signal,
        });
        if (cancelled) return;
        setStatus(resolved(errors, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, replayId, statsPeriod, environment, count, reloadToken]);

  return status;
}
