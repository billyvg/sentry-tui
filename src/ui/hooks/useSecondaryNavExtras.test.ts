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
import { navItemsFor, navSectionsFor, type SecondaryNavExtras } from "~/ui/lib/navSections";
import { useSecondaryNavExtras } from "~/ui/hooks/useSecondaryNavExtras";

const EXPLORE_ITEMS = getNavGroup("explore").sections.flatMap((section) => section.items);

/**
 * The hook holds no state today, so it can be called directly. If a fetch
 * lands in it this becomes a render test — but the invariant below is the
 * point either way, and `navSectionsFor` covers it without a renderer.
 */
function exploreExtras(): SecondaryNavExtras {
  return useSecondaryNavExtras(null, "acme", "explore", 0);
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
    for (const group of ["issues", "dashboards", "monitors", "settings"] as const) {
      expect(useSecondaryNavExtras(null, "acme", group, 0).badges).toEqual({});
    }
  });
});
