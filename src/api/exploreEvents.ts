/**
 * The Explore tables' domain layer — one fetch for four screens.
 *
 * Traces, Metrics, Errors and Conversations are the same `events/` request
 * with a different `dataset` and `field[]`, so there is nothing dataset-shaped
 * here: the caller supplies the columns it wants, and gets back flat rows with
 * a stable key attached. What each field *means* is the config table's
 * business (`src/core/exploreTables.ts`), and how it draws is the screen's.
 *
 * Read-only, and manual-refresh only: nothing here polls.
 */

import type { SentryClient } from "~/api/client";
import {
  queryDiscover,
  queryDiscoverTimeseries,
  rowString,
  type DiscoverDataset,
  type DiscoverRow,
  type TimeseriesBucket,
} from "~/api/discover";

/**
 * One row of an Explore table.
 *
 * The row is kept flat rather than reshaped into four dataset-specific
 * interfaces: the columns are configuration, so a typed struct per dataset
 * would have to be regenerated every time a screen asks for another field.
 * Read values with `rowString` / `rowNumber` rather than indexing `row`.
 */
export interface ExploreEvent {
  /**
   * Identity of the row, from the dataset's own id field. Falls back to the
   * row's position, so a dataset that answers without one still gets keys
   * that are unique within the page.
   */
  id: string;
  /** The Discover row exactly as returned: field name → value. */
  row: DiscoverRow;
}

export const EXPLORE_PAGE_SIZE = 50;

export interface ListExploreEventsParams {
  org: string;
  dataset: DiscoverDataset;
  fields: readonly string[];
  sort?: string;
  /** Field holding the row's identity, e.g. `"id"`. */
  idField?: string;
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  cursor?: string;
  limit?: number;
  referrer?: string;
  signal?: AbortSignal;
}

/** Run one Explore table's query. */
export async function listExploreEvents(
  client: SentryClient,
  { idField = "id", limit = EXPLORE_PAGE_SIZE, ...params }: ListExploreEventsParams,
): Promise<{ data: ExploreEvent[]; nextCursor: string | null }> {
  const page = await queryDiscover(client, { ...params, limit });
  return {
    data: page.rows.map((row, index) => normalise(row, index, idField)),
    nextCursor: page.nextCursor,
  };
}

function normalise(row: DiscoverRow, index: number, idField: string): ExploreEvent {
  return { id: rowString(row, idField) ?? String(index), row };
}

export interface ListExploreTimeseriesParams {
  org: string;
  dataset: DiscoverDataset;
  yAxis: string;
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  referrer?: string;
  signal?: AbortSignal;
}

/**
 * The volume timeseries for the same query, for the chart above the table.
 *
 * Takes the identical filters, so the chart and the rows beneath it are
 * always describing the same set of events.
 */
export async function listExploreTimeseries(
  client: SentryClient,
  params: ListExploreTimeseriesParams,
): Promise<TimeseriesBucket[]> {
  return queryDiscoverTimeseries(client, params);
}
