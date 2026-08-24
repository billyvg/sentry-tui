import { navIconBytes } from "~/assets/navIcons";
import type { NavGroupId } from "~/core/nav";

/**
 * Map each nav group to its icon base name (matches Sentry web icon names).
 *
 * `as const satisfies` rather than an annotation so the names stay literal
 * types — that is what lets the lookup below typecheck against the embedded
 * icon set instead of accepting any string.
 */
const ICON_BASE = {
  issues: "issues",
  explore: "compass",
  dashboards: "dashboard",
  seer: "seer",
  monitors: "monitors",
} as const satisfies Record<NavGroupId, string>;

/**
 * Icon footprint in terminal cells. A cell is roughly twice as tall as it is
 * wide, so 2 columns by 1 row is close to square — the source PNGs are square,
 * and this keeps each nav item a single row.
 */
const ICON_HEIGHT = 1;
export const NAV_ICON_WIDTH = 2;

interface NavIconProps {
  groupId: NavGroupId;
  active: boolean;
}

/**
 * Renders a Sentry navigation icon as a small terminal image.
 *
 * Uses OpenTUI's `<image>` element which auto-detects the best rendering
 * protocol (kitty graphics → sixel). Active and inactive states use separate
 * pre-rendered PNGs with matching theme colors.
 */
export function NavIcon({ groupId, active }: NavIconProps) {
  const variant = active ? "active" : "inactive";

  return (
    <image
      source={navIconBytes(`${ICON_BASE[groupId]}_${variant}`)}
      fit="fit"
      style={{
        width: NAV_ICON_WIDTH,
        height: ICON_HEIGHT,
      }}
    />
  );
}

/** The Sentry logo mark for the top of the nav rail. */
export function SentryLogo() {
  return (
    <image
      source={navIconBytes("sentry")}
      fit="fit"
      style={{
        width: NAV_ICON_WIDTH,
        height: ICON_HEIGHT,
      }}
    />
  );
}
