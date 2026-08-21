/**
 * Dynamic sections and item badges for a nav group's sidebar.
 *
 * `App` renders whatever this returns and routes the `j`/`k` cursor through
 * it, so lighting up a group's sidebar is a change to this file alone. The
 * switch is the shape: one arm per group, so several can land independently.
 *
 * Filled in so far: **Explore's feature badges**, which are static — the web
 * hard-codes three of them (`exploreSecondaryNavigation.tsx:62`, `:74`,
 * `:149`), so that arm is a constant and needs no client.
 *
 * Still to come, both of them fetches:
 *
 * - **Explore › Starred Queries** — `GET /organizations/{org}/explore/saved/`
 *   with `starred: true`, capped at `MAX_STARRED_SAVED_QUERIES_IN_NAV`
 *   (`exploreSecondaryNavigation.tsx:169`). Each item targets
 *   `{group: "explore", item: "All Queries"}` or the table that runs it. It
 *   shares this arm with the badges: a section and a badge map come back
 *   together, so whichever lands second keeps both rather than replacing one.
 * - **Dashboards › Starred Dashboards** — `GET /organizations/{org}/dashboards/starred/`
 *   (`dashboardsApiOptions.tsx:10`, `dashboardsSecondaryNavigation.tsx:79`).
 *
 * Whatever fetches land here must respect the app's manual-refresh rule: take
 * `reloadToken` as an effect dependency, and never poll.
 */

import type { SentryClient } from "~/api/client";
import { EXPLORE_NAV_BADGES } from "~/core/exploreTables";
import type { NavGroupId } from "~/core/nav";
import { NO_NAV_EXTRAS, type SecondaryNavExtras } from "~/ui/lib/navSections";

/**
 * Explore's feature badges.
 *
 * No fetch behind them: they are what the web ships statically
 * (`exploreSecondaryNavigation.tsx`), so this arm is a constant rather than a
 * hook. A group that *does* fetch adds its own hook beside this — the switch
 * is the shape, one arm per group, so several can land independently.
 */
const EXPLORE_EXTRAS: SecondaryNavExtras = { sections: [], badges: EXPLORE_NAV_BADGES };

/**
 * @param client Authenticated API client, or null before sign-in.
 * @param org The open organization — dynamic sections are org-scoped.
 * @param group The group whose sidebar is open.
 * @param reloadToken Bump to refetch; the app's global refresh.
 */
export function useSecondaryNavExtras(
  _client: SentryClient | null,
  _org: string,
  group: NavGroupId,
  _reloadToken: number,
): SecondaryNavExtras {
  switch (group) {
    case "explore":
      return EXPLORE_EXTRAS;
    default:
      return NO_NAV_EXTRAS;
  }
}
