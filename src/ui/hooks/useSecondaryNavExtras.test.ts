/**
 * The Explore sidebar's badges must survive whatever happens to its sections.
 *
 * They are static and the sections are fetched, so the two fail differently: a
 * fetch that returns nothing, fails, or has not run leaves `sections` empty,
 * and the badges must still be there. This is the regression that would
 * otherwise reach only orgs with no starred queries — i.e. not the reviewer's.
 */

import { describe, expect, test } from "bun:test";

import { EXPLORE_NAV_BADGES } from "~/core/exploreNav";
import { getNavGroup } from "~/core/nav";
import {
  navItemsFor,
  navSectionsFor,
  NO_NAV_EXTRAS,
  type SecondaryNavExtras,
} from "~/ui/lib/navSections";
import { exploreNavExtras } from "~/ui/hooks/useSecondaryNavExtras";

const EXPLORE_ITEMS = getNavGroup("explore").sections.flatMap((section) => section.items);

/**
 * Asserted against the Explore arm itself rather than through
 * `useSecondaryNavExtras`, which became a real hook once Dashboards' starred
 * section landed a fetch in it and can no longer be called outside a render.
 *
 * The invariant lives here anyway: this function is what attaches the badges
 * on every path, and the hook's `case "explore"` does nothing but return it.
 */
function exploreExtras(): SecondaryNavExtras {
  return exploreNavExtras();
}

describe("Explore nav badges", () => {
  test("are the three the web draws, and no others", () => {
    expect(EXPLORE_NAV_BADGES).toEqual({
      Metrics: "NEW",
      Errors: "ALPHA",
      Conversations: "BETA",
    });
  });

  test("every badged label is a real Explore nav item", () => {
    for (const label of Object.keys(EXPLORE_NAV_BADGES)) {
      expect(EXPLORE_ITEMS).toContain(label);
    }
  });

  test("the Explore arm carries them with no dynamic sections at all", () => {
    const extras = exploreExtras();
    expect(extras.sections).toEqual([]);
    expect(extras.badges).toEqual(EXPLORE_NAV_BADGES);
  });

  test("they reach the rendered items whether or not a section is present", () => {
    const withSection: SecondaryNavExtras = {
      sections: [{ title: "Starred Queries", items: [{ label: "p95 by transaction" }] }],
      badges: EXPLORE_NAV_BADGES,
    };

    for (const extras of [exploreExtras(), withSection]) {
      const byLabel = new Map(navItemsFor("explore", extras).map((item) => [item.label, item]));
      expect(byLabel.get("Metrics")?.badge).toBe("NEW");
      expect(byLabel.get("Errors")?.badge).toBe("ALPHA");
      expect(byLabel.get("Conversations")?.badge).toBe("BETA");
      // Nothing else picks one up by accident.
      expect(byLabel.get("Traces")?.badge).toBeUndefined();
      expect(byLabel.get("Logs")?.badge).toBeUndefined();
    }
  });

  test("an empty dynamic section does not take the badges with it", () => {
    // The shape a section builder returns on its empty path. Badges are
    // attached at the arm, so this cannot drop them — that is the whole point
    // of `exploreNavExtras`, and the merge hazard this pins.
    const emptied: SecondaryNavExtras = { ...exploreExtras(), sections: [] };
    const labels = navSectionsFor("explore", emptied)
      .flatMap((section) => section.items)
      .filter((item) => item.badge);
    expect(labels.map((item) => `${item.label} ${item.badge}`).sort()).toEqual([
      "Conversations BETA",
      "Errors ALPHA",
      "Metrics NEW",
    ]);
  });

  test("no other group gets Explore's badges", () => {
    // Every other group either falls through to `NO_NAV_EXTRAS` or returns its
    // own arm. Asserted on the fall-through here because the hook now fetches
    // and cannot be called outside a render; the Dashboards arm builds its own
    // `badges: {}` and is covered by `test/dashboards.test.tsx`.
    expect(NO_NAV_EXTRAS.badges).toEqual({});
  });
});
