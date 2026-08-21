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
import { EXPLORE_NAV_BADGES } from "~/core/exploreNav";
import type { NavGroupId } from "~/core/nav";
import { NO_NAV_EXTRAS, type NavSectionSpec, type SecondaryNavExtras } from "~/ui/lib/navSections";

/**
 * Everything Explore's sidebar shows beyond the static IA.
 *
 * **The badges are attached here, at the arm, and on every path.** They are
 * static — the web hard-codes them — while the sections are fetched, so the
 * two have different failure modes: a fetch that returns nothing, fails, or
 * has not run yet must still leave the badges on. Building the return value
 * through this function is what makes that structural rather than a thing to
 * remember. A section builder that returns `NO_NAV_EXTRAS` on its empty path —
 * which is the natural way to write one, and how the starred-queries work on
 * `feat/saved-queries` does write it — would otherwise silently take all three
 * badges with it for any org that has starred nothing.
 *
 * So when the Starred Queries fetch lands here, it supplies `sections`; it
 * must not construct the `SecondaryNavExtras` itself.
 *
 * @param sections Dynamic sections, appended below the static ones. Empty
 *   today: no Explore section is fetched yet.
 */
function exploreNavExtras(sections: readonly NavSectionSpec[] = []): SecondaryNavExtras {
  return { sections, badges: EXPLORE_NAV_BADGES };
}

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
      return exploreNavExtras();
    default:
      return NO_NAV_EXTRAS;
  }
}
