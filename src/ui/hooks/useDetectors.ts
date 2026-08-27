import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import { listDetectors, type Detector, type DetectorSort } from "~/api/detectors";
import { mapAsyncStatus, type AsyncStatus } from "~/core/async";
import { useCursorPages } from "~/ui/hooks/useCursorPages";

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
  page: number;
  nextPage: () => boolean;
  previousPage: () => boolean;
}

/**
 * Fetch the detectors one Monitors screen lists.
 *
 * Cursor history makes PageUp/PageDown reversible. A changed search or sort
 * resets to page one; manual refresh retains the current page.
 */
export function useDetectors(
  client: SentryClient | null,
  { org, query, sortBy, project, reloadToken = 0 }: DetectorsQuery,
): DetectorsState {
  const loader = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => {
      if (!client) return null;
      return listDetectors(client, { org, query, sortBy, project, cursor, signal }).then(
        (page) => ({
          data: Array.isArray(page.data) ? page.data : [],
          nextCursor: page.nextCursor,
        }),
      );
    },
    [client, org, query, sortBy, project],
  );
  const pages = useCursorPages(loader, reloadToken);

  return {
    detectors: mapAsyncStatus(pages.status, (page) => page.data),
    nextCursor: pages.nextCursor,
    page: pages.page,
    nextPage: pages.nextPage,
    previousPage: pages.previousPage,
  };
}
