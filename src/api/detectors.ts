/**
 * Detectors — the "monitors" the Monitors group is a list of.
 *
 * `GET /organizations/{org}/detectors/` (`views/detectors/hooks/index.ts:84`)
 * backs all seven list screens; they differ only by the `type:` filter their
 * query carries, which `core/monitors.ts` owns. The endpoint is a normal
 * search endpoint: `query` in Sentry's issue-search syntax (`name`, `type`,
 * `assignee`, `workflow` and free text — `organization_detector_index.py:73`),
 * `sortBy`, `project`, `per_page`, `cursor`.
 *
 * The shapes below mirror `types/workflowEngine/detectors.tsx` field for
 * field, with two deliberate differences:
 *
 * - **One `Detector` interface, not a discriminated union.** The web's union
 *   is closed over six types; this client has to render a type it has never
 *   heard of without failing to type-check, the same way `WidgetDisplayType`
 *   in `api/dashboards.ts` stays open. What the union bought — knowing which
 *   `dataSources[0]` you have — is bought instead by the narrowing helpers in
 *   `core/detectors.ts`.
 * - **Everything a row does not need is optional.** A response missing a
 *   `config` or a `queryObj` should cost the row its detail line, not take the
 *   screen down.
 *
 * Read-only: nothing here enables, disables, or deletes a detector.
 */

import type { Page, SentryClient } from "~/api/client";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * What a detector detects — `DetectorType` in
 * `types/workflowEngine/detectors.tsx:84-90`.
 *
 * Left open (`string & {}`) because Sentry ships detector types faster than a
 * terminal learns to draw them: an unknown one must render its name and its
 * project rather than fail to compile.
 */
export type DetectorType =
  | "error"
  | "metric_issue"
  | "monitor_check_in_failure"
  | "uptime_domain_failure"
  | "issue_stream"
  | "preprod_size_analysis"
  | (string & {});

/** A user or team, as `Actor` in `types/core.tsx:27-32`. */
export interface DetectorActor {
  id?: string;
  name?: string;
  type?: "user" | "team" | (string & {});
  email?: string;
}

/**
 * The most recent issue a detector opened — `SimpleGroup` in
 * `types/group.tsx:1313-1328`, minus the fields a two-line row has no room
 * for.
 */
export interface DetectorGroup {
  id: string;
  title?: string;
  culprit?: string | null;
  shortId?: string;
  lastSeen?: string;
  level?: string;
  project?: { id?: string; slug?: string; platform?: string | null };
}

/** A metric detector's Snuba query — `SnubaQuery` in `detectors.tsx:29-42`. */
export interface SnubaQuery {
  id?: string;
  /** e.g. `p95(span.duration)`; the aggregate the threshold is compared to. */
  aggregate: string;
  dataset?: string;
  /** The search query the aggregate is computed over. */
  query?: string;
  /** Window the aggregate covers, in seconds. */
  timeWindow?: number;
  environment?: string | null;
  eventTypes?: string[];
}

/** `SnubaQueryDataSource` — `detectors.tsx:52-62`. */
export interface SnubaQueryDataSource {
  id: string;
  type: "snuba_query_subscription";
  queryObj?: { id?: string; snubaQuery?: SnubaQuery; status?: number } | null;
}

/** `UptimeSubscriptionDataSource` — `detectors.tsx:64-79`. */
export interface UptimeSubscriptionDataSource {
  id: string;
  type: "uptime_subscription";
  queryObj?: {
    url: string;
    /** How often the URL is checked, in seconds. */
    intervalSeconds?: number;
    method?: string;
    timeoutMs?: number;
    traceSampling?: boolean;
  } | null;
}

/** How a cron monitor's schedule is expressed — `crons/types.tsx:14-17`. */
export type MonitorScheduleType = "crontab" | "interval";

/** Units an interval schedule counts in — `crons/types.tsx:76`. */
export type MonitorIntervalUnit = "year" | "month" | "week" | "day" | "hour" | "minute";

/**
 * A cron monitor's schedule — `MonitorConfig` in `crons/types.tsx:90`.
 *
 * The two variants share a key: `schedule` is a crontab string, or a
 * `[value, unit]` pair. `schedule_type` is absent on old records
 * (`crons/types.tsx:7-12`), where crontab is the implied default.
 */
export interface MonitorConfig {
  schedule: string | [number, MonitorIntervalUnit];
  schedule_type?: MonitorScheduleType;
  timezone?: string | null;
  checkin_margin?: number | null;
  max_runtime?: number | null;
  failure_issue_threshold?: number | null;
  recovery_threshold?: number | null;
}

/** One environment a cron monitor checks in from — `crons/types.tsx:98-107`. */
export interface MonitorEnvironment {
  name: string;
  status?: string;
  isMuted?: boolean;
  lastCheckIn?: string | null;
  nextCheckIn?: string | null;
}

/**
 * `CronMonitorDataSource` — `detectors.tsx:81-84`, whose `queryObj` is the
 * cron `Monitor` itself.
 *
 * `queryObj.id` and `queryObj.environments` are what
 * `GET /organizations/{org}/monitors-stats/` is keyed by, so the check-in
 * timeline needs no shape beyond this one.
 */
