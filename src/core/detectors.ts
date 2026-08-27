/**
 * What a detector *says* — the strings a monitor row and a monitor detail are
 * both built out of.
 *
 * The list row's second line is type-dependent (`detectorLink.tsx:231-249`): a
 * metric detector shows its environment, aggregate, query and threshold; an
 * uptime monitor its URL and interval; a cron its schedule. The detail view
 * shows the same facts in a column instead of a line, so the formatting lives
 * here — in `core/`, where it can be unit-tested without a renderer and read
 * by both — rather than inside either screen.
 *
 * The narrowing helpers are the other half. `api/detectors.ts` keeps one open
 * `Detector` interface instead of the web's closed union, so this is where
 * "which data source does this detector have" is answered, once.
 */

import {
  DETECTOR_TYPE,
  type CronMonitorDataSource,
  type Detector,
  type DetectorActor,
  type DetectorType,
  type MetricCondition,
  type MonitorConfig,
  type SnubaQuery,
  type UptimeSubscriptionDataSource,
} from "~/api/detectors";
import { crontabAsText, intervalAsText } from "~/lib/cron";
import { middleEllipsis } from "~/lib/text";
import { durationText } from "~/lib/time";

/** Cells a query or a URL is trimmed to, matching `detectorLink.tsx`'s 40. */
export const DETAIL_VALUE_WIDTH = 40;

/** Separator between the fields of a row's second line, as on the web. */
export const DETAIL_SEPARATOR = " │ ";

/**
 * Type names, from `DETECTOR_TYPE_CONFIG`
 * (`views/detectors/utils/detectorTypeConfig.tsx:13-47`).
 *
 * These are also the nav labels for six of the seven Monitors screens, which
 * is not a coincidence worth encoding: `core/monitors.ts` keys its screens by
 * id, so a copy edit to either list cannot silently repoint the other.
 */
const TYPE_LABELS: Record<string, string> = {
  [DETECTOR_TYPE.error]: "Error",
  [DETECTOR_TYPE.metric]: "Metric",
  [DETECTOR_TYPE.cron]: "Cron",
  [DETECTOR_TYPE.uptime]: "Uptime",
  [DETECTOR_TYPE.issueStream]: "Project",
  [DETECTOR_TYPE.mobileBuild]: "Mobile Build",
};

/** The Type column's text. An unknown type reads as `Unknown`, as on the web. */
export function detectorTypeLabel(type: DetectorType): string {
  return TYPE_LABELS[type] ?? "Unknown";
}

/** Who a detector is assigned to, or an em dash when it is assigned to nobody. */
export function detectorAssigneeLabel(owner: DetectorActor | null | undefined): string {
  if (!owner) return "—";
  const name = owner.name || owner.email;
  if (!name) return "—";
  return owner.type === "team" && !name.startsWith("#") ? `#${name}` : name;
}

// ---------------------------------------------------------------------------
// Narrowing: which data source a detector has
// ---------------------------------------------------------------------------

/** The Snuba query a metric detector alerts on, if it has one. */
export function metricQuery(detector: Detector): SnubaQuery | undefined {
  const source = detector.dataSources?.find(
    (candidate) => candidate.type === "snuba_query_subscription",
  );
  return (source?.queryObj as { snubaQuery?: SnubaQuery } | null | undefined)?.snubaQuery;
}

/** The subscription an uptime detector checks, if it has one. */
export function uptimeSubscription(
  detector: Detector,
): NonNullable<UptimeSubscriptionDataSource["queryObj"]> | undefined {
  const source = detector.dataSources?.find(
    (candidate) => candidate.type === "uptime_subscription",
  );
  return (source?.queryObj as UptimeSubscriptionDataSource["queryObj"]) ?? undefined;
}

/**
 * The cron monitor behind a check-in detector, if it has one.
 *
 * Its `id` and `environments` are what `monitors-stats/` is keyed by, so the
 * check-in timeline reads the row through here rather than reaching into
 * `dataSources` itself.
 */
