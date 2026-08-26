import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import {
  listProfileFunctions,
  type ProfileFunction,
  type ProfileFunctionSort,
} from "~/api/profileFunctions";
import { mapAsyncStatus, type AsyncStatus } from "~/core/async";
import { useCursorPages } from "~/ui/hooks/useCursorPages";

export interface ProfileFunctionsQuery {
  org: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  sort?: ProfileFunctionSort;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface ProfileFunctionsState {
  functions: AsyncStatus<ProfileFunction[]>;
  nextCursor: string | null;
  page: number;
  nextPage: () => boolean;
  previousPage: () => boolean;
}

/**
 * Fetch the slowest profiled functions and expose them as async state.
 *
 * One `AbortController` per request, so a superseded
 * query is cancelled rather than raced.
 */
export function useProfileFunctions(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, sort, reloadToken = 0 }: ProfileFunctionsQuery,
): ProfileFunctionsState {
  const loader = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      client
        ? listProfileFunctions(client, {
            org,
            query,
            statsPeriod,
            project,
            environment,
            sort,
            cursor,
            signal,
          })
        : null,
    [client, org, query, statsPeriod, project, environment, sort],
  );
  const pages = useCursorPages(loader, reloadToken);

  return {
    functions: mapAsyncStatus(pages.status, (result) => result.data),
    nextCursor: pages.nextCursor,
    page: pages.page,
    nextPage: pages.nextPage,
    previousPage: pages.previousPage,
  };
}