export interface CronMonitorDataSource {
  id: string;
  type: "cron_monitor";
  queryObj?: {
    id: string;
    slug?: string;
    name?: string;
    config?: MonitorConfig;
    environments?: MonitorEnvironment[];
    isMuted?: boolean;
    status?: string;
  } | null;
}

/** A detector's data source, whichever kind it has. */
export type DetectorDataSource =
  | SnubaQueryDataSource
  | UptimeSubscriptionDataSource
  | CronMonitorDataSource
  | { id: string; type: string & {}; queryObj?: unknown };

/**
 * One threshold — `MetricCondition` in `detectors.tsx:281-286`.
 *
 * `type` is a `DataConditionType` (`gt`, `lt`, `gte`, …), `comparison` the
 * number it is compared against (or an anomaly-detection object for a dynamic
 * detector), and `conditionResult` the priority the breach opens at:
 * 25 low, 50 medium, 75 high, 0 OK (`dataConditions.tsx:69-74`).
 */
export interface MetricCondition {
  id?: string;
  type: string;
  comparison: unknown;
  conditionResult?: number;
}

/** `MetricConditionGroup` — `detectors.tsx:275-279`. */
export interface MetricConditionGroup {
  id?: string;
  logicType?: string;
  conditions?: MetricCondition[];
}

/**
 * A detector's type-specific configuration.
 *
 * One open bag rather than the web's four `config` variants, for the same
 * reason the union is flattened: every reader here narrows by
 * `detector.type` and tolerates a field it does not recognise.
 */
export interface DetectorConfig {
  /** Metric: `static` | `percent` | `dynamic` (`detectors.tsx:92-116`). */
  detectionType?: "static" | "percent" | "dynamic" | (string & {});
  /** Metric, percent detection: the baseline window, in seconds. */
  comparisonDelta?: number;
  /** Uptime: how the monitor was created (`manual`, `auto_detected_active`, …). */
  mode?: string;
  /** Uptime: consecutive failures before the issue opens. */
  downtimeThreshold?: number;
  recoveryThreshold?: number;
  /** Uptime: the environment its issues are filed in. */
  environment?: string | null;
  /** Mobile build: the size measured, e.g. `download_size`. */
  measurement?: string;
  /** Mobile build: `absolute` or `percentage`. */
  thresholdType?: string;
  /** Mobile build: the artifact filter, when it has one. */
  query?: string;
}

/**
 * A row of `GET /organizations/{org}/detectors/` — `BaseDetector` in
 * `detectors.tsx:126-140` plus the per-type fields.
 */
export interface Detector {
  id: string;
  name: string;
  type: DetectorType;
  /** A disabled detector still lists; the whole row renders muted. */
  enabled: boolean;
  /** Null for the org-wide issue-stream detector, which we never show. */
  projectId?: string | null;
  description?: string | null;
  owner?: DetectorActor | null;
  /** Ids of the automations ("alerts") wired to this detector. */
  workflowIds?: string[];
  /** The last issue it opened, for the Last Issue column. */
  latestGroup?: DetectorGroup | null;
  lastTriggered?: string | null;
  dateCreated?: string;
  dateUpdated?: string;
  createdBy?: string | null;
  config?: DetectorConfig | null;
  conditionGroup?: MetricConditionGroup | null;
  dataSources?: DetectorDataSource[];
  /** Metric detectors created before workflow engine carry their rule's id. */
  alertRuleId?: number | null;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Rows fetched per screen.
 *
 * The web pages at `DETECTOR_LIST_PAGE_LIMIT = 20`
 * (`list/common/constants.tsx:1`); the terminal scrolls rather than paging, so
 * it asks for more in one go — the same trade `DASHBOARDS_PAGE_SIZE` makes.
 */
export const DETECTORS_PAGE_SIZE = 50;

/**
 * Default sort, matching `useDetectorListSort`'s
 * `{kind: 'desc', field: 'latestGroup'}` — the monitors that fired most
 * recently first, which is the order that makes the list worth reading.
 */
export const DEFAULT_DETECTOR_SORT = "-latestGroup";

export interface ListDetectorsParams {
  org: string;
  /** The whole search query, base filter included — see `core/monitors.ts`. */
  query?: string;
  /** A key from `SORT_MAP` (`organization_detector_index.py:104-118`). */
  sortBy?: string;
  /** Project ids or slugs; the endpoint accepts either. */
  project?: string[];
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/** List an organization's detectors. */
export async function listDetectors(
  client: SentryClient,
  {
    org,
    query,
    sortBy = DEFAULT_DETECTOR_SORT,
    project,
    limit = DETECTORS_PAGE_SIZE,
    cursor,
    signal,
  }: ListDetectorsParams,
): Promise<Page<Detector[]>> {
  return client.request<Detector[]>(`/organizations/${org}/detectors/`, {
    query: {
      query: query || undefined,
      sortBy,
      project,
      per_page: limit,
      cursor,
    },
    signal,
  });
}