export function cronMonitor(
  detector: Detector,
): NonNullable<CronMonitorDataSource["queryObj"]> | undefined {
  const source = detector.dataSources?.find((candidate) => candidate.type === "cron_monitor");
  return (source?.queryObj as CronMonitorDataSource["queryObj"]) ?? undefined;
}

// ---------------------------------------------------------------------------
// The detail line
// ---------------------------------------------------------------------------

export interface DetectorDetailContext {
  /** The row's project, resolved from `projectId`; omitted when unknown. */
  projectSlug?: string;
}

/**
 * The fields of a detector's detail line, in the web's order and already
 * trimmed — join them with `DETAIL_SEPARATOR` to draw the row's second line,
 * or list them one per line in a detail view.
 *
 * Project first for every type, then whatever that type has to say:
 *
 * | Type                       | Fields                                            |
 * | -------------------------- | ------------------------------------------------- |
 * | Metric       | environment, aggregate, query, threshold          |
 * | Uptime       | url, interval                                     |
 * | Cron         | schedule                                          |
 * | Mobile Build | measurement and threshold type                    |
 * | Error        | nothing — the project is the whole line           |
 */
export function detectorDetailParts(
  detector: Detector,
  { projectSlug }: DetectorDetailContext = {},
): string[] {
  const parts: string[] = [];
  if (projectSlug) parts.push(projectSlug);

  switch (detector.type) {
    case DETECTOR_TYPE.metric:
      parts.push(...metricDetailParts(detector));
      break;
    case DETECTOR_TYPE.uptime:
      parts.push(...uptimeDetailParts(detector));
      break;
    case DETECTOR_TYPE.cron: {
      const schedule = cronScheduleText(cronMonitor(detector)?.config);
      if (schedule) parts.push(schedule);
      break;
    }
    case DETECTOR_TYPE.mobileBuild: {
      const preprod = preprodThresholdText(detector);
      if (preprod) parts.push(preprod);
      break;
    }
    default:
      // Error, issue-stream, and anything Sentry adds after this was
      // written: the project is all the row claims to know.
      break;
  }

  return parts;
}

/** Environment, aggregate, query and threshold, as `MetricDetectorDetails` draws them. */
function metricDetailParts(detector: Detector): string[] {
  const parts: string[] = [];
  const query = metricQuery(detector);
  if (query) {
    if (query.environment) parts.push(query.environment);
    if (query.aggregate) parts.push(query.aggregate);
    if (query.query) parts.push(middleEllipsis(query.query, DETAIL_VALUE_WIDTH));
  }

  const threshold = metricThresholdText(detector);
  if (threshold) parts.push(threshold);
  return parts;
}

/** URL and check interval, as `UptimeDetectorDetails` draws them. */
function uptimeDetailParts(detector: Detector): string[] {
  const subscription = uptimeSubscription(detector);
  if (!subscription) return [];

  const parts: string[] = [];
  if (subscription.url) parts.push(middleEllipsis(subscription.url, DETAIL_VALUE_WIDTH));
  const interval = subscription.intervalSeconds;
  if (typeof interval === "number" && interval > 0) parts.push(`Every ${durationText(interval)}`);
  return parts;
}

/**
 * A cron monitor's schedule as a phrase.
 *
 * An interval schedule is a `[value, unit]` pair and reads directly; a crontab
 * goes through `lib/cron.ts`, which falls back to the expression itself for
 * anything it cannot phrase — the raw crontab is worth more on the row than
 * "Unknown schedule", which is what the web says there.
 */
export function cronScheduleText(config: MonitorConfig | undefined): string | undefined {
  const schedule = config?.schedule;
  if (schedule === undefined) return undefined;

  if (Array.isArray(schedule)) {
    const [value, unit] = schedule;
    if (typeof value !== "number" || !unit) return undefined;
    return intervalAsText(value, unit);
  }

  if (typeof schedule !== "string" || schedule.trim() === "") return undefined;
  return crontabAsText(schedule) ?? schedule;
}

