/**
 * Rows and volume for one Explore table, as async state.
 *
 * Shaped like `useLogs`: the shared fetch lifecycle prevents a fast filter
 * change from landing out of order, and `R` is the only refresh — nothing
 * here polls.
 */

import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import type { TimeseriesBucket } from "~/api/discover";
import { listExploreEvents, listExploreTimeseries, type ExploreEvent } from "~/api/exploreEvents";
import { mapAsyncStatus, valueOf, type AsyncStatus } from "~/core/async";
import type { ResolvedExploreQuery } from "~/core/exploreQuery";
import { exploreQuery, type ExploreTable } from "~/core/exploreTables";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";

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
    (signal: AbortSignal) =>
      client
        ? listExploreEvents(client, {
            org,
            query: combined,
            statsPeriod,
            project,
            environment,
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
  const eventsStatus = useAsyncFetch(eventsLoader, { reloadKey: reloadToken }).status;
  const timeseries = useAsyncFetch(timeseriesLoader, { reloadKey: reloadToken }).status;

  return {
    events: mapAsyncStatus(eventsStatus, (page) => page.data),
    timeseries,
    nextCursor: valueOf(eventsStatus)?.nextCursor ?? null,
  };
}
