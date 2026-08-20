import { join } from "node:path";

import type { NavGroupId } from "~/core/nav";

/** Directory containing the pre-rendered nav icon PNGs. */
const ICONS_DIR = join(import.meta.dir, "../../assets/icons");

/** Map each nav group to its icon base name (matches Sentry web icon names). */
const ICON_BASE: Record<NavGroupId, string> = {
  issues: "issues",
  explore: "compass",
  dashboards: "dashboard",
  monitors: "monitors",
  settings: "settings",
};

/** Height of each icon in terminal rows. */
const ICON_HEIGHT = 2;
/** Width of each icon in terminal cells. */
const ICON_WIDTH = 2;

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
  const base = ICON_BASE[groupId];
  const variant = active ? "active" : "inactive";
  const source = join(ICONS_DIR, `${base}_${variant}.png`);

  return (
    <image
      source={source}
      fit="fit"
      style={{
        width: ICON_WIDTH,
        height: ICON_HEIGHT,
      }}
    />
  );
}

/** The Sentry logo mark for the top of the nav rail. */
export function SentryLogo() {
  const source = join(ICONS_DIR, "sentry.png");

  return (
    <image
      source={source}
      fit="fit"
      style={{
        width: ICON_WIDTH,
        height: ICON_HEIGHT,
      }}
    />
  );
}