/**
 * A mobile-build detector's threshold: `download_size absolute`
 * (`PreprodDetectorDetails`).
 */
export function preprodThresholdText(detector: Detector): string | undefined {
  const { measurement, thresholdType } = detector.config ?? {};
  const text = [measurement, thresholdType].filter(Boolean).join(" ");
  return text || undefined;
}

// ---------------------------------------------------------------------------
// Metric thresholds
// ---------------------------------------------------------------------------

/** Comparison operators — `DataConditionType` (`dataConditions.tsx:11-16`). */
const CONDITION_SYMBOLS: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
  ne: "!=",
};

/** `DetectorPriorityLevel` (`dataConditions.tsx:69-74`); 0 is OK, and never drawn. */
const PRIORITY_LABELS: Record<number, string> = {
  25: "low",
  50: "medium",
  75: "high",
};

/**
 * A metric detector's threshold, as `>500ms high` or
 * `10% higher than previous 1h`.
 *
 * Conditions that resolve to OK are skipped, matching `formatCondition` — they
 * describe when the issue *closes*, which the row has no room to explain.
 */
export function metricThresholdText(detector: Detector): string | undefined {
  const conditions = detector.conditionGroup?.conditions;
  if (!conditions?.length) return undefined;

  const detectionType = detector.config?.detectionType ?? "static";
  if (detectionType === "dynamic") return "Dynamic";

  if (detectionType === "percent") {
    const window = durationText(detector.config?.comparisonDelta ?? 3600);
    const text = conditions
      .map((condition) => percentConditionText(condition, window))
      .filter(Boolean)
      .join(", ");
    return text || undefined;
  }

  const unit = thresholdSuffix(metricQuery(detector)?.aggregate ?? "count()");
  const text = conditions
    .map((condition) => staticConditionText(condition, unit))
    .filter(Boolean)
    .join(", ");
  return text || undefined;
}

/** `>500ms high` — operator, threshold, unit, and the priority it opens at. */
function staticConditionText(condition: MetricCondition, unit: string): string | undefined {
  const priority = priorityOf(condition);
  if (!priority) return undefined;
  if (typeof condition.comparison !== "number" && typeof condition.comparison !== "string") {
    return undefined;
  }
  const symbol = CONDITION_SYMBOLS[condition.type] ?? condition.type;
  return `${symbol}${condition.comparison}${unit} ${priority}`;
}

/**
 * `10% higher than previous 1h`.
 *
 * The API stores a percent threshold as a percentage *of* the baseline — 110
 * means "10% higher", 60 means "40% lower" — so it is converted the way
 * `percentThresholdAbsoluteToDelta` does before it is shown.
 */
function percentConditionText(condition: MetricCondition, window: string): string | undefined {
  const priority = priorityOf(condition);
  if (!priority || typeof condition.comparison !== "number") return undefined;
  const comparison = condition.comparison;
  const delta = comparison >= 100 ? comparison - 100 : 100 - comparison;
  const direction = comparison >= 100 ? "higher" : "lower";
  return `${delta}% ${direction} than previous ${window}`;
}

/** The priority a condition opens an issue at, or nothing when it resolves one. */
function priorityOf(condition: MetricCondition): string | undefined {
  const level = condition.conditionResult;
  if (typeof level !== "number" || level === 0) return undefined;
  return PRIORITY_LABELS[level];
}

/** Aggregates whose output type comes from their first field argument. */
const FIELD_TYPED_AGGREGATES = new Set([
  "any",
  "avg",
  "max",
  "min",
  "p50",
  "p75",
  "p90",
  "p95",
  "p99",
  "p100",
  "percentile",
  "sum",
]);

