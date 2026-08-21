import compassActive from "./icons/compass_active.png" with { type: "file" };
import compassInactive from "./icons/compass_inactive.png" with { type: "file" };
import dashboardActive from "./icons/dashboard_active.png" with { type: "file" };
import dashboardInactive from "./icons/dashboard_inactive.png" with { type: "file" };
import issuesActive from "./icons/issues_active.png" with { type: "file" };
import issuesInactive from "./icons/issues_inactive.png" with { type: "file" };
import monitorsActive from "./icons/monitors_active.png" with { type: "file" };
import monitorsInactive from "./icons/monitors_inactive.png" with { type: "file" };
import seerActive from "./icons/seer_active.png" with { type: "file" };
import seerInactive from "./icons/seer_inactive.png" with { type: "file" };
import sentry from "./icons/sentry.png" with { type: "file" };
import settingsActive from "./icons/settings_active.png" with { type: "file" };
import settingsInactive from "./icons/settings_inactive.png" with { type: "file" };

import { imageBytes } from "~/assets/imageBytes";

/**
 * Every nav icon PNG, keyed by its file's base name.
 *
 * The imports are what get the PNGs into a compiled binary — `bun build
 * --compile` embeds a file only when something imports it, so an icon reached
 * by building a path at runtime ships as a broken reference.
 */
const NAV_ICON_PATHS = {
  compass_active: compassActive,
  compass_inactive: compassInactive,
  dashboard_active: dashboardActive,
  dashboard_inactive: dashboardInactive,
  issues_active: issuesActive,
  issues_inactive: issuesInactive,
  monitors_active: monitorsActive,
  monitors_inactive: monitorsInactive,
  seer_active: seerActive,
  seer_inactive: seerInactive,
  sentry: sentry,
  settings_active: settingsActive,
  settings_inactive: settingsInactive,
};

/** Base name of a nav icon PNG, e.g. `issues_active`. */
export type NavIconName = keyof typeof NAV_ICON_PATHS;

/** PNG bytes for a nav icon, ready to hand to OpenTUI's `<image source>`. */
export function navIconBytes(name: NavIconName): Uint8Array {
  return imageBytes(NAV_ICON_PATHS[name]);
}

/** The names {@link navIconBytes} accepts — used by tests to check coverage. */
export const NAV_ICON_NAMES = Object.keys(NAV_ICON_PATHS) as NavIconName[];
