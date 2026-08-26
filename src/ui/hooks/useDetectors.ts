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
  /**
   * What the rows on screen belong to — the screen id, for the seven Monitors
   * screens that share this hook and their state slice.
   *
   * A load normally carries the current rows forward so a refresh doesn't
   * flash a skeleton, and refining a search should behave that way too. But
   * the *screen* changing is not a refinement: Cron's detectors are not a
   * stale view of Metric's, they are the wrong list. React reuses the
   * component instance across sibling screens (same component, same position
   * in the tree), so without this the previous screen's rows stay on screen —
   * and Enter opens one of them. Change this and the rows are dropped instead.
   */
  resetKey?: string;
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
  { org, query, sortBy, project, reloadToken = 0, resetKey }: DetectorsQuery,
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
  const { status } = useAsyncFetch(loader, { reloadKey: reloadToken, resetKey });

  return {
    detectors: mapAsyncStatus(status, (page) => page.data),
    nextCursor: valueOf(status)?.nextCursor ?? null,
  };
}
