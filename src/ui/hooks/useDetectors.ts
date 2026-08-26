import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import { listDetectors, type Detector, type DetectorSort } from "~/api/detectors";
import { mapAsyncStatus, valueOf, type AsyncStatus } from "~/core/async";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";

export interface DetectorsQuery {
  org: string;
  /** The whole query, base filter included — built by `buildDetectorQuery`. */
  query?: string;
  /** Sort key, e.g. `-latestGroup`. */
  sortBy?: DetectorSort;
  /** Project slugs or ids; empty means every project. */
  project?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface DetectorsState {
  detectors: AsyncStatus<Detector[]>;
  nextCursor: string | null;
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
): DetectorsState {
  const loader = useCallback(
    (signal: AbortSignal) => {
      if (!client) return null;
      return listDetectors(client, { org, query, sortBy, project, signal }).then((page) => ({
        data: Array.isArray(page.data) ? page.data : [],
        nextCursor: page.nextCursor,
      }));
    },
    [client, org, query, sortBy, project],
  );
  const { status } = useAsyncFetch(loader, { reloadKey: reloadToken });

  return {
    detectors: mapAsyncStatus(status, (page) => page.data),
    nextCursor: valueOf(status)?.nextCursor ?? null,
  };
}
