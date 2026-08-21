/**
 * Dynamic sections and item badges for a nav group's sidebar.
 *
 * `App` renders whatever this returns and routes the `j`/`k` cursor through
 * it, so lighting up a group's sidebar is a change to this file alone. The
 * switch is the shape: one arm per group, so several can land independently.
 *
 * Filled in so far:
 *
 * - **Explore's feature badges**, which are static — the web hard-codes three
 *   of them (`exploreSecondaryNavigation.tsx:62`, `:74`, `:149`).
 * **One group, two lines.** A group's section is fetched by a hook of its own,
 * called unconditionally with an `enabled` flag — hooks cannot be conditional,
 * and the flag is what stops a sidebar nobody has opened from fetching — and
 * then returned by one `case` in the switch. Groups share nothing here, so two
 * people lighting up two sections touch two adjacent lines each.
 *
 * Known to be needed:
 *
 * - **Explore › Starred Queries** — `GET /organizations/{org}/explore/saved/`
 *   with `starred: true`, capped at `MAX_STARRED_SAVED_QUERIES_IN_NAV`
 *   (`exploreSecondaryNavigation.tsx:169`).
 * - **Dashboards › Starred Dashboards** — `GET /organizations/{org}/dashboards/starred/`
 *   (`dashboardsApiOptions.tsx:8-17`, `dashboardsSecondaryNavigation.tsx:79-83`).
 *
 * Still to come:
 *
 * - **Explore › Starred Queries** — `GET /organizations/{org}/explore/saved/`
 *   with `starred: true`, capped at `MAX_STARRED_SAVED_QUERIES_IN_NAV`
 *   (`exploreSecondaryNavigation.tsx:169`). It supplies `sections` to
 *   `exploreNavExtras`; see the warning on that function.
 *
 * **Adding a group's section is additive.** Fetch it with a hook called
 * unconditionally and gated by an `enabled` flag — the sidebar is mounted for
 * the whole session, so an ungated fetch would run on app start — then add one
 * arm to the switch. Each group owns its own arm; nothing here is shared.
 *
 * Whatever fetches land here must respect the app's manual-refresh rule: take
 * `reloadToken` as an effect dependency, and never poll.
 */

import type { SentryClient } from "~/api/client";
import { EXPLORE_NAV_BADGES } from "~/core/exploreNav";
import type { NavGroupId } from "~/core/nav";
import { useStarredDashboards } from "~/ui/hooks/useDashboards";
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
 * which is the natural way to write one — would otherwise silently take all
 * three badges with it for any org that has starred nothing.
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
 * A starred dashboard has no screen of its own, so its item points at the list
 * that contains it. Carrying the selected dashboard through to the detail view
 * would need a way to hand a row id to a nav destination, which the shell does
 * not have — see `docs/plans/002-screen-contract.md` §7.
 */
const STARRED_DASHBOARD_TARGET = { group: "dashboards", item: "All Dashboards" } as const;
import { useDashboardsNavExtras } from "~/ui/hooks/useDashboards";
import { NO_NAV_EXTRAS, type SecondaryNavExtras } from "~/ui/lib/navSections";

/**
 * @param client Authenticated API client, or null before sign-in.
 * @param org The open organization — dynamic sections are org-scoped.
 * @param group The group whose sidebar is open.
 * @param reloadToken Bump to refetch; the app's global refresh.
 */
export function useSecondaryNavExtras(
  client: SentryClient | null,
  org: string,
  group: NavGroupId,
  reloadToken: number,
): SecondaryNavExtras {
  const dashboards = useDashboardsNavExtras(client, org, group === "dashboards", reloadToken);

  return useMemo(() => {
    switch (group) {
      case "explore":
        return exploreNavExtras();
      case "dashboards":
        // The web hides the section when nothing is starred rather than
        // showing an empty heading; so do we.
        if (starredDashboards.length === 0) return NO_NAV_EXTRAS;
        return {
          sections: [
            {
              title: "Starred Dashboards",
              items: starredDashboards.map((dashboard) => ({
                label: dashboard.title,
                target: STARRED_DASHBOARD_TARGET,
              })),
            },
          ],
          badges: {},
        };
      default:
        return NO_NAV_EXTRAS;
    }
  }, [group, starredDashboards]);
  switch (group) {
    case "dashboards":
      return dashboards;
    default:
      return NO_NAV_EXTRAS;
  }
}
