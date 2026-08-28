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

import { DEFAULT_STATS_PERIOD } from "~/api/issues";
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
  | "monitors.alerts";

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
  sort?: string;
}

export interface ScreenDef {
  id: ScreenId;
  group: NavGroupId;
  /** Matches the nav label in `nav.ts` exactly — that is the join key. */
  item: string;
  kind: ScreenKind;
  /** Canonical sentry.io destination for this screen. */
  production: ScreenProductionLocation;
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

/** The path and fixed query values for one screen in production Sentry. */
export interface ScreenProductionLocation {
  pathname: `/${string}`;
  query?: Readonly<Record<string, string>>;
}

/**
 * Canonical production destination for every registered screen.
 *
 * This exhaustive record makes the web escape hatch part of the screen
 * contract: adding a TUI screen without somewhere useful to continue on
 * sentry.io is a type error.
 */
const SCREEN_PRODUCTION_LOCATIONS: Readonly<Record<ScreenId, ScreenProductionLocation>> = {
  "issues.feed": { pathname: "/issues/" },
  "issues.inbox": { pathname: "/issues/inbox/" },
  "issues.errors-outages": { pathname: "/issues/errors-outages/" },
  "issues.breached-metrics": { pathname: "/issues/breached-metrics/" },
  "issues.warnings": { pathname: "/issues/warnings/" },
  "issues.configuration": { pathname: "/issues/sentry-configuration/" },
  "issues.user-feedback": { pathname: "/issues/feedback/" },
  "issues.recently-run": { pathname: "/issues/autofix/recent/" },
  "issues.all-views": { pathname: "/issues/views/" },
  "explore.traces": { pathname: "/explore/traces/" },
  "explore.logs": { pathname: "/explore/logs/" },
  "explore.metrics": { pathname: "/explore/metrics/" },
  "explore.errors": { pathname: "/explore/errors-v2/" },
  "explore.discover": { pathname: "/explore/discover/homepage/" },
  "explore.profiles": { pathname: "/explore/profiles/" },
  "explore.replays": { pathname: "/explore/replays/" },
  "explore.releases": { pathname: "/explore/releases/" },
  "explore.conversations": { pathname: "/explore/agents/" },
  "explore.all-queries": { pathname: "/explore/saved-queries/" },
  "dashboards.all": { pathname: "/dashboards/" },
  "dashboards.sentry-built": {
    pathname: "/dashboards/",
    query: { filter: "onlyPrebuilt", sort: "mostPopular" },
  },
  "monitors.all": { pathname: "/monitors/" },
  "monitors.mine": { pathname: "/monitors/my-monitors/" },
  "monitors.error": { pathname: "/monitors/errors/" },
  "monitors.metric": { pathname: "/monitors/metrics/" },
  "monitors.cron": { pathname: "/monitors/crons/" },
  "monitors.uptime": { pathname: "/monitors/uptime/" },
  "monitors.mobile-build": { pathname: "/monitors/mobile-builds/" },
  "monitors.alerts": { pathname: "/monitors/alerts/" },
  // Ask Seer is a global production drawer rather than a standalone route.
  // Autofix is the useful Seer landing page before a run id exists; once one
  // does, buildSentryUrl deep-links it from /issues/ with explorerRunId.
  "seer.ask": { pathname: "/issues/autofix/" },
};

/** The Discover-style Explore screens whose query filters follow the user. */
const EXPLORE_DISCOVER = "explore.events";
/** The seven Monitors screens that are the detector table with a `type:` filter. */
const MONITOR_DETECTORS = "monitors.detectors";
/** The slice a saved view's results are shown in, pushed from All Views. */
export const SAVED_VIEW_STATE_KEY = "issues.saved-view";
/** The slice a replay's detail is shown in, pushed from the replay index. */
export const REPLAY_DETAIL_STATE_KEY = "explore.replay-detail";
/** Both Dashboards destinations are the same list with a different filter. */
const DASHBOARD_LIST = "dashboards.list";
/**
 * The slice a dashboard's widget grid is shown in, pushed from either list.
 *
 * One key for the kind of view rather than one per dashboard: the grid's
 * cursor and page filters are what it holds, and reopening a dashboard should
 * reuse that slice rather than leak one per row.
 */
export const DASHBOARD_DETAIL_STATE_KEY = "dashboards.detail";

/**
 * Filters the Discover-backed Explore tables start on.
 *
 * One period for all six, deliberately. The web pins Conversations to 24h
 * "to avoid slow loads"
 * (`views/navigation/secondary/sections/explore/exploreSecondaryNavigation.tsx:143`)
 * — a *narrowing* of Sentry's 14d default, not a widening — and 1h is narrower
 * still, so the shared value already satisfies the constraint that pin exists
 * to enforce. Since the six share a slice, the default only applies to the
 * first Explore screen opened in a session; after that the period follows the
 * user across them, which is what the web's pin is trying to approximate.
 *
 * A per-screen period would mean dropping that screen out of the shared key
 * (`nav-coverage.test.ts` requires screens on one key to declare identical
 * defaults), and losing filter continuity across Explore is a worse trade than
 * a first paint that may need `D` to widen.
 */
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
    production: SCREEN_PRODUCTION_LOCATIONS[ISSUE_VIEW_IDS[view.label]!],
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

