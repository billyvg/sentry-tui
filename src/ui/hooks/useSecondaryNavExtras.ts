/**
 * Dynamic sections for a nav group's sidebar.
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
import {
  MAX_STARRED_SAVED_QUERIES_IN_NAV,
  savedQueryProjectSlugs,
  type SavedQuery,
} from "~/api/savedQueries";
import { valueOf } from "~/core/async";
import type { NavGroupId } from "~/core/nav";
import { useDashboardsNavExtras } from "~/ui/hooks/useDashboards";
import { useProjects } from "~/ui/hooks/useProjects";
import { useSavedQueries } from "~/ui/hooks/useSavedQueries";
import { NO_NAV_EXTRAS, type NavSectionSpec, type SecondaryNavExtras } from "~/ui/lib/navSections";
import { savedQueryResultsView } from "~/ui/screens/SavedQueryResults";

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
      return { sections: exploreSections };
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
 * Selecting one runs it: the item targets All Queries so the list is what
 * Escape comes back to, and carries the query's results as its `open` view, so
 * it lands on the query itself rather than on the list it lives in.
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

  // Gated on the same flag: a saved query's results open on the projects it was
  // saved with, which are ids on the wire and slugs everywhere else — but the
  // nav is mounted for the whole session, so asking on start would be a
  // request for a sidebar nobody has opened.
  const projects = useProjects(client, org, enabled);
  const slugById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.slug);
    return map;
  }, [projects]);

  // `valueOf` is undefined while loading and after a failure with nothing
  // cached, which is exactly the degradation this wants: no section.
  const starred = valueOf(status);

  return useMemo(() => starredQueriesSections(starred, slugById), [starred, slugById]);
}

/** The Starred Queries section, or nothing when there is nothing starred. */
function starredQueriesSections(
  starred: readonly SavedQuery[] | undefined,
  slugById: ReadonlyMap<string, string>,
): readonly NavSectionSpec[] {
  if (!starred || starred.length === 0) return [];

  return [
    {
      title: "Starred Queries",
      items: starred.slice(0, MAX_STARRED_SAVED_QUERIES_IN_NAV).map((query) => ({
        label: query.name,
        target: { group: "explore" as const, item: "All Queries" },
        // Built when the item is chosen, off the mapping current at that
        // moment — so a selection made after the project list lands opens on
        // the query's projects even though the item was drawn before it did.
        open: () => savedQueryResultsView(query, savedQueryProjectSlugs(query, slugById)),
      })),
    },
  ];
}
