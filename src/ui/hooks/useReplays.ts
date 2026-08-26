import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import {
  listReplayErrors,
  listReplays,
  type Replay,
  type ReplayError,
  type ReplaySort,
} from "~/api/replays";
import { mapAsyncStatus, valueOf, type AsyncStatus } from "~/core/async";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";

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
 * The shared fetch lifecycle aborts a superseded
 * query and prevents it landing after the one that replaced it. Manual
 * refresh only — the replay index is never polled.
 */
export function useReplays(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, sort, reloadToken = 0 }: ReplaysQuery,
): ReplaysState {
  const loader = useCallback(
    (signal: AbortSignal) =>
      client
        ? listReplays(client, {
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
    replays: mapAsyncStatus(status, (page) => page.data),
    nextCursor: valueOf(status)?.nextCursor ?? null,
  };
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

export interface ReplayErrorsState {
  errors: AsyncStatus<ReplayError[]>;
  nextCursor: string | null;
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
): ReplayErrorsState {
  const loader = useCallback(
    (signal: AbortSignal) => {
      if (!client) return null;
      if (count <= 0) {
        return Promise.resolve({ data: [] as ReplayError[], nextCursor: null });
      }
      return listReplayErrors(client, {
        org,
        replayId,
        statsPeriod,
        environment,
        signal,
      });
    },
    [client, org, replayId, statsPeriod, environment, count],
  );
  const { status } = useAsyncFetch(loader, { reloadKey: reloadToken });

  return {
    errors: mapAsyncStatus(status, (page) => page.data),
    nextCursor: valueOf(status)?.nextCursor ?? null,
  };
}