  // Explore — the Discover-backed tables share filters; screens that hit
  // their own endpoints keep their own.
  exploreTable("explore.traces", "Traces"),
  logsScreen(),
  exploreTable("explore.metrics", "Metrics"),
  exploreTable("explore.errors", "Errors"),
  profilesScreen(),
  releasesScreen(),
  // Replays has its own endpoint and its own columns, so it keeps its own
  // slice rather than joining the Discover screens' shared one.
  s("explore.replays", "explore", "Replays", "table", undefined, REPLAY_DEFAULTS),
  exploreTable("explore.conversations", "Conversations"),
  // Discover and All Queries are saved-query *lists*, not Discover queries:
  // they read `discover/saved/` and `explore/saved/`, so they keep their own
  // slice — the shared Explore filters mean nothing to a list of queries.
  s("explore.discover", "explore", "Discover", "table"),
  s("explore.all-queries", "explore", "All Queries", "table"),

  s("dashboards.all", "dashboards", "All Dashboards", "table", DASHBOARD_LIST),
  s("dashboards.sentry-built", "dashboards", "Sentry Built", "table", DASHBOARD_LIST),

  // Monitors — six of the seven are one detector table with a different
  // `type:` filter, so the user's own filters follow them across.
  s("monitors.all", "monitors", "All Monitors", "table", MONITOR_DETECTORS),
  s("monitors.mine", "monitors", "My Monitors", "table", MONITOR_DETECTORS),
  s("monitors.error", "monitors", "Error", "table", MONITOR_DETECTORS),
  s("monitors.metric", "monitors", "Metric", "table", MONITOR_DETECTORS),
  s("monitors.cron", "monitors", "Cron", "table", MONITOR_DETECTORS),
  s("monitors.uptime", "monitors", "Uptime", "table", MONITOR_DETECTORS),
  s("monitors.mobile-build", "monitors", "Mobile Build", "table", MONITOR_DETECTORS),
  s("monitors.alerts", "monitors", "Alerts", "table"),

  s("seer.ask", "seer", "Ask Seer", "chat"),
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
 * That is why it keeps its own slice rather than joining `explore.events`.
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

/**
 * An Explore list that shares the Discover-style filter slice and opens an inline
 * panel rather than a view.
 *
 * Three of these are the Discover tables configured in
 * `core/exploreTables.ts`; Conversations is not one — its rows come
 * pre-aggregated from `/ai-conversations/` (`core/conversations.ts`) — but it
 * takes the same filters and the same Enter, so it registers the same way.
 * Only what the *registry* owns is set here.
 */
function exploreTable(id: ScreenId, item: string): ScreenDef {
  return {
    ...s(id, "explore", item, "table", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),
    openLabel: "details",
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
  return {
    id,
    group,
    item,
    kind,
    production: SCREEN_PRODUCTION_LOCATIONS[id],
    stateKey,
    defaults,
  };
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
