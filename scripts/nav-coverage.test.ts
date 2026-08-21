/**
 * Nav ↔ screen registry coverage.
 *
 * The sidebar and the screen registry are two lists of the same destinations,
 * joined by a string label. Nothing in the type system holds them together, so
 * this does: every nav item must resolve to a registered screen, and every
 * registered screen must be reachable from the nav.
 *
 * A screen nobody has built yet passes — `kind: "stub"` is a legitimate
 * answer. A *missing* entry is what fails, because `screenFor` throws on one
 * and the pane it should have rendered is a crash instead.
 */

import { describe, expect, test } from "bun:test";

import { NAV_GROUPS } from "~/core/nav";
import { findScreen, navDestinations, SCREENS, screenFor } from "~/core/screens";

describe("nav coverage", () => {
  test("every nav item resolves to a registered screen", () => {
    const missing = navDestinations()
      .filter(({ group, item }) => !findScreen(group, item))
      .map(({ group, item }) => `${group} › ${item}`);

    expect(missing).toEqual([]);
  });

  test("screenFor resolves every nav item without throwing", () => {
    for (const { group, item } of navDestinations()) {
      expect(() => screenFor(group, item)).not.toThrow();
    }
  });

  test("every registered screen is reachable from the nav", () => {
    const destinations = new Set(navDestinations().map(({ group, item }) => `${group}::${item}`));
    const orphans = SCREENS.filter(
      (screen) => !destinations.has(`${screen.group}::${screen.item}`),
    ).map((screen) => screen.id);

    expect(orphans).toEqual([]);
  });

  test("screen ids are unique", () => {
    const ids = SCREENS.map((screen) => screen.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  test("the registry has exactly one screen per nav item", () => {
    const navItemCount = NAV_GROUPS.reduce(
      (total, group) =>
        total + group.sections.reduce((sum, section) => sum + section.items.length, 0),
      0,
    );
    expect(SCREENS).toHaveLength(navItemCount);
  });

  test("screens sharing a state key declare the same defaults", () => {
    const byKey = new Map<string, Set<string>>();
    for (const screen of SCREENS) {
      if (!screen.stateKey) continue;
      const seen = byKey.get(screen.stateKey) ?? new Set<string>();
      // A shared slice is created once, from the defaults of whichever screen
      // in it comes first — so differing defaults are a silent coin toss.
      seen.add(JSON.stringify(screen.defaults ?? {}));
      byKey.set(screen.stateKey, seen);
    }

    const conflicting = [...byKey]
      .filter(([, variants]) => variants.size > 1)
      .map(([key, variants]) => `${key}: ${[...variants].join(" vs ")}`);

    expect(conflicting).toEqual([]);
  });
});
