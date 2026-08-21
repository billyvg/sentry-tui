/**
 * The screen registry — one entry per nav destination.
 *
 * `nav.ts` says what the sidebar offers; this says what each of those entries
 * *is*. Routing reads `screenFor(group, item).id` instead of a pile of
 * `showX` booleans, so adding a screen is a registry edit plus a component,
 * not a new branch in `App`.
 *
 * Every nav item must be registered, including the ones nobody has built yet:
 * those carry `kind: "stub"` and render the placeholder pane.
 * `scripts/nav-coverage.test.ts` fails if the two files drift apart.
 */

import { DEFAULT_STATS_PERIOD, type SortOption } from "~/api/issues";
import { DEFAULT_LOG_PERIOD } from "~/api/logs";
import { DEFAULT_RELEASE_PERIOD } from "~/api/releases";
import { DEFAULT_REPLAY_PERIOD } from "~/api/replays";
import { ALL_VIEWS_LABEL, ISSUE_VIEWS } from "~/core/issueViews";
import { NAV_GROUPS, type NavGroupId } from "~/core/nav";

/**
 * Stable identifier for a screen, `{group}.{slug}`.
 *
 * Ids are permanent: they key persisted screen state, the component map, and
 * the contract doc. Renaming one is a breaking change for all three.
 */
export type ScreenId =
  | "issues.feed"
  | "issues.inbox"
  | "issues.errors-outages"
  | "issues.breached-metrics"
  | "issues.warnings"
  | "issues.configuration"
  | "issues.user-feedback"
  | "issues.recently-run"
  | "issues.all-views"
  | "explore.traces"
  | "explore.logs"
  | "seer.ask"
  | "explore.metrics"
  | "explore.errors"
  | "explore.discover"
  | "explore.profiles"
  | "explore.replays"
  | "explore.releases"
  | "explore.conversations"
  | "explore.all-queries"
  | "dashboards.all"
  | "dashboards.sentry-built"
  | "monitors.all"
  | "monitors.mine"
  | "monitors.error"
  | "monitors.metric"
  | "monitors.cron"
  | "monitors.uptime"
  | "monitors.mobile-build"
  | "monitors.alerts"
  | "settings.organization"
  | "settings.projects"
  | "settings.teams";

/**
 * The shape a screen renders in. Descriptive, not aspirational: a screen that
 * hasn't been built is `"stub"` whatever it will eventually become.
 */
export type ScreenKind = "table" | "cards" | "grid" | "chat" | "stub";

/** Filter values a screen starts with, before the user touches anything. */
export interface ScreenDefaults {
  /** Initial search query. */
  query?: string;
  /** Initial stats period, e.g. `"14d"`. */
  statsPeriod?: string;
  /** Initial sort. */
  sort?: SortOption;
}

export interface ScreenDef {
  id: ScreenId;
  group: NavGroupId;
  /** Matches the nav label in `nav.ts` exactly — that is the join key. */
  item: string;
  kind: ScreenKind;
  /**
   * Screens sharing a `stateKey` share one slice of screen state: filters,
   * cursor, and scroll offset carry across them. Defaults to the screen's own
   * `id`, i.e. no sharing.
   */
  stateKey?: string;
  /**
   * Starting filter values. When screens share a `stateKey`, the defaults of
   * the first one in `SCREENS` order win — see `defaultsForStateKey`.
   */
  defaults?: ScreenDefaults;
  /**
   * What Enter does here, for the status-bar hint. Defaults to `"open"`; the
   * log stream says `"details"`, because Enter opens a panel rather than a
   * view. The bar prints `"close"` instead whenever the panel is open.
   */
  openLabel?: string;
}

/** Every Explore screen backed by the Discover `events/` endpoint shares filters. */
const EXPLORE_DISCOVER = "explore.discover";
/** The seven Monitors screens that are the detector table with a `type:` filter. */
const MONITOR_DETECTORS = "monitors.detectors";
/** The slice a saved view's results are shown in, pushed from All Views. */
export const SAVED_VIEW_STATE_KEY = "issues.saved-view";
/** The slice a replay's detail is shown in, pushed from the replay index. */
export const REPLAY_DETAIL_STATE_KEY = "explore.replay-detail";
/** Both Dashboards destinations are the same list with a different filter. */
const DASHBOARD_LIST = "dashboards.list";

