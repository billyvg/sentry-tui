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

import type {
  CronMonitorDataSource,
  Detector,
  DetectorActor,
  DetectorType,
  MetricCondition,
  MonitorConfig,
  SnubaQuery,
  UptimeSubscriptionDataSource,
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
  error: "Error",
  metric_issue: "Metric",
  monitor_check_in_failure: "Cron",
  uptime_domain_failure: "Uptime",
  issue_stream: "Project",
  preprod_size_analysis: "Mobile Build",
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
 * | `metric_issue`             | environment, aggregate, query, threshold          |
 * | `uptime_domain_failure`    | url, interval                                     |
 * | `monitor_check_in_failure` | schedule                                          |
 * | `preprod_size_analysis`    | measurement and threshold type                    |
 * | `error`                    | nothing — the project is the whole line           |
 */
export function detectorDetailParts(
  detector: Detector,
  { projectSlug }: DetectorDetailContext = {},
): string[] {
  const parts: string[] = [];
  if (projectSlug) parts.push(projectSlug);

  switch (detector.type) {
    case "metric_issue":
      parts.push(...metricDetailParts(detector));
      break;
    case "uptime_domain_failure":
      parts.push(...uptimeDetailParts(detector));
      break;
    case "monitor_check_in_failure": {
      const schedule = cronScheduleText(cronMonitor(detector)?.config);
      if (schedule) parts.push(schedule);
      break;
    }
    case "preprod_size_analysis": {
      const preprod = preprodThresholdText(detector);
      if (preprod) parts.push(preprod);
      break;
    }
    default:
      // `error`, `issue_stream`, and anything Sentry adds after this was
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

/**
 * The unit a static threshold is quoted in — `getStaticDetectorThresholdSuffix`
 * (`utils/metricDetectorSuffix.tsx:31-50`).
 *
 * That function asks Discover's field registry what an aggregate's output type
 * is. This client has no registry, so it reads the aggregate: durations are
 * `ms`, sizes are `B`, rates are `/s`, and the session crash-rate family is
 * the one percentage stored as a percentage. Anything unrecognised gets no
 * suffix, which is also what the web does for a plain count.
 */
function thresholdSuffix(aggregate: string): string {
  const lower = aggregate.toLowerCase();
  const fn = lower.split("(")[0] ?? "";
  const field = lower.slice(lower.indexOf("(") + 1, lower.lastIndexOf(")"));

  if (fn.startsWith("crash_free") || fn.startsWith("crash_rate")) return "%";
  if (fn === "eps" || fn === "epm" || fn === "spm" || fn === "tpm" || fn === "tps") return "/s";
  if (/duration|self_time|\b(lcp|fcp|fid|inp|ttfb)\b|app_start|time_to/.test(field)) return "ms";
  if (/size|bytes/.test(field)) return "B";
  return "";
}
