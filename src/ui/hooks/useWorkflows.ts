import { useEffect, useMemo, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listDetectorsByIds, type Detector } from "~/api/detectors";
import { listWorkflows, type Workflow } from "~/api/workflows";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export interface WorkflowsQuery {
  org: string;
  /** Committed search query; the endpoint matches it against the name. */
  query?: string;
  sortBy?: string;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

/**
 * Fetch the org's workflows for `Monitors › Alerts`.
 *
 * Shaped like `useDashboards`: one request per query, the superseded one
 * aborted so typing in the search bar can't land an older page on top of a
 * newer one. Manual refresh only — nothing here polls.
 */
export function useWorkflows(
  client: SentryClient | null,
  { org, query = "", sortBy, reloadToken = 0 }: WorkflowsQuery,
): AsyncStatus<Workflow[]> {
  const [status, setStatus] = useState<AsyncStatus<Workflow[]>>(idle);

  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const page = await listWorkflows(client, { org, query, sortBy, signal });
        if (cancelled) return;
        setStatus(resolved(Array.isArray(page.data) ? page.data : [], Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, sortBy, reloadToken]);

  return status;
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