/** Fields the web's registry currently types as a duration or date. */
const MILLISECOND_FIELDS = new Set([
  "event.timestamp",
  "function.duration",
  "measurements.app_start_cold",
  "measurements.app_start_warm",
  "measurements.fcp",
  "measurements.fid",
  "measurements.fp",
  "measurements.inp",
  "measurements.lcp",
  "measurements.stall_longest_time",
  "measurements.stall_total_time",
  "measurements.time_to_full_display",
  "measurements.time_to_initial_display",
  "measurements.ttfb",
  "measurements.ttfb.requesttime",
  "span.duration",
  "span.self_time",
  "spans.browser",
  "spans.db",
  "spans.http",
  "spans.resource",
  "spans.ui",
  "timestamp",
  "transaction.duration",
]);

/** Fields the web's registry currently types as a byte size. */
const BYTE_FIELDS = new Set([
  "http.decoded_response_content_length",
  "http.response_content_length",
  "http.response_transfer_size",
  "payload_size",
]);

/** Session operations whose values are stored as percentages, not ratios. */
const SESSION_PERCENTAGE_AGGREGATES = new Set([
  "abnormal_rate",
  "anr_rate",
  "crash_free_rate",
  "crash_rate",
  "errored_rate",
  "foreground_anr_rate",
  "unhandled_rate",
  "unhealthy_rate",
]);

/**
 * The unit a static threshold is quoted in — `getStaticDetectorThresholdSuffix`
 * (`utils/metricDetectorSuffix.tsx`).
 *
 * The detector API does not return the aggregate's output type or unit. Keep a
 * deliberately small copy of the web's known cases: exact session operations,
 * exact typed fields, and the functions that inherit a field's type. An
 * unrecognised function or field gets no suffix; its name is not evidence of
 * its unit, and a missing unit is more honest than a wrong one.
 */
function thresholdSuffix(aggregate: string): string {
  const match = aggregate
    .trim()
    .toLowerCase()
    .match(/^([a-z_][a-z0-9_]*)\((.*)\)$/);
  if (!match) return "";

  const fn = match[1]!;
  if (SESSION_PERCENTAGE_AGGREGATES.has(fn)) return "%";
  if (fn === "last_seen") return "ms";
  if (!FIELD_TYPED_AGGREGATES.has(fn)) return "";

  const field = match[2]!.split(",", 1)[0]!.trim();
  if (MILLISECOND_FIELDS.has(field)) return "ms";
  if (BYTE_FIELDS.has(field)) return "B";
  return "";
}

// ---------------------------------------------------------------------------
// The detail view's labelled fields
// ---------------------------------------------------------------------------

/** A labelled value, for a key/value row in a detail pane. */
export interface DetectorField {
  label: string;
  value: string;
}

/**
 * A detector's configuration as labelled rows.
 *
 * The second projection of the same facts `detectorDetailParts` returns: that
 * one is the list row's single line, where space is the constraint and a field
 * is identified by where it sits; this one is the detail pane, where every
 * field gets a label, a line of its own, and its untrimmed value — a metric
 * detector's query is mid-ellipsised to forty cells on the row and shown whole
 * here.
 *
 * Both are built from the same formatters (`metricThresholdText`,
 * `cronScheduleText`, `preprodThresholdText`, and the data-source narrowing
 * above), which is what keeps the row and the detail from drifting. An empty
 * list means the type has nothing to configure — an error detector turns every
 * error in its project into an issue and has no settings at all.
 */
export function detectorConfigFields(detector: Detector): DetectorField[] {
  switch (detector.type) {
    case DETECTOR_TYPE.metric:
      return metricConfigFields(detector);
    case DETECTOR_TYPE.uptime:
      return uptimeConfigFields(detector);
    case DETECTOR_TYPE.cron:
      return cronConfigFields(detector);
    case DETECTOR_TYPE.mobileBuild:
      return preprodConfigFields(detector);
    default:
      return [];
  }
}

