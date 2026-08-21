import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listProfileFunctions, type ProfileFunction } from "~/api/profileFunctions";
import {
  type AsyncStatus,
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
} from "~/core/async";

export interface ProfileFunctionsQuery {
  org: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface ProfileFunctionsState {
  functions: AsyncStatus<ProfileFunction[]>;
  nextCursor: string | null;
}

/**
 * Fetch the slowest profiled functions and expose them as async state.
 *
 * Same shape as `useLogs`: one `AbortController` per request, so a superseded
 * query is cancelled rather than raced.
 */
export function useProfileFunctions(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, reloadToken = 0 }: ProfileFunctionsQuery,
): ProfileFunctionsState {
  const [functions, setFunctions] = useState<AsyncStatus<ProfileFunction[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const functionsRef = useRef(functions);
  functionsRef.current = functions;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setFunctions(startLoading(functionsRef.current, Date.now()));

    void (async () => {
      try {
        const result = await listProfileFunctions(client, {
          org,
          query,
          statsPeriod,
          project,
          environment,
          signal,
        });
        if (cancelled) return;
        setFunctions(resolved(result.data, Date.now()));
        setNextCursor(result.nextCursor);
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setFunctions(rejected(functionsRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, statsPeriod, project, environment, reloadToken]);

  return { functions, nextCursor };
}
