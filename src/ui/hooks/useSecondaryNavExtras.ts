/**
 * Dynamic sections and item badges for a nav group's sidebar.
 *
 * The mechanism, wired end to end, with no data behind it yet: `App` already
 * renders whatever this returns and routes the cursor through it, so lighting
 * up a dynamic section is a change to this file alone.
 *
 * Two are known to be needed:
 *
 * - **Explore › Starred Queries** — `GET /organizations/{org}/explore/saved/`
 *   with `starred: true`, capped at `MAX_STARRED_SAVED_QUERIES_IN_NAV`
 *   (`exploreSecondaryNavigation.tsx:169`). Each item targets
 *   `{group: "explore", item: "All Queries"}` or the table that runs it.
 * - **Dashboards › Starred Dashboards** — `GET /organizations/{org}/dashboards/starred/`
 *   (`dashboardsApiOptions.tsx:10`, `dashboardsSecondaryNavigation.tsx:79`).
 *
 * And one badge: Explore › Metrics carries a `new` feature badge in the web
 * nav, which renders here as `{ Metrics: "NEW" }`.
 *
 * Whatever fetches land here must respect the app's manual-refresh rule: take
 * `reloadToken` as an effect dependency, and never poll.
 */

import { useMemo } from "react";

import type { SentryClient } from "~/api/client";
import { EXPLORE_NAV_BADGES } from "~/core/exploreTables";
import type { NavGroupId } from "~/core/nav";
import { NO_NAV_EXTRAS, type SecondaryNavExtras } from "~/ui/lib/navSections";

/** Explore's feature badges, which need no fetch — they are what the web ships. */
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
  return useMemo(() => (group === "explore" ? EXPLORE_EXTRAS : NO_NAV_EXTRAS), [group]);
}
