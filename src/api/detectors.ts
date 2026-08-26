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
import { projectParams } from "~/api/projectParams";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Detector type wire values shared by API consumers. */
export const DETECTOR_TYPE = {
  error: "error",
  metric: "metric_issue",
  cron: "monitor_check_in_failure",
  uptime: "uptime_domain_failure",
  issueStream: "issue_stream",
  mobileBuild: "preprod_size_analysis",
} as const;

/**
 * What a detector detects — `DetectorType` in
 * `types/workflowEngine/detectors.tsx:84-90`.
 *
 * Left open (`string & {}`) because Sentry ships detector types faster than a
 * terminal learns to draw them: an unknown one must render its name and its
 * project rather than fail to compile.
 */
export type DetectorType = (typeof DETECTOR_TYPE)[keyof typeof DETECTOR_TYPE] | (string & {});

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
  /**
   * The detector's project, or `null` for the org-wide issue-stream detector
   * (`types/workflowEngine/detectors.tsx:178-180`). Always on the wire, and
   * required here because `null` is load-bearing: it is what makes a workflow
   * connected to that detector read as "All Projects".
   */
  projectId: string | null;
  description?: string | null;
  owner?: DetectorActor | null;
  /** Ids of the automations ("alerts") wired to this detector. */
  workflowIds?: string[];
  /** The last issue it opened, for the Last Issue column. */
  latestGroup?: DetectorGroup | null;
  /**
   * When it last fired. The web's `BaseDetector` types this as required, but
   * the *list* serializer omits the key altogether — checked against cron
   * monitors that fire hourly — so anything opened from a list row has to fall
   * back to `latestGroup.lastSeen`.
   */
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
export const DETECTOR_SORT_OPTIONS = [
  { value: "-latestGroup", label: "Latest Issue (newest)" },
  { value: "latestGroup", label: "Latest Issue (oldest)" },
  { value: "name", label: "Name (A-Z)" },
  { value: "-name", label: "Name (Z-A)" },
  { value: "type", label: "Type (A-Z)" },
  { value: "-type", label: "Type (Z-A)" },
  { value: "-connectedWorkflows", label: "Most Alerts" },
  { value: "connectedWorkflows", label: "Fewest Alerts" },
] as const;

export type DetectorSort = (typeof DETECTOR_SORT_OPTIONS)[number]["value"];
export const DEFAULT_DETECTOR_SORT: DetectorSort = "-latestGroup";

/** Resolve shared monitor state to a detector endpoint sort. */
export function detectorSort(value: string): DetectorSort {
  return DETECTOR_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as DetectorSort)
    : DEFAULT_DETECTOR_SORT;
}

/**
 * Ids per request when resolving detectors by id, matching
 * `MAX_DETECTORS_PER_REQUEST` (`useAutomationListDetectors.ts:14`). A longer
 * list is split across requests rather than sent as one URL the server
 * rejects.
 */
export const MAX_DETECTORS_PER_REQUEST = 100;

export interface ListDetectorsParams {
  org: string;
  /** The whole search query, base filter included — see `core/monitors.ts`. */
  query?: string;
  /** A key from `SORT_MAP` (`organization_detector_index.py:104-118`). */
  sortBy?: DetectorSort;
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
      project: projectParams(project),
      per_page: limit,
      cursor,
    },
    signal,
  });
}

/** Fetch one detector by id, for a monitor URL opened directly. */
export async function fetchDetector(
  client: SentryClient,
  { org, detectorId, signal }: { org: string; detectorId: string; signal?: AbortSignal },
): Promise<Detector> {
  const page = await client.request<Detector>(`/organizations/${org}/detectors/${detectorId}/`, {
    signal,
  });
  return page.data;
}

// ---------------------------------------------------------------------------
// Open periods
// ---------------------------------------------------------------------------

/**
 * One step inside an open period — `GroupOpenPeriodActivityResponse`
 * (`workflow_engine/endpoints/serializers/group_open_period_serializer.py`).
 */
export interface OpenPeriodActivity {
  id: string;
  /** `opened`, `status_change`, or `closed`. */
  type: string;
  /** The priority the period moved to, for a `status_change`. */
  value?: string | null;
  dateCreated: string;
  eventId?: string | null;
}

/**
 * A stretch of time a detector's issue was open.
 *
 * The serializer answers `id`, `start`, `end`, `isOpen` and `activities` — the
 * `duration` and `lastChecked` in the web's `GroupOpenPeriod` type are not on
 * the wire, so a duration is computed from the two timestamps.
 */
export interface DetectorOpenPeriod {
  id: string;
  start: string;
  /** Absent while the period is still open. */
  end?: string | null;
  isOpen: boolean;
  activities?: OpenPeriodActivity[];
}

/** Open periods fetched for a detector's detail view. */
export const OPEN_PERIODS_LIMIT = 20;

export interface ListOpenPeriodsParams {
  org: string;
  /** The detector whose latest issue's periods to list. */
  detectorId: string;
  statsPeriod?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/**
 * List a detector's open periods.
 *
 * `GET /organizations/{org}/open-periods/?detectorId=…`
 * (`workflow_engine/endpoints/organization_open_periods.py`). The endpoint
 * resolves the detector's *most recent* issue and answers that issue's
 * periods, so an empty list means "this monitor has not fired", not "no data".
 */
export async function listDetectorOpenPeriods(
  client: SentryClient,
  {
    org,
    detectorId,
    statsPeriod,
    limit = OPEN_PERIODS_LIMIT,
    cursor,
    signal,
  }: ListOpenPeriodsParams,
): Promise<Page<DetectorOpenPeriod[]>> {
  return client.request<DetectorOpenPeriod[]>(`/organizations/${org}/open-periods/`, {
    query: { detectorId, statsPeriod, per_page: limit, cursor },
    signal,
  });
}

// ---------------------------------------------------------------------------
// Resolving detectors by id
// ---------------------------------------------------------------------------

/**
 * Fetch specific detectors by id.
 *
 * The workflows list carries `detectorIds` and nothing else, so its Projects
 * column resolves them here — the same call `useAutomationListDetectors`
 * makes. It lives with the rest of `detectors/` rather than beside its caller:
 * one module owns this endpoint.
 *
 * No `query` is sent. The ids *are* the filter, and the web's shared helper
 * only appends `!type:issue_stream` because every other caller wants that
 * default — whereas the detector behind an org-wide workflow is exactly an
 * issue-stream one.
 *
 * A failed chunk yields no detectors rather than throwing: this backs a column
 * of metadata beside a row, and losing it should not cost the list.
 */
export async function listDetectorsByIds(
  client: SentryClient,
  { org, ids, signal }: { org: string; ids: readonly string[]; signal?: AbortSignal },
): Promise<Detector[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += MAX_DETECTORS_PER_REQUEST) {
    chunks.push(unique.slice(i, i + MAX_DETECTORS_PER_REQUEST));
  }

  const pages = await Promise.all(
    chunks.map((chunk) =>
      client
        .request<Detector[]>(`/organizations/${org}/detectors/`, {
          query: { id: chunk, per_page: MAX_DETECTORS_PER_REQUEST },
          signal,
        })
        .then((page) => (Array.isArray(page.data) ? page.data : []))
        .catch(() => [] as Detector[]),
    ),
  );

  return pages.flat();
}
