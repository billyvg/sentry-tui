/**
 * Explore › Profiles — the slowest functions on the profiling landing page.
 *
 * The landing page's headline is an aggregate flamegraph; beneath it sits
 * `views/explore/profiling/landing/slowestFunctionsWidget.tsx`, a list of the
 * functions the org spends the most time inside. That list is what a terminal
 * can render honestly, and it is a Discover query like any other — the dataset
 * is `profileFunctions`, one row per (project, package, function) fingerprint.
 *
 * `useProfileFunctions.tsx:39-52` is the request: `events/` with
 * `dataset=profileFunctions`, the fields below, and a `-sum()` sort.
 */

import type { SentryClient } from "~/api/client";
import { queryDiscover, rowNumber, rowString, type DiscoverRow } from "~/api/discover";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** One aggregated function from the profiling dataset. */
export interface ProfileFunction {
  /** Stable id of the (project, package, function) triple. */
  fingerprint: string;
  /** Slug of the project the function was profiled in. */
  projectSlug?: string;
  /** Module, binary or package the function lives in. */
  package: string;
  /** Function name, as the profiler recorded it. */
  name: string;
  /** Times the function appeared across the profiles in the period. */
  count?: number;
  /** Total self time across those appearances, in nanoseconds. */
  totalSelfTimeNs?: number;
  /** p75 self time per appearance, in nanoseconds. */
  p75SelfTimeNs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Columns requested, from `slowestFunctionsWidget.tsx:563-570`.
 *
 * The widget pages three functions at a time (`MAX_FUNCTIONS = 3`) because
 * each one expands into a chart. A table has no such cost, so the page size
 * here is the app's usual one.
 *
 * `project` rather than the widget's `project.id`: the dataset resolves the
 * alias to the slug (`search/events/datasets/profile_functions.py:182`), which
 * is what a row renders, and the id is only there to build links we don't
 * have. `p75()` is added for a per-call figure — the widget offers it as a
 * sort option (`:596`) but its collapsed row shows only the total.
 */
const FUNCTION_FIELDS = [
  "project",
  "fingerprint",
  "package",
  "function",
  "count()",
  "sum()",
  "p75()",
] as const;

/** `sum()` descending — the widget's `DEFAULT_SORTING_OPTION` (`:72`). */
const FUNCTION_SORT = "-sum()";

export const PROFILE_FUNCTION_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface ListProfileFunctionsParams {
  org: string;
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/** Fetch the slowest functions, ordered by total self time. */
export async function listProfileFunctions(
  client: SentryClient,
  {
    org,
    query = "",
    statsPeriod,
    project,
    environment,
    cursor,
    limit = PROFILE_FUNCTION_PAGE_SIZE,
    signal,
  }: ListProfileFunctionsParams,
): Promise<{ data: ProfileFunction[]; nextCursor: string | null }> {
  const page = await queryDiscover(client, {
    org,
    dataset: "profileFunctions",
    fields: FUNCTION_FIELDS,
    sort: FUNCTION_SORT,
    query,
    statsPeriod,
    project,
    environment,
    cursor,
    limit,
    referrer: "sentry-tui.profile-functions",
    signal,
  });

  return { data: page.rows.map(normalise), nextCursor: page.nextCursor };
}

/** Reshape a flat Discover row into the structured function the table draws. */
function normalise(row: DiscoverRow, index: number): ProfileFunction {
  return {
    fingerprint: rowString(row, "fingerprint") ?? String(index),
    projectSlug: rowString(row, "project"),
    package: rowString(row, "package") ?? "",
    name: rowString(row, "function") ?? "",
    count: rowNumber(row, "count()"),
    totalSelfTimeNs: rowNumber(row, "sum()"),
    p75SelfTimeNs: rowNumber(row, "p75()"),
  };
}
