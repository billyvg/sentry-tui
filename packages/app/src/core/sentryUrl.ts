/**
 * Turn a production Sentry web URL into a destination the terminal app knows.
 *
 * Parsing stays pure: both the CLI and the in-app prompt use the same result,
 * then record and present failures in the way appropriate to their surface.
 */

import { getScreen, type ScreenId } from "~/core/screens";
import { countMetric } from "@sentry-tui/runtime-contract/telemetry";

/** The common page-filter values a copied URL can carry into a screen. */
export interface SentryUrlState {
  query?: string;
  selectedProjects?: string[];
  selectedEnvs?: string[];
  statsPeriod?: string;
  sort?: string;
  /** Columns carried by Explore and Discover result URLs. */
  fields?: string[];
}

/** A resource whose existing TUI detail view should be opened over a screen. */
export type SentryUrlDetail =
  | { kind: "issue"; issueId: string; eventId?: string }
  | { kind: "dashboard"; dashboardId: string }
  | { kind: "replay"; replayId: string }
  | { kind: "monitor"; detectorId: string }
  | { kind: "issue_view"; viewId: string }
  | {
      kind: "saved_query";
      queryId: string;
      source: "explore" | "discover";
      resultScreen: ScreenId;
      dataset?: string;
      title?: string;
    };

/** The complete destination represented by a supported Sentry URL. */
export interface SentryUrlLocation {
  org: string;
  screen: ScreenId;
  state?: SentryUrlState;
  detail?: SentryUrlDetail;
  /** A Seer Explorer run that production can resume in its global drawer. */
  seerRunId?: string | number;
}

export type InvalidSentryUrlReason =
  | "empty"
  | "malformed"
  | "protocol"
  | "host"
  | "organization"
  | "organization_mismatch";

export type UnsupportedSentryUrlFamily =
  | "issues"
  | "explore"
  | "dashboards"
  | "monitors"
  | "settings"
  | "projects"
  | "other";

export type SentryUrlFailure =
  | { kind: "invalid"; reason: InvalidSentryUrlReason; message: string }
  | { kind: "unsupported"; family: UnsupportedSentryUrlFamily; message: string };

export type SentryUrlResult = { kind: "location"; location: SentryUrlLocation } | SentryUrlFailure;

export type SentryUrlSurface = "cli" | "command_palette";

const ORG_SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const NUMERIC_ID = /^\d+$/;
const NON_ORG_SUBDOMAINS = new Set(["www", "us", "eu"]);

const ISSUE_SCREENS: Readonly<Record<string, ScreenId>> = {
  inbox: "issues.inbox",
  "errors-outages": "issues.errors-outages",
  "breached-metrics": "issues.breached-metrics",
  warnings: "issues.warnings",
  "sentry-configuration": "issues.configuration",
  feedback: "issues.user-feedback",
  "user-feedback": "issues.user-feedback",
  alerts: "monitors.alerts",
};

const EXPLORE_SCREENS: Readonly<Record<string, ScreenId>> = {
  traces: "explore.traces",
  logs: "explore.logs",
  metrics: "explore.metrics",
  errors: "explore.errors",
  "errors-v2": "explore.errors",
  profiles: "explore.profiles",
  profiling: "explore.profiles",
  replays: "explore.replays",
  releases: "explore.releases",
  agents: "explore.conversations",
  conversations: "explore.conversations",
  "saved-queries": "explore.all-queries",
};

const MONITOR_SCREENS: Readonly<Record<string, ScreenId>> = {
  "my-monitors": "monitors.mine",
  errors: "monitors.error",
  metrics: "monitors.metric",
  crons: "monitors.cron",
  uptime: "monitors.uptime",
  "mobile-builds": "monitors.mobile-build",
  alerts: "monitors.alerts",
};

