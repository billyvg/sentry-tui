import { useCallback, useEffect, useMemo, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listDetectorsByIds, type Detector } from "~/api/detectors";
import { listWorkflows, type Workflow, type WorkflowSort } from "~/api/workflows";
import { mapAsyncStatus, type AsyncStatus } from "~/core/async";
import { useCursorPages } from "~/ui/hooks/useCursorPages";

export interface WorkflowsQuery {
  org: string;
  /** Committed search query; the endpoint matches it against the name. */
  query?: string;
  /** Project ids or slugs selected in the Alerts filter. */
  project?: string[];
  sortBy?: WorkflowSort;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface WorkflowsState {
  workflows: AsyncStatus<Workflow[]>;
  nextCursor: string | null;
  page: number;
  nextPage: () => boolean;
  previousPage: () => boolean;
}

/**
 * Fetch the org's workflows for `Monitors › Alerts`.
 *
 * Cursor history makes PageUp/PageDown reversible. A changed search, project
 * filter, or sort resets to page one; manual refresh retains the current page.
 */
export function useWorkflows(
  client: SentryClient | null,
  { org, query = "", project, sortBy, reloadToken = 0 }: WorkflowsQuery,
): WorkflowsState {
  const loader = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      client
        ? listWorkflows(client, { org, query, project, sortBy, cursor, signal }).then((page) => ({
            data: Array.isArray(page.data) ? page.data : [],
            nextCursor: page.nextCursor,
          }))
        : null,
    [client, org, query, project, sortBy],
  );
  const pages = useCursorPages(loader, reloadToken);

  return {
    workflows: mapAsyncStatus(pages.status, (page) => page.data),
    nextCursor: pages.nextCursor,
    page: pages.page,
    nextPage: pages.nextPage,
    previousPage: pages.previousPage,
  };
}

/** What the Projects column knows so far. */
export interface WorkflowDetectorLookup {
  /** Detector id → detector, for the ids the current workflows reference. */
  byId: ReadonlyMap<string, Detector>;
  /** A lookup is in flight, so an unresolved id is pending rather than absent. */
  loading: boolean;
}

const NO_DETECTORS: WorkflowDetectorLookup = { byId: new Map(), loading: false };

/**
 * Resolve the detectors the listed workflows are connected to.
 *
 * A workflow carries detector *ids*, and the Projects column needs the project
 * behind each of them — so this is the second half of one screen's data, kept
 * beside the first. Keyed on the joined id list rather than the workflows
 * array, so a refetch that returns the same connections doesn't ask again.
 *
 * Failures resolve to an empty lookup: the list is what the screen is for, and
 * a column of metadata should not be able to take it down.
 */
export function useWorkflowDetectors(
  client: SentryClient | null,
  org: string,
  workflows: readonly Workflow[] | undefined,
): WorkflowDetectorLookup {
  const ids = useMemo(() => {
    const unique = new Set<string>();
    for (const workflow of workflows ?? []) {
      for (const id of workflow.detectorIds ?? []) unique.add(id);
    }
    return [...unique].sort();
  }, [workflows]);

  const key = ids.join(",");
  const [lookup, setLookup] = useState<WorkflowDetectorLookup>(NO_DETECTORS);

  useEffect(() => {
    if (!client || key === "") {
      setLookup(NO_DETECTORS);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLookup((current) => ({ byId: current.byId, loading: true }));

    void listDetectorsByIds(client, { org, ids: key.split(","), signal: controller.signal })
      .then((detectors) => {
        if (cancelled) return;
        setLookup({ byId: new Map(detectors.map((d) => [d.id, d])), loading: false });
      })
      .catch(() => {
        if (!cancelled) setLookup(NO_DETECTORS);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, key]);

  return lookup;
}
