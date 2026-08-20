import { describe, expect, test } from "bun:test";

import { NAV_GROUPS } from "~/core/nav";
import { measureTextWidth } from "~/lib/text";
import { NAV_RAIL_WIDTH } from "~/ui/components/NavRail";
import { NAV_ICON_WIDTH } from "~/ui/components/NavIcon";

/** Border plus padding on each side — the cells a label can't use. */
const CHROME = 4;

describe("NAV_RAIL_WIDTH", () => {
  test("fits every nav label beside its icon without wrapping", () => {
    const usable = NAV_RAIL_WIDTH - CHROME - NAV_ICON_WIDTH - 1;
    for (const group of NAV_GROUPS) {
      expect(measureTextWidth(group.label)).toBeLessThanOrEqual(usable);
    }
  });

  test("is no wider than the longest label needs", () => {
    const widest = Math.max(...NAV_GROUPS.map((g) => measureTextWidth(g.label)));
    expect(NAV_RAIL_WIDTH).toBe(CHROME + NAV_ICON_WIDTH + 1 + widest);
  });
});