/** Parse one pasted production URL without making requests or changing app state. */
export function parseSentryUrl(input: string): SentryUrlResult {
  const raw = input.trim();
  if (!raw) return invalid("empty", "Enter a full Sentry production URL.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid("malformed", "That is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    return invalid("protocol", "Sentry production URLs must use https.");
  }
  if (!isProductionHost(url.hostname)) {
    return invalid("host", "That URL is not hosted on sentry.io.");
  }

  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return invalid("malformed", "The URL path contains invalid escaping.");
  }

  let pathOrg: string | undefined;
  if (segments[0] === "organizations") {
    pathOrg = segments[1];
    segments = segments.slice(2);
  }

  const hostOrg = organizationFromHost(url.hostname);
  if (pathOrg && hostOrg && pathOrg !== hostOrg) {
    return invalid(
      "organization_mismatch",
      "The organizations in the Sentry hostname and URL path do not match.",
    );
  }

  const matched = matchRoute(segments, url.searchParams);
  if (matched.kind === "unsupported") return matched;

  const org = pathOrg ?? hostOrg;
  if (!org || !ORG_SLUG.test(org)) {
    return invalid("organization", "The URL does not identify a Sentry organization.");
  }

  const seerRunId = seerRunIdFrom(url.searchParams);
  return {
    kind: "location",
    location: {
      org,
      ...matched.location,
      ...(seerRunId === undefined ? {} : { screen: "seer.ask" as const }),
      state: stateFrom(url.searchParams),
      ...(seerRunId === undefined ? {} : { seerRunId }),
    },
  };
}

/** Build the canonical production URL for one TUI location. */
export function buildSentryUrl(location: SentryUrlLocation): string {
  const url = new URL(`https://${location.org}.sentry.io`);
  const target = targetFor(location);
  url.pathname = target.pathname;

  applyState(url.searchParams, location.state);
  for (const [key, value] of Object.entries(target.query ?? {})) {
    url.searchParams.set(key, value);
  }
  if (location.seerRunId !== undefined) {
    url.pathname = "/issues/";
    url.searchParams.set("explorerRunId", String(location.seerRunId));
  }
  return url.toString();
}

/** Record an expected URL failure without leaking its path, query, org, or ids. */
export function recordSentryUrlFailure(failure: SentryUrlFailure, surface: SentryUrlSurface): void {
  if (failure.kind === "invalid") {
    countMetric("nav.url.invalid", { surface, reason: failure.reason });
  } else {
    countMetric("nav.url.unsupported", { surface, family: failure.family });
  }
}

function isProductionHost(hostname: string): boolean {
  return hostname === "sentry.io" || hostname.endsWith(".sentry.io");
}

/** Extract the org from the customer-domain form, `{org}.sentry.io`. */
function organizationFromHost(hostname: string): string | undefined {
  const suffix = ".sentry.io";
  if (!hostname.endsWith(suffix)) return undefined;
  const prefix = hostname.slice(0, -suffix.length);
  if (!prefix || prefix.includes(".") || NON_ORG_SUBDOMAINS.has(prefix)) return undefined;
  return prefix;
}

type MatchedRoute =
  | { kind: "matched"; location: Omit<SentryUrlLocation, "org" | "state"> }
  | Extract<SentryUrlFailure, { kind: "unsupported" }>;

function matchRoute(segments: readonly string[], query: URLSearchParams): MatchedRoute {
  const [root, ...rest] = segments;
  if (root === "issues") return matchIssues(rest);
  if (root === "explore") return matchExplore(rest, query);
  if (root === "dashboard" || root === "dashboards") {
    return matchDashboards(root, rest, query);
  }
  if (root === "monitors") return matchMonitors(rest);

  // Current Sentry keeps aliases for these product routes outside Explore.
  if (root === "traces") return topLevel("explore.traces", rest, "explore");
  if (root === "logs") return topLevel("explore.logs", rest, "explore");
  if (root === "profiling") return topLevel("explore.profiles", rest, "explore");
  if (root === "replays") return matchReplayAlias(rest);
  if (root === "releases") return topLevel("explore.releases", rest, "explore");
  if (root === "discover") return matchLegacyDiscover(rest, query);
  if (root === "errors-v2") return topLevel("explore.errors", rest, "explore");
  if (root === "feedback" && rest.length === 0) return matched("issues.user-feedback");

  const family: UnsupportedSentryUrlFamily =
    root === "settings" ? "settings" : root === "projects" ? "projects" : "other";
  return unsupported(family);
}

