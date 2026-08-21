/**
 * Rows and volume for one Explore table, as async state.
 *
 * Shaped like `useLogs`: an `AbortController` per request so a fast filter
 * change can't land out of order, and `reloadToken` in the dependencies
 * because `R` is the only refresh — nothing here polls.
 */

import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import type { TimeseriesBucket } from "~/api/discover";
import { listExploreEvents, listExploreTimeseries, type ExploreEvent } from "~/api/exploreEvents";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";
import { exploreQuery, type ExploreTable } from "~/core/exploreTables";

export interface ExploreEventsQuery {
  org: string;
  /** The user's committed query. The table's base filter is added here. */
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface ExploreEventsState {
  events: AsyncStatus<ExploreEvent[]>;
  timeseries: AsyncStatus<TimeseriesBucket[]>;
}

/**
 * Fetch a table's rows and its chart.
 *
 * Two requests rather than one because they are two endpoints, but one hook:
 * they take identical filters, and a chart that disagrees with the rows under
 * it is worse than no chart.
 */
export function useExploreEvents(
  client: SentryClient | null,
  table: ExploreTable,
  { org, query, statsPeriod, project, environment, reloadToken = 0 }: ExploreEventsQuery,
): ExploreEventsState {
  const [events, setEvents] = useState<AsyncStatus<ExploreEvent[]>>(idle);
  const [timeseries, setTimeseries] = useState<AsyncStatus<TimeseriesBucket[]>>(idle);

  const eventsRef = useRef(events);
  eventsRef.current = events;
  const timeseriesRef = useRef(timeseries);
  timeseriesRef.current = timeseries;

  const combined = exploreQuery(table, query);

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setEvents(startLoading(eventsRef.current, Date.now()));
    setTimeseries(startLoading(timeseriesRef.current, Date.now()));

    const filters = {
      org,
      query: combined,
      statsPeriod,
      project,
      environment,
      signal,
    };

    void (async () => {
      try {
        const page = await listExploreEvents(client, {
          ...filters,
          dataset: table.dataset,
          fields: table.fields,
          sort: table.sort,
          idField: table.idField,
          referrer: table.referrer,
        });
        if (cancelled) return;
        setEvents(resolved(page.data, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setEvents(rejected(eventsRef.current, toAsyncError(error)));
      }
    })();

    void (async () => {
      try {
        const buckets = await listExploreTimeseries(client, {
          ...filters,
          dataset: table.dataset,
          yAxis: table.yAxis,
          referrer: `${table.referrer}-chart`,
        });
        if (cancelled) return;
        setTimeseries(resolved(buckets, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        // A missing chart is a smaller loss than a missing table, so a failed
        // timeseries is recorded and left to render as no chart at all.
        setTimeseries(rejected(timeseriesRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, combined, statsPeriod, project, environment, reloadToken, table]);

  return { events, timeseries };
}
