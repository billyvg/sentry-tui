import { describe, expect, test } from "bun:test";

import { formatKey, primaryKey } from "~/core/commands";
import { NAV_GROUPS } from "~/core/nav";
import { measureTextWidth } from "~/lib/text";
import { NAV_RAIL_WIDTH } from "~/ui/components/NavRail";
import { NAV_ICON_WIDTH } from "~/ui/components/NavIcon";

/** Border plus padding on each side — the cells a label can't use. */
const CHROME = 4;

/** The org avatar's footprint at the top of the rail. */
const AVATAR_WIDTH = 2;

/** A separating space plus the parenthesised key printed beside the org slug. */
const ORG_KEY_HINT_WIDTH = 1 + measureTextWidth(formatKey(primaryKey("sentry.app.switchOrg"))) + 2;

const widestLabel = Math.max(...NAV_GROUPS.map((g) => measureTextWidth(g.label)));

describe("NAV_RAIL_WIDTH", () => {
  test("fits every nav label beside its icon without wrapping", () => {
    const usable = NAV_RAIL_WIDTH - CHROME - NAV_ICON_WIDTH - 1;
    for (const group of NAV_GROUPS) {
      expect(measureTextWidth(group.label)).toBeLessThanOrEqual(usable);
    }
  });

  test("leaves the org slug the same run as the widest nav label", () => {
    // The org header is the rail's other kind of row: avatar, slug, and the
    // picker's key. Were the key allowed to eat into the slug, adding the
    // control would have silently shortened every org name in the rail.
    const usable = NAV_RAIL_WIDTH - CHROME - AVATAR_WIDTH - 1 - ORG_KEY_HINT_WIDTH;
    expect(usable).toBeGreaterThanOrEqual(widestLabel);
  });

  test("is no wider than its widest row needs", () => {
    const navItemRow = NAV_ICON_WIDTH + 1 + widestLabel;
    const orgHeaderRow = AVATAR_WIDTH + 1 + widestLabel + ORG_KEY_HINT_WIDTH;
    expect(NAV_RAIL_WIDTH).toBe(CHROME + Math.max(navItemRow, orgHeaderRow));
  });
});
