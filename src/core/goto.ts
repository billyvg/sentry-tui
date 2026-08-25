/**
 * Goto mode: the keys printed beside every navigation destination while `g` is
 * held open.
 *
 * Both nav panes are on screen at once in this mode, so their keys are assigned
 * from one pool — pressing `e` can't mean Explore in the rail and something else
 * in the list beside it. The primary groups are assigned first, so a group keeps
 * its own initial and only the secondary items ever get pushed onto a later
 * character.
 */

import { primaryKey } from "~/core/commands";
import { getNavGroup, NAV_GROUPS, type NavGroup, type NavGroupId } from "~/core/nav";
import { assignHotkeys, type Hotkey } from "~/lib/hotkeys";

/** Where a goto key leads. */
export type GotoTarget =
  /** Point the secondary pane at another group, staying in goto mode. */
  | { kind: "group"; group: NavGroupId }
  /** Open a secondary item — the end of the journey. */
  | { kind: "item"; item: string };

export interface GotoHotkeys {
  /** Key for each primary nav group. */
  groups: ReadonlyMap<NavGroupId, Hotkey>;
  /** Key for each item of the group the secondary pane is showing. */
  items: ReadonlyMap<string, Hotkey>;
  /** Reverse lookup for dispatch: the key pressed to where it leads. */
  byKey: ReadonlyMap<string, GotoTarget>;
}

/**
 * Keys goto mode may not hand to a destination.
 *
 * `g` is how the mode opens and, once open, how it closes — giving it away
 * would make the key that got you here mean something else on arrival. The org
 * picker's key is printed in the rail beside the slug the whole time the mode
 * is up, so it has to keep meaning what it says while the keys are showing.
 */
const RESERVED_KEYS = [primaryKey("sentry.nav.goto"), primaryKey("sentry.app.switchOrg")].filter(
  Boolean,
);

/**
 * Keys for everything reachable while the secondary pane is showing `group`.
 *
 * Recomputed per group rather than cached: the item half changes with the group,
 * and the assignment is a handful of string scans.
 */
export function buildGotoHotkeys(
  group: NavGroupId,
  navGroups: readonly NavGroup[] = NAV_GROUPS,
): GotoHotkeys {
  const items = getNavGroup(group).sections.flatMap((section) => section.items);
  const assigned = assignHotkeys(
    [...navGroups.map((navGroup) => navGroup.label), ...items],
    RESERVED_KEYS,
  );

  const groups = new Map<NavGroupId, Hotkey>();
  const itemKeys = new Map<string, Hotkey>();
  const byKey = new Map<string, GotoTarget>();

  navGroups.forEach((navGroup, index) => {
    const hotkey = assigned[index];
    if (!hotkey) return;
    groups.set(navGroup.id, hotkey);
    byKey.set(hotkey.key, { kind: "group", group: navGroup.id });
  });

  items.forEach((item, index) => {
    const hotkey = assigned[navGroups.length + index];
    if (!hotkey) return;
    // Keyed by label because that is what the pane renders; two items in one
    // group sharing a label would share a hint, which is a nav bug either way.
    itemKeys.set(item, hotkey);
    byKey.set(hotkey.key, { kind: "item", item });
  });

  return { groups, items: itemKeys, byKey };
}