function matchIssues(rest: readonly string[]): MatchedRoute {
  if (rest.length === 0) return matched("issues.feed");

  const screen = ISSUE_SCREENS[rest[0]!];
  if (screen && rest.length === 1) return matched(screen);
  if (rest[0] === "views" && rest.length === 1) return matched("issues.all-views");
  if (rest[0] === "views" && rest[1] && rest.length === 2) {
    return matched("issues.all-views", { kind: "issue_view", viewId: rest[1] });
  }
  if (rest[0] === "autofix" && rest.length === 1) return matched("seer.ask");
  if (rest[0] === "autofix" && rest[1] === "recent" && rest.length === 2) {
    return matched("issues.recently-run");
  }

  const issueId = rest[0];
  if (issueId && NUMERIC_ID.test(issueId)) {
    if (rest.length === 1) {
      return matched("issues.feed", { kind: "issue", issueId });
    }
    if (rest[1] === "events" && rest[2] && rest.length === 3) {
      return matched("issues.feed", { kind: "issue", issueId, eventId: rest[2] });
    }
  }

  return unsupported("issues");
}

function matchExplore(rest: readonly string[], query: URLSearchParams): MatchedRoute {
  const product = rest[0];
  if (!product) return unsupported("explore");

  if (product === "replays") {
    if (rest.length === 1) return matched("explore.replays");
    if (rest.length === 2 && rest[1]) {
      return matched("explore.replays", { kind: "replay", replayId: rest[1] });
    }
    return unsupported("explore");
  }

  if (product === "discover") {
    if (rest.length === 1 || (rest.length === 2 && ["homepage", "queries"].includes(rest[1]!))) {
      return matched("explore.discover");
    }
    if (rest.length === 2 && rest[1] === "results") {
      const screen = discoverScreen(query.get("dataset"));
      return screen ? matched(screen) : unsupported("explore");
    }
    return unsupported("explore");
  }

  const screen = EXPLORE_SCREENS[product];
  if (!screen || rest.length !== 1) return unsupported("explore");
  const queryId = query.get("id");
  return queryId
    ? matched(screen, {
        kind: "saved_query",
        queryId,
        source: "explore",
        resultScreen: screen,
        dataset: query.get("dataset") ?? undefined,
        title: query.get("title") ?? undefined,
      })
    : matched(screen);
}

function matchLegacyDiscover(rest: readonly string[], query: URLSearchParams): MatchedRoute {
  if (rest.length === 0) return matched("explore.discover");
  if (rest.length !== 1 || rest[0] !== "results") return unsupported("explore");
  const queryId = query.get("id");
  return queryId
    ? matched("explore.discover", {
        kind: "saved_query",
        queryId,
        source: "discover",
        resultScreen: "explore.discover",
        dataset: query.get("dataset") ?? undefined,
        title: query.get("title") ?? undefined,
      })
    : matched("explore.discover");
}

function discoverScreen(dataset: string | null): ScreenId | undefined {
  switch (dataset?.toLowerCase()) {
    case "spans":
      return "explore.traces";
    case "logs":
      return "explore.logs";
    case "metrics":
    case "tracemetrics":
      return "explore.metrics";
    case "errors":
    case "issueplatform":
      return "explore.errors";
    default:
      return undefined;
  }
}

function matchDashboards(
  root: string,
  rest: readonly string[],
  query: URLSearchParams,
): MatchedRoute {
  if (root === "dashboards" && rest.length === 0) {
    return matched(
      query.get("filter") === "onlyPrebuilt" ? "dashboards.sentry-built" : "dashboards.all",
    );
  }
  if (rest.length === 1 && rest[0]) {
    return matched("dashboards.all", { kind: "dashboard", dashboardId: rest[0] });
  }
  return unsupported("dashboards");
}