/** Drop the rows whose value never arrived, so a pane has no blank labels. */
function present(fields: Array<DetectorField | undefined>): DetectorField[] {
  return fields.filter(
    (field): field is DetectorField => field !== undefined && field.value !== "",
  );
}

/** `label` with `value`, or nothing at all when there is no value. */
function field(
  label: string,
  value: string | number | null | undefined,
): DetectorField | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return { label, value: String(value) };
}

function metricConfigFields(detector: Detector): DetectorField[] {
  const query = metricQuery(detector);
  const window = query?.timeWindow;
  return present([
    field("Aggregate", query?.aggregate),
    field("Query", query?.query),
    field("Dataset", query?.dataset),
    field("Environment", query?.environment),
    field("Time window", typeof window === "number" ? durationText(window) : undefined),
    field("Detection", detector.config?.detectionType ?? "static"),
    field("Threshold", metricThresholdText(detector)),
  ]);
}

function uptimeConfigFields(detector: Detector): DetectorField[] {
  const subscription = uptimeSubscription(detector);
  const interval = subscription?.intervalSeconds;
  const timeout = subscription?.timeoutMs;
  const config = detector.config;
  return present([
    field("URL", subscription?.url),
    field("Method", subscription?.method),
    field("Interval", typeof interval === "number" ? `Every ${durationText(interval)}` : undefined),
    field("Timeout", typeof timeout === "number" ? durationText(timeout / 1000) : undefined),
    field("Environment", config?.environment),
    field("Downtime after", failureCount(config?.downtimeThreshold)),
    field("Recovers after", successCount(config?.recoveryThreshold)),
  ]);
}

function cronConfigFields(detector: Detector): DetectorField[] {
  const monitor = cronMonitor(detector);
  const config = monitor?.config;
  const environments = (monitor?.environments ?? []).map((environment) => environment.name);
  return present([
    field("Schedule", cronScheduleText(config)),
    field("Timezone", config?.timezone),
    field("Check-in margin", minutesText(config?.checkin_margin)),
    field("Max runtime", minutesText(config?.max_runtime)),
    field("Fails after", failureCount(config?.failure_issue_threshold)),
    field("Recovers after", successCount(config?.recovery_threshold)),
    field("Environments", environments.join(", ")),
  ]);
}

function preprodConfigFields(detector: Detector): DetectorField[] {
  const config = detector.config;
  return present([
    field("Measurement", config?.measurement),
    field("Threshold type", config?.thresholdType),
    field("Query", config?.query),
  ]);
}

/** `5 minutes`, or nothing when the setting is unset. */
function minutesText(minutes: number | null | undefined): string | undefined {
  if (typeof minutes !== "number") return undefined;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** `3 consecutive failures` — the threshold that opens an issue. */
function failureCount(count: number | null | undefined): string | undefined {
  if (typeof count !== "number") return undefined;
  return count === 1 ? "1 failure" : `${count} consecutive failures`;
}

/** `2 consecutive successes` — the threshold that closes one. */
function successCount(count: number | null | undefined): string | undefined {
  if (typeof count !== "number") return undefined;
  return count === 1 ? "1 success" : `${count} consecutive successes`;
}

/**
 * The single environment a detector watches, or nothing.
 *
 * Mirrors `getDetectorEnvironment` (`utils/getDetectorEnvironment.tsx`),
 * including its deliberate `null` for crons — those carry one environment per
 * check-in source, and `detectorConfigFields` lists them all instead.
 */
export function detectorEnvironment(detector: Detector): string | undefined {
  switch (detector.type) {
    case DETECTOR_TYPE.metric:
      return metricQuery(detector)?.environment ?? undefined;
    case DETECTOR_TYPE.uptime:
      return detector.config?.environment ?? undefined;
    default:
      return undefined;
  }
}
