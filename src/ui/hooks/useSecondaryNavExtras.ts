/**
 * Dynamic sections and item badges for a nav group's sidebar.
 *
 * `core/nav.ts` holds the static IA; this holds the parts of the sidebar that
 * are lists of *your* things, fetched per organization. `App` renders whatever
 * comes back and routes the `j`/`k` cursor through it, so lighting up a section
 * is a change to this file alone.
 *
 * **One group, two lines.** A group's section is fetched by a hook of its own,
 * called unconditionally with an `enabled` flag — hooks cannot be conditional,
 * and the flag is what stops a sidebar nobody has opened from fetching — and
 * then returned by one `case` in the switch. Groups share nothing here, so two
 * people lighting up two sections touch two adjacent lines each.
 *
 * Filled in so far:
 *
 * - **Explore's feature badges**, which are static — the web hard-codes three
 *   of them (`exploreSecondaryNavigation.tsx:62`, `:74`, `:149`).
 * - **Explore › Starred Queries** — `GET /organizations/{org}/explore/saved/`
 *   with `starred: true`, capped at `MAX_STARRED_SAVED_QUERIES_IN_NAV`
 *   (`exploreSecondaryNavigation.tsx:169`).
 * - **Dashboards › Starred Dashboards** — `GET /organizations/{org}/dashboards/starred/`
 *   (`dashboardsApiOptions.tsx:8-17`, `dashboardsSecondaryNavigation.tsx:79-83`).
 *
 * Two rules every fetch in here obeys:
 *
 * - **Manual refresh only.** `reloadToken` is a dependency; nothing polls.
 * - **Fail silently.** This runs as soon as a sidebar is opened. A failed
 *   background fetch must cost the user a missing section, never a broken nav —
 *   so a rejected request degrades to no section at all.
 */

import { useMemo } from "react";

import type { SentryClient } from "~/api/client";
import { MAX_STARRED_SAVED_QUERIES_IN_NAV, type SavedQuery } from "~/api/savedQueries";
import { valueOf } from "~/core/async";
import { EXPLORE_NAV_BADGES } from "~/core/exploreNav";
import type { NavGroupId } from "~/core/nav";
import { useDashboardsNavExtras } from "~/ui/hooks/useDashboards";
import { useSavedQueries } from "~/ui/hooks/useSavedQueries";
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
 * So the Starred Queries fetch below supplies `sections`; it does not
 * construct the `SecondaryNavExtras` itself.
 *
 * @param sections Dynamic sections, appended below the static ones.
 */
export function exploreNavExtras(sections: readonly NavSectionSpec[] = []): SecondaryNavExtras {
  return { sections, badges: EXPLORE_NAV_BADGES };
}

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
  const exploreSections = useExploreNavSections(client, org, group === "explore", reloadToken);
  const dashboards = useDashboardsNavExtras(client, org, group === "dashboards", reloadToken);

  switch (group) {
    case "explore":
      return exploreNavExtras(exploreSections);
    case "dashboards":
      return dashboards;
    default:
      return NO_NAV_EXTRAS;
  }
}

/**
 * Explore › Starred Queries — the queries you have starred, under their own
 * rule below All Queries (`exploreSecondaryNavigation.tsx:169`).
 *
 * Each item targets All Queries rather than a screen of its own: a starred
 * query has no destination, and the nav carries no payload beyond a
 * `{group, item}`, so the sidebar's job here is to show what is starred and
 * hand you to the list that can run it.
 *
 * Returns sections rather than a `SecondaryNavExtras` — see `exploreNavExtras`
 * for why that split exists.
 */
function useExploreNavSections(
  client: SentryClient | null,
  org: string,
  enabled: boolean,
  reloadToken: number,
): readonly NavSectionSpec[] {
  const status = useSavedQueries(client, {
    org,
    source: "explore",
    starred: true,
    // The web's own cap, and its `per_page` — the section is a preview, not a
    // second copy of the table.
    limit: MAX_STARRED_SAVED_QUERIES_IN_NAV,
    enabled,
    reloadToken,
  });

  // `valueOf` is undefined while loading and after a failure with nothing
  // cached, which is exactly the degradation this wants: no section.
  const starred = valueOf(status);

  return useMemo(() => starredQueriesSections(starred), [starred]);
}

/** The Starred Queries section, or nothing when there is nothing starred. */
function starredQueriesSections(
  starred: readonly SavedQuery[] | undefined,
): readonly NavSectionSpec[] {
  if (!starred || starred.length === 0) return [];

  return [
    {
      title: "Starred Queries",
      items: starred.slice(0, MAX_STARRED_SAVED_QUERIES_IN_NAV).map((query) => ({
        label: query.name,
        target: { group: "explore" as const, item: "All Queries" },
      })),
    },
  ];
}
