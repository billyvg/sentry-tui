/**
 * The seven Monitors list screens, as data.
 *
 * All seven are one table over `GET /organizations/{org}/detectors/`; what
 * distinguishes them is the filter their query carries. So they are one
 * component plus this table, keyed by `ScreenId` — the pattern
 * `core/issueViews.ts` set and `docs/screen-contract.md` describes
 * for — and the base filter lives here rather than in screen state, because
 * all seven *share* a state slice (`MONITOR_DETECTORS`) and the user's own
 * query has to follow them across it.
 *
 * The query is assembled the way `createDetectorQuery` assembles it
 * (`views/detectors/hooks/index.ts:50-64`) plus the assignee filter
 * `useDetectorListQuery` adds (`list/common/useDetectorListQuery.tsx:30-35`).
 */

import { DETECTOR_TYPE, type DetectorType } from "~/api/detectors";
import type { ScreenId } from "~/core/screens";

/** Everything that distinguishes one Monitors screen from its six siblings. */
export interface MonitorListView {
  /** Heading above the table. */
  title: string;
  /** One line of context under the heading. */
  description: string;
  /**
   * The detector type this screen lists, e.g. `DETECTOR_TYPE.metric`. Absent on All
   * Monitors and My Monitors, which list every type.
   */
  type?: DetectorType;
  /**
   * The assignee filter this screen adds, as the search value — `[me,my_teams]`
   * on My Monitors (`list/myMonitors.tsx:12`).
   */
  assignee?: string;
  /** Placeholder for the screen's search input. */
  searchPlaceholder: string;
  /** Headline for the empty state. */
  emptyTitle: string;
  /**
   * Lines under that headline. Org feature flags are invisible to this client,
   * so an empty list is at least as likely to mean "this org doesn't have the
   * feature" as "there is nothing here" — both have to be said out loud, and
   * the feature has to be *named*, since "no results" tells nobody anything.
   */
  emptyLines: readonly string[];
}

/**
 * Detectors of this type are internal plumbing — one per project, used to
 * connect alerts to the issue stream — and are excluded from every list
 * (`createDetectorQuery`, `hooks/index.ts:53-55`).
 */
export const EXCLUDED_DETECTOR_TYPE = DETECTOR_TYPE.issueStream;

/** Every Monitors list screen, keyed by the id `SCREENS` registers it under. */
export const MONITOR_LIST_VIEWS: Readonly<Partial<Record<ScreenId, MonitorListView>>> = {
  "monitors.all": {
    title: "All Monitors",
    description: "Everything watching this organization.",
    searchPlaceholder: "Search monitors by name, type or assignee…",
    emptyTitle: "No monitors found.",
    emptyLines: [
      "This organization may not have monitors (the workflow engine) enabled.",
      "Otherwise nothing is being monitored yet — create a monitor on sentry.io, as this client is read-only.",
    ],
  },
  "monitors.mine": {
    title: "My Monitors",
    description: "Monitors assigned to you or your teams.",
    assignee: "[me,my_teams]",
    searchPlaceholder: "Search your monitors…",
    emptyTitle: "No monitors assigned to you.",
    emptyLines: [
      "This organization may not have monitors (the workflow engine) enabled.",
      "Otherwise nothing here is assigned to you or to a team you are on.",
    ],
  },
  "monitors.error": {
    title: "Error",
    description: "The per-project detectors that turn errors into issues.",
    type: DETECTOR_TYPE.error,
    searchPlaceholder: "Search error monitors…",
    emptyTitle: "No error monitors found.",
    emptyLines: [
      "This organization may not have monitors (the workflow engine) enabled.",
      "Error monitors are created by Sentry, one per project — an org with projects should have some.",
    ],
  },
  "monitors.metric": {
    title: "Metric",
    description: "Thresholds and anomalies over a metric.",
    type: DETECTOR_TYPE.metric,
    searchPlaceholder: "Search metric monitors…",
    emptyTitle: "No metric monitors found.",
    emptyLines: [
      "This organization may not have monitors (the workflow engine) enabled.",
      "Otherwise no metric monitor has been created yet.",
    ],
  },
  "monitors.cron": {
    title: "Cron",
    description: "Scheduled jobs that check in when they run.",
    type: DETECTOR_TYPE.cron,
    searchPlaceholder: "Search cron monitors…",
    emptyTitle: "No cron monitors found.",
    emptyLines: [
      "This organization may not have crons enabled.",
      "Otherwise no job is checking in yet — a cron monitor is created by its first check-in.",
    ],
  },
  "monitors.uptime": {
    title: "Uptime",
    description: "URLs Sentry checks on a schedule.",
    type: DETECTOR_TYPE.uptime,
    searchPlaceholder: "Search uptime monitors…",
    emptyTitle: "No uptime monitors found.",
    emptyLines: [
      "This organization may not have uptime monitoring enabled.",
      "Otherwise no URL is being checked yet.",
    ],
  },
  "monitors.mobile-build": {
    title: "Mobile Build",
    description: "Size regressions in mobile builds.",
    type: DETECTOR_TYPE.mobileBuild,
    searchPlaceholder: "Search mobile build monitors…",
    emptyTitle: "No mobile build monitors found.",
    emptyLines: [
      "This organization may not have build size analysis (preprod) enabled.",
      "Otherwise no build size monitor has been created yet.",
    ],
  },
};

/** The list configuration for a screen, or `undefined` if it isn't one. */
export function getMonitorListView(id: ScreenId): MonitorListView | undefined {
  return MONITOR_LIST_VIEWS[id];
}

/**
 * The query one screen sends, given whatever the user typed.
 *
 * Order matches `createDetectorQuery`: the issue-stream exclusion, then the
 * screen's own filters, then the user's query — so a typed `type:cron` narrows
 * within the screen rather than being overridden by it.
 */
export function buildDetectorQuery(
  view: MonitorListView | undefined,
  userQuery = "",
): string | undefined {
  const parts = [`!type:${EXCLUDED_DETECTOR_TYPE}`];
  if (view?.type) parts.push(`type:${view.type}`);
  if (view?.assignee) parts.push(`assignee:${view.assignee}`);
  const trimmed = userQuery.trim();
  if (trimmed) parts.push(trimmed);
  return parts.join(" ");
}