/** Filters the Discover-backed Explore tables start on. */
const DISCOVER_DEFAULTS: ScreenDefaults = { query: "", statsPeriod: DEFAULT_LOG_PERIOD };

/**
 * Replays opens on Sentry's standard page-filter window rather than the hour
 * the Discover tables use: a session is a rarer event than a log line, and an
 * hour of them is usually an empty table.
 */
const REPLAY_DEFAULTS: ScreenDefaults = { query: "", statsPeriod: DEFAULT_REPLAY_PERIOD };

/** The screen each Issues view renders in. */
const ISSUE_VIEW_IDS: Record<string, ScreenId> = {
  Feed: "issues.feed",
  Inbox: "issues.inbox",
  "Errors & Outages": "issues.errors-outages",
  "Breached Metrics": "issues.breached-metrics",
  Warnings: "issues.warnings",
  Configuration: "issues.configuration",
  "User Feedback": "issues.user-feedback",
  "Recently Run": "issues.recently-run",
};

/**
 * Issues, built from the views themselves rather than restated here:
 * `core/issueViews.ts` owns the queries, and every item is the same list with
 * a different one. They get a slice each — the query is what distinguishes
 * them, so sharing one would collapse them all into whichever was opened last.
 */
const ISSUE_SCREENS: readonly ScreenDef[] = [
  ...ISSUE_VIEWS.map((view): ScreenDef => ({
    id: ISSUE_VIEW_IDS[view.label]!,
    group: "issues",
    item: view.label,
    kind: "table",
    defaults: { query: view.query, sort: view.sort, statsPeriod: DEFAULT_STATS_PERIOD },
  })),
  // The one Issues item that isn't a query: a list of saved searches.
  s("issues.all-views", "issues", ALL_VIEWS_LABEL, "table"),
];
/**
 * Every screen the app knows about, in nav order.
 *
 * Building a screen means changing its `kind` here and adding one line to
 * `SCREEN_COMPONENTS` in `src/ui/screens/registry.tsx` — nothing else.
 */
export const SCREENS: readonly ScreenDef[] = [
  ...ISSUE_SCREENS,

  // Explore — the Discover-backed tables share filters; the three that hit
  // their own endpoints keep their own.
  s("explore.traces", "explore", "Traces", "stub", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),
  logsScreen(),
  s("explore.metrics", "explore", "Metrics", "stub", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),
  s("explore.errors", "explore", "Errors", "stub", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),
  s("explore.discover", "explore", "Discover", "stub", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),
  profilesScreen(),
  s(
    "explore.conversations",
    "explore",
    "Conversations",
    "stub",
    EXPLORE_DISCOVER,
    DISCOVER_DEFAULTS,
  ),
  releasesScreen(),
  // Replays has its own endpoint and its own columns, so it keeps its own
  // slice rather than joining the Discover screens' shared one.
  s("explore.replays", "explore", "Replays", "table", undefined, REPLAY_DEFAULTS),
  s("explore.all-queries", "explore", "All Queries", "stub"),

  s("dashboards.all", "dashboards", "All Dashboards", "stub", DASHBOARD_LIST),
  s("dashboards.sentry-built", "dashboards", "Sentry Built", "stub", DASHBOARD_LIST),

  // Monitors — six of the seven are one detector table with a different
  // `type:` filter, so the user's own filters follow them across.
  s("monitors.all", "monitors", "All Monitors", "stub", MONITOR_DETECTORS),
  s("monitors.mine", "monitors", "My Monitors", "stub", MONITOR_DETECTORS),
  s("monitors.error", "monitors", "Error", "stub", MONITOR_DETECTORS),
  s("monitors.metric", "monitors", "Metric", "stub", MONITOR_DETECTORS),
  s("monitors.cron", "monitors", "Cron", "stub", MONITOR_DETECTORS),
  s("monitors.uptime", "monitors", "Uptime", "stub", MONITOR_DETECTORS),
  s("monitors.mobile-build", "monitors", "Mobile Build", "stub", MONITOR_DETECTORS),
  s("monitors.alerts", "monitors", "Alerts", "stub"),

  s("seer.ask", "seer", "Ask Seer", "chat"),

  s("settings.organization", "settings", "Organization", "stub"),
  s("settings.projects", "settings", "Projects", "stub"),
  s("settings.teams", "settings", "Teams", "stub"),
];

