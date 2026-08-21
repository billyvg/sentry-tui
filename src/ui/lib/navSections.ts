/**
 * Secondary-nav items, static and dynamic.
 *
 * `core/nav.ts` holds the static IA — the labels Sentry ships in the sidebar
 * whatever your data looks like. Two sections are not static: Explore's
 * Starred Queries and Dashboards' Starred Dashboards are lists of *your*
 * things, fetched per organization
 * (`views/navigation/secondary/sections/explore/exploreSecondaryNavigation.tsx:169`,
 * `.../dashboards/dashboardsSecondaryNavigation.tsx:79`). Those arrive here as
 * dynamic sections appended below the static ones.
 */

import { getNavGroup, type NavGroupId } from "~/core/nav";

export interface NavItemSpec {
  /** The label shown in the sidebar, and the id the app navigates by. */
  label: string;
  /** Short dim tag drawn after the label, e.g. `NEW`. */
  badge?: string;
  /**
   * Where selecting the item goes. Defaults to the item of the same label in
   * its own group — which is what every static item wants. A dynamic item
   * points at the screen that can render it: a starred query, for instance,
   * opens the query table rather than a screen of its own.
   */
  target?: { group: NavGroupId; item: string };
}

export interface NavSectionSpec {
  title?: string;
  items: readonly NavItemSpec[];
}

/** Extra sections and badges a group's sidebar shows beyond the static IA. */
export interface SecondaryNavExtras {
  /** Sections appended below the static ones, each under its own rule. */
  sections: readonly NavSectionSpec[];
  /** Badge text by item label, e.g. `{ Metrics: "NEW" }`. */
  badges: Readonly<Record<string, string>>;
}

export const NO_NAV_EXTRAS: SecondaryNavExtras = { sections: [], badges: {} };

/**
 * A group's sections as the sidebar draws them: the static IA, then whatever
 * dynamic sections were supplied.
 */
export function navSectionsFor(
  group: NavGroupId,
  extras: SecondaryNavExtras = NO_NAV_EXTRAS,
): NavSectionSpec[] {
  const staticSections = getNavGroup(group).sections.map((section) => ({
    title: section.title,
    items: section.items.map((label) => ({ label, badge: extras.badges[label] })),
  }));
  return [...staticSections, ...extras.sections];
}

/**
 * Every selectable item of a group in cursor order — what `j`/`k` walks.
 * Dynamic items are included, so the cursor doesn't skip over them.
 */
export function navItemsFor(
  group: NavGroupId,
  extras: SecondaryNavExtras = NO_NAV_EXTRAS,
): NavItemSpec[] {
  return navSectionsFor(group, extras).flatMap((section) => section.items);
}

/** The destination an item commits to when it is selected. */
export function navTargetOf(
  group: NavGroupId,
  item: NavItemSpec,
): { group: NavGroupId; item: string } {
  return item.target ?? { group, item: item.label };
}