function matchMonitors(rest: readonly string[]): MatchedRoute {
  if (rest.length === 0) return matched("monitors.all");
  const screen = MONITOR_SCREENS[rest[0]!];
  if (screen && rest.length === 1) return matched(screen);
  if (rest.length === 1 && rest[0] && NUMERIC_ID.test(rest[0])) {
    return matched("monitors.all", { kind: "monitor", detectorId: rest[0] });
  }
  return unsupported("monitors");
}

function matchReplayAlias(rest: readonly string[]): MatchedRoute {
  if (rest.length === 0) return matched("explore.replays");
  if (rest.length === 1 && rest[0]) {
    return matched("explore.replays", { kind: "replay", replayId: rest[0] });
  }
  return unsupported("explore");
}

function topLevel(
  screen: ScreenId,
  rest: readonly string[],
  family: UnsupportedSentryUrlFamily,
): MatchedRoute {
  return rest.length === 0 ? matched(screen) : unsupported(family);
}

function matched(screen: ScreenId, detail?: SentryUrlDetail): MatchedRoute {
  return { kind: "matched", location: { screen, detail } };
}

function stateFrom(query: URLSearchParams): SentryUrlState | undefined {
  const value: SentryUrlState = {};
  const search = query.get("query");
  const statsPeriod = query.get("statsPeriod");
  const sort = query.get("sort");
  const projects = query.getAll("project").filter(Boolean);
  const environments = query.getAll("environment").filter(Boolean);
  const fields = query.getAll("field").filter(Boolean);

  if (search !== null) value.query = search;
  if (statsPeriod) value.statsPeriod = statsPeriod;
  if (sort) value.sort = sort;
  if (projects.length > 0) value.selectedProjects = projects;
  if (environments.length > 0) value.selectedEnvs = environments;
  if (fields.length > 0) value.fields = fields;
  return Object.keys(value).length > 0 ? value : undefined;
}

function seerRunIdFrom(query: URLSearchParams): string | number | undefined {
  const value = query.get("explorerRunId");
  if (!value) return undefined;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function targetFor(location: SentryUrlLocation): {
  pathname: `/${string}`;
  query?: Readonly<Record<string, string>>;
} {
  const detail = location.detail;
  if (!detail) return getScreen(location.screen).production;

  switch (detail.kind) {
    case "issue":
      return {
        pathname: detail.eventId
          ? `/issues/${encodeURIComponent(detail.issueId)}/events/${encodeURIComponent(detail.eventId)}/`
          : `/issues/${encodeURIComponent(detail.issueId)}/`,
      };
    case "dashboard":
      return { pathname: `/dashboard/${encodeURIComponent(detail.dashboardId)}/` };
    case "replay":
      return { pathname: `/explore/replays/${encodeURIComponent(detail.replayId)}/` };
    case "monitor":
      return { pathname: `/monitors/${encodeURIComponent(detail.detectorId)}/` };
    case "issue_view":
      return { pathname: `/issues/views/${encodeURIComponent(detail.viewId)}/` };
    case "saved_query":
      return {
        ...(detail.source === "discover"
          ? ({ pathname: "/discover/results/" } as const)
          : getScreen(detail.resultScreen).production),
        query: {
          id: detail.queryId,
          ...(detail.dataset ? { dataset: detail.dataset } : {}),
          ...(detail.title ? { title: detail.title } : {}),
        },
      };
  }
}

function applyState(query: URLSearchParams, state: SentryUrlState | undefined): void {
  if (!state) return;
  if (state.query !== undefined) query.set("query", state.query);
  if (state.statsPeriod) query.set("statsPeriod", state.statsPeriod);
  if (state.sort) query.set("sort", state.sort);
  for (const project of state.selectedProjects ?? []) query.append("project", project);
  for (const environment of state.selectedEnvs ?? []) query.append("environment", environment);
  for (const field of state.fields ?? []) query.append("field", field);
}

function invalid(reason: InvalidSentryUrlReason, message: string): SentryUrlFailure {
  return { kind: "invalid", reason, message };
}

function unsupported(
  family: UnsupportedSentryUrlFamily,
): Extract<SentryUrlFailure, { kind: "unsupported" }> {
  return {
    kind: "unsupported",
    family,
    message: "That Sentry page is not implemented in sentry-tui yet.",
  };
}