/** Logs is the one screen whose Enter opens a panel rather than a view. */
function logsScreen(): ScreenDef {
  return {
    ...s("explore.logs", "explore", "Logs", "table", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),
    openLabel: "details",
  };
}

/** Profiles opens an inline panel too — a mangled symbol needs the room. */
function profilesScreen(): ScreenDef {
  return {
    ...s("explore.profiles", "explore", "Profiles", "table", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),
    openLabel: "details",
  };
}

/**
 * Releases is the one Explore screen that isn't a table, and the one whose
 * period must be long: `statsPeriod` filters the list by release date, so the
 * hour the Discover screens share would hide every release but this morning's.
 * That is why it keeps its own slice rather than joining `explore.discover`.
 * Enter expands the card under the cursor to its remaining projects.
 */
function releasesScreen(): ScreenDef {
  return {
    ...s("explore.releases", "explore", "Releases", "cards", undefined, {
      query: "",
      statsPeriod: DEFAULT_RELEASE_PERIOD,
    }),
    openLabel: "expand",
  };
}

/** Terse constructor so the table above reads as a table. */
function s(
  id: ScreenId,
  group: NavGroupId,
  item: string,
  kind: ScreenKind,
  stateKey?: string,
  defaults?: ScreenDefaults,
): ScreenDef {
  return { id, group, item, kind, stateKey, defaults };
}

const BY_ROUTE = new Map<string, ScreenDef>(
  SCREENS.map((screen) => [routeKey(screen.group, screen.item), screen]),
);

const BY_ID = new Map<ScreenId, ScreenDef>(SCREENS.map((screen) => [screen.id, screen]));

function routeKey(group: NavGroupId, item: string): string {
  return `${group}::${item}`;
}

/**
 * The screen at a nav destination, or `undefined` when nothing is registered.
 *
 * Use this for destinations that may not be in the registry at all — a dynamic
 * nav section's item, say. For a static nav item, prefer `screenFor`.
 */
export function findScreen(group: NavGroupId, item: string): ScreenDef | undefined {
  return BY_ROUTE.get(routeKey(group, item));
}

/**
 * The screen at a nav destination.
 *
 * Throws for an unregistered destination, the same way `getNavGroup` does for
 * an unknown group: every static nav item is registered, and
 * `scripts/nav-coverage.test.ts` is what keeps that true.
 */
export function screenFor(group: NavGroupId, item: string): ScreenDef {
  const screen = findScreen(group, item);
  if (!screen) throw new Error(`No screen registered for ${group} › ${item}`);
  return screen;
}

export function getScreen(id: ScreenId): ScreenDef {
  const screen = BY_ID.get(id);
  if (!screen) throw new Error(`Unknown screen id: ${id}`);
  return screen;
}

/** The key a screen's state is stored under — its `stateKey`, else its id. */
export function stateKeyOf(screen: ScreenDef): string {
  return screen.stateKey ?? screen.id;
}

/**
 * Starting filters for a state key.
 *
 * Resolved from the first screen in `SCREENS` order that uses the key, so a
 * shared slice starts the same way no matter which of its screens is opened
 * first. Screens sharing a key should therefore declare identical defaults.
 */
export function defaultsForStateKey(key: string): ScreenDefaults {
  return SCREENS.find((screen) => stateKeyOf(screen) === key)?.defaults ?? {};
}

/** Every nav destination, flattened — the domain `screenFor` must cover. */
export function navDestinations(): Array<{ group: NavGroupId; item: string }> {
  return NAV_GROUPS.flatMap((group) =>
    group.sections.flatMap((section) => section.items.map((item) => ({ group: group.id, item }))),
  );
}
