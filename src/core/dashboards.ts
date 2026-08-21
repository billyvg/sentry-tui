/**
 * The two Dashboards list screens, as data.
 *
 * `All Dashboards` and `Sentry Built` are one table over one endpoint with a
 * different query parameter, so they are one component plus this table rather
 * than two near-identical screens — the pattern `core/issueViews.ts` sets and
 * `docs/plans/002-screen-contract.md` §2 asks for. Keyed by `ScreenId`, so a
 * copy edit to a sidebar label cannot break the join.
 */

import type { DashboardListFilter, DashboardSort } from "~/api/dashboards";
import type { ScreenId } from "~/core/screens";

/** Everything that distinguishes one Dashboards list screen from the other. */
export interface DashboardListView {
  /** Heading above the table. */
  title: string;
  /** One line of context under the heading. */
  description: string;
  /** Server-side filter sent with the request. */
  filter?: DashboardListFilter;
  /** Sort sent with the request. */
  sort: DashboardSort;
  /** Placeholder for the screen's search input. */
  searchPlaceholder: string;
  /** Headline for the empty state. */
  emptyTitle: string;
  /**
   * Lines under the empty headline. Org feature flags are invisible to us, so
   * an empty result may mean "not enabled" rather than "nothing here" — both
   * possibilities have to be said out loud.
   */
  emptyLines: readonly string[];
}

/**
 * Both screens, keyed by the id `SCREENS` registers them under.
 *
 * `Sentry Built` is `?filter=onlyPrebuilt` (`dashboardsSecondaryNavigation.tsx:62-75`),
 * sorted by `DEFAULT_PREBUILT_SORT` (`manage/settings.tsx:3`). The default sort
 * elsewhere is `recentlyViewed` (`manage/index.tsx:88`).
 */
export const DASHBOARD_LIST_VIEWS: Readonly<Partial<Record<ScreenId, DashboardListView>>> = {
  "dashboards.all": {
    title: "All Dashboards",
    description: "Every dashboard in this organization.",
    sort: "recentlyViewed",
    searchPlaceholder: "Search dashboards by title…",
    emptyTitle: "No dashboards found.",
    emptyLines: [
      "This organization may not have dashboards enabled.",
      "Otherwise there are none yet — create one on sentry.io, as this client is read-only.",
    ],
  },
  "dashboards.sentry-built": {
    title: "Sentry Built",
    description: "Prebuilt dashboards Sentry ships for you.",
    filter: "onlyPrebuilt",
    sort: "mostPopular",
    searchPlaceholder: "Search Sentry Built dashboards…",
    emptyTitle: "No Sentry Built dashboards.",
    emptyLines: [
      "This organization may not have prebuilt dashboards enabled.",
      "The web app hides this section entirely without the feature; we can't read org features, so it shows up empty instead.",
    ],
  },
};

/** The list configuration for a screen, or `undefined` if it isn't one. */
export function getDashboardListView(id: ScreenId): DashboardListView | undefined {
  return DASHBOARD_LIST_VIEWS[id];
}
