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
import type { ViewStackEntry } from "~/ui/screens/types";

export interface NavItemSpec {
  /** The label shown in the sidebar, and the id the app navigates by. */
  label: string;
  /**
   * Where selecting the item goes. Defaults to the item of the same label in
   * its own group — which is what every static item wants. A dynamic item
   * points at the screen that can render it: a starred query, for instance,
   * opens the query table rather than a screen of its own.
   */
  target?: { group: NavGroupId; item: string };
  /**
   * What selecting the item *shows*, beyond arriving at its `target`.
   *
   * A dynamic item stands for one of the user's own things — a starred query,
   * a starred dashboard — and `target` has nowhere to put that identity: it is
   * a nav destination, and every item in a starred section shares one. This is
   * the other half. The app navigates to `target`, then pushes whatever this
   * returns, so the item lands on *its* thing rather than on the list that
   * thing lives in.
   *
   * A `ViewStackEntry` rather than a payload the app would have to interpret:
   * that is already the app's currency for "here is a thing to show", so
   * nothing between here and the renderer has to learn what a saved query or a
   * dashboard is. Called at selection time, so the entry is built fresh and an
   * unselected item costs nothing.
   *
   * Omit it and selecting the item only navigates — what every static item
   * wants, and what a dynamic item that really is just a shortcut wants too.
   */
  open?: () => ViewStackEntry;
}

export interface NavSectionSpec {
  title?: string;
  items: readonly NavItemSpec[];
}

/** Extra sections a group's sidebar shows beyond the static IA. */
export interface SecondaryNavExtras {
  /** Sections appended below the static ones, each under its own rule. */
  sections: readonly NavSectionSpec[];
}

export const NO_NAV_EXTRAS: SecondaryNavExtras = { sections: [] };

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
    items: section.items.map((label) => ({ label })),
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
