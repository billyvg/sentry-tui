/**
 * Rows and volume for one Explore table, as async state.
 *
 * The shared fetch lifecycle prevents a fast filter change from landing out
 * of order, and `R` is the only refresh — nothing here polls.
 */

import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import type { TimeseriesBucket } from "~/api/discover";
import { listExploreEvents, listExploreTimeseries, type ExploreEvent } from "~/api/exploreEvents";
import { mapAsyncStatus, type AsyncStatus } from "~/core/async";
import type { ResolvedExploreQuery } from "~/core/exploreQuery";
import { exploreQuery, type ExploreTable } from "~/core/exploreTables";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";
import { useCursorPages } from "~/ui/hooks/useCursorPages";

export interface ExploreEventsQuery {
  org: string;
  /** The user's committed query. The table's base filter is added here. */
  query: string;
  /**
   * Columns, sort and chart aggregate, as the query builder resolved them —
   * the table's own defaults until the user changes one. Memoize it: it is an
   * effect dependency, so a fresh object every render is a fetch every render.
   */
  request: ResolvedExploreQuery;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface ExploreEventsState {
  events: AsyncStatus<ExploreEvent[]>;
  timeseries: AsyncStatus<TimeseriesBucket[]>;
  nextCursor: string | null;
  page: number;
  nextPage: () => boolean;
  previousPage: () => boolean;
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
  { org, query, request, statsPeriod, project, environment, reloadToken = 0 }: ExploreEventsQuery,
): ExploreEventsState {
  const combined = exploreQuery(table, query);
  const eventsLoader = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      client
        ? listExploreEvents(client, {
            org,
            query: combined,
            statsPeriod,
            project,
            environment,
            cursor,
            signal,
            dataset: table.dataset,
            fields: request.fields,
            sort: request.sort,
            idField: request.idField,
            referrer: table.referrer,
          })
        : null,
    [client, org, combined, request, statsPeriod, project, environment, table],
  );
  const timeseriesLoader = useCallback(
    (signal: AbortSignal) =>
      client
        ? listExploreTimeseries(client, {
            org,
            query: combined,
            statsPeriod,
            project,
            environment,
            signal,
            dataset: table.dataset,
            yAxis: request.yAxis,
            referrer: `${table.referrer}-chart`,
          })
        : null,
    [client, org, combined, request, statsPeriod, project, environment, table],
  );
  const eventsPages = useCursorPages(eventsLoader, reloadToken);
  const timeseries = useAsyncFetch(timeseriesLoader, { reloadKey: reloadToken }).status;

  return {
    events: mapAsyncStatus(eventsPages.status, (page) => page.data),
    timeseries,
    nextCursor: eventsPages.nextCursor,
    page: eventsPages.page,
    nextPage: eventsPages.nextPage,
    previousPage: eventsPages.previousPage,
  };
}
