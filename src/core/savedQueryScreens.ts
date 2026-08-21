/**
 * Config for the two saved-query screens.
 *
 * `Explore › All Queries` and `Explore › Discover` are the same list over two
 * endpoints — the current saved-query store and the legacy Discover one. They
 * are one component plus this table rather than two near-identical screens, per
 * the sibling-screen rule in `docs/plans/002-screen-contract.md` §2.
 *
 * Keyed by `ScreenId` rather than by nav label: a copy edit to the sidebar must
 * not be able to break the join.
 */

import type { SavedQuerySource } from "~/api/savedQueries";
import type { ScreenId } from "~/core/screens";

export interface SavedQueryScreenConfig {
  /** Which endpoint backs the list. */
  source: SavedQuerySource;
  /** Heading above the table. */
  title: string;
  /** One line under the heading, saying what this list is. */
  description: string;
  /** Status-bar noun: `saved queries` reads as "loading saved queries…". */
  noun: string;
  /** Placeholder in the search box. The endpoints filter on name, not query. */
  searchPlaceholder: string;
  /**
   * Header of the rightmost column. Explore records when *you* last opened a
   * query; the legacy store only knows when it was last edited.
   */
  activityLabel: string;
  /**
   * Second line of the empty state. Org feature flags are invisible to us, so
   * an empty list may mean the surface is switched off rather than unused —
   * both readings have to be offered.
   */
  emptyHint: string;
}

const SAVED_QUERY_SCREENS: Partial<Record<ScreenId, SavedQueryScreenConfig>> = {
  "explore.all-queries": {
    source: "explore",
    title: "All Queries",
    description: "Saved Explore queries for this organization.",
    noun: "saved queries",
    searchPlaceholder: "Search queries by name…",
    activityLabel: "Last Viewed",
    emptyHint: "This organization may not have Explore saved queries enabled.",
  },
  "explore.discover": {
    source: "discover",
    title: "Discover",
    description: "Legacy saved queries, superseded by All Queries.",
    noun: "Discover queries",
    searchPlaceholder: "Search queries by name…",
    activityLabel: "Last Edited",
    emptyHint: "This organization may not have Discover enabled.",
  },
};

/** The saved-query list a screen renders, or `undefined` if it isn't one. */
export function savedQueryScreen(id: ScreenId): SavedQueryScreenConfig | undefined {
  return SAVED_QUERY_SCREENS[id];
}

/** The slice a saved query's results are shown in, pushed from either list. */
export const SAVED_QUERY_RESULTS_STATE_KEY = "explore.saved-query-results";
