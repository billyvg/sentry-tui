import compassActive from "./icons/compass_active.png" with { type: "file" };
import compassInactive from "./icons/compass_inactive.png" with { type: "file" };
import compassActiveLight from "./icons/compass_active_light.png" with { type: "file" };
import compassInactiveLight from "./icons/compass_inactive_light.png" with { type: "file" };
import dashboardActive from "./icons/dashboard_active.png" with { type: "file" };
import dashboardInactive from "./icons/dashboard_inactive.png" with { type: "file" };
import dashboardActiveLight from "./icons/dashboard_active_light.png" with { type: "file" };
import dashboardInactiveLight from "./icons/dashboard_inactive_light.png" with { type: "file" };
import issuesActive from "./icons/issues_active.png" with { type: "file" };
import issuesInactive from "./icons/issues_inactive.png" with { type: "file" };
import issuesActiveLight from "./icons/issues_active_light.png" with { type: "file" };
import issuesInactiveLight from "./icons/issues_inactive_light.png" with { type: "file" };
import monitorsActive from "./icons/monitors_active.png" with { type: "file" };
import monitorsInactive from "./icons/monitors_inactive.png" with { type: "file" };
import monitorsActiveLight from "./icons/monitors_active_light.png" with { type: "file" };
import monitorsInactiveLight from "./icons/monitors_inactive_light.png" with { type: "file" };
import seerActive from "./icons/seer_active.png" with { type: "file" };
import seerInactive from "./icons/seer_inactive.png" with { type: "file" };
import seerActiveLight from "./icons/seer_active_light.png" with { type: "file" };
import seerInactiveLight from "./icons/seer_inactive_light.png" with { type: "file" };
import sentry from "./icons/sentry.png" with { type: "file" };
import sentryLight from "./icons/sentry_light.png" with { type: "file" };

import { imageBytes } from "~/assets/imageBytes";
import type { ThemeMode } from "~/core/theme";

/**
 * Every nav icon PNG, keyed by its file's base name.
 *
 * The imports are what get the PNGs into a compiled binary — `bun build
 * --compile` embeds a file only when something imports it, so an icon reached
 * by building a path at runtime ships as a broken reference.
 */
const DARK_NAV_ICON_PATHS = {
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
  sentry,
};

/** Base name of a nav icon PNG, e.g. `issues_active`. */
export type NavIconName = keyof typeof DARK_NAV_ICON_PATHS;

const NAV_ICON_PATHS = {
  dark: DARK_NAV_ICON_PATHS,
  light: {
    compass_active: compassActiveLight,
    compass_inactive: compassInactiveLight,
    dashboard_active: dashboardActiveLight,
    dashboard_inactive: dashboardInactiveLight,
    issues_active: issuesActiveLight,
    issues_inactive: issuesInactiveLight,
    monitors_active: monitorsActiveLight,
    monitors_inactive: monitorsInactiveLight,
    seer_active: seerActiveLight,
    seer_inactive: seerInactiveLight,
    sentry: sentryLight,
  },
} as const satisfies Record<ThemeMode, Record<NavIconName, string>>;

/** PNG bytes for a nav icon, ready to hand to OpenTUI's `<image source>`. */
export function navIconBytes(name: NavIconName, mode: ThemeMode = "dark"): Uint8Array {
  return imageBytes(NAV_ICON_PATHS[mode][name]);
}

/** The names {@link navIconBytes} accepts — used by tests to check coverage. */
export const NAV_ICON_NAMES = Object.keys(DARK_NAV_ICON_PATHS) as NavIconName[];
