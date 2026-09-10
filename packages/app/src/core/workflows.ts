/**
 * Workflows — the alerts under `Monitors › Alerts` — as text.
 *
 * The counterpart to `core/detectors.ts`: that one turns a monitor's
 * configuration into labelled rows, this one turns an alert's *conditions and
 * actions* into lines. The web draws them as `ConditionsPanel`
 * (`views/automations/components/conditionsPanel.tsx`), a nested panel of
 * badges; a terminal has one column of text, so the same three groups —
 * when it fires, what has to match, what it then does — become three headings
 * with their members indented under them.
 *
 * Every condition sentence here is the web's `details` component for that
 * `DataConditionType` reduced to a string. Two of them lose something in the
 * reduction and say so at their case: `assigned_to` names the kind of
 * assignee rather than fetching the team or the member behind the id, and the
 * frequency conditions drop their subfilters. Everything else the terminal
 * does not recognise falls back to the condition's own type, humanised, which
 * is still a truthful line — Sentry ships condition types faster than a
 * released binary learns to phrase them.
 */

import type { Workflow, WorkflowAction, WorkflowCondition } from "~/api/workflows";
import { actionTypeLabel } from "~/api/workflows";

// ---------------------------------------------------------------------------
// Choice labels
// ---------------------------------------------------------------------------

/** `DataConditionGroupLogicType` as the two match selectors label it. */
const LOGIC_LABELS: Readonly<Record<string, string>> = {
  all: "all",
  any: "any",
  "any-short": "any",
  none: "none",
};

/** `MATCH_CHOICES` (`actionFilters/constants.tsx:117-130`). */
const MATCH_LABELS: Readonly<Record<string, string>> = {
  co: "contains",
  eq: "equals",
  sw: "starts with",
  ew: "ends with",
  nc: "does not contain",
  ne: "does not equal",
  nsw: "does not start with",
  new: "does not end with",
  is: "is set",
  ns: "is not set",
  in: "is one of",
  nin: "is not one of",
  gt: "is greater than",
  gte: "greater than or equal",
  lt: "is less than",
  lte: "less than or equal",
};

/** The two matches that stand alone, with nothing to compare against. */
const VALUELESS_MATCHES: ReadonlySet<string> = new Set(["is", "ns"]);

/** `LEVEL_CHOICES` — the numeric level a `level` condition compares to. */
const LEVEL_LABELS: Readonly<Record<string, string>> = {
  "50": "fatal",
  "40": "error",
  "30": "warning",
  "20": "info",
  "10": "debug",
  "0": "sampling",
};

/** `PRIORITY_CHOICES` — `DetectorPriorityLevel` as a word. */
const PRIORITY_LABELS: Readonly<Record<string, string>> = {
  "75": "high",
  "50": "medium",
  "25": "low",
};

/** `GROUP_CATEGORY_CHOICES` (`actionFilters/issueCategory.tsx:21-30`). */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  "1": "error",
  "6": "feedback",
  "10": "outage",
  "11": "metric",
  "12": "db_query",
  "13": "http_client",
  "14": "frontend",
  "15": "mobile",
};

/**
 * `INTERVAL_CHOICES` and its two siblings, flattened.
 *
 * The web keeps three lists because each condition offers a different subset
 * to *pick* from; reading one back only needs the label, and the labels agree
 * wherever the lists overlap.
 */
const INTERVAL_LABELS: Readonly<Record<string, string>> = {
  "1m": "in one minute",
  "5m": "in 5 minutes",
  "10m": "in 10 minutes",
  "15m": "in 15 minutes",
  "30m": "in 30 minutes",
  "1h": "in one hour",
  "1d": "in one day",
  "1w": "in one week",
  "30d": "in 30 days",
};

/** `COMPARISON_INTERVAL_CHOICES` — the same windows, read as a point in time. */
const COMPARISON_INTERVAL_LABELS: Readonly<Record<string, string>> = {
  "5m": "5 minutes ago",
  "15m": "15 minutes ago",
  "1h": "one hour ago",
  "1d": "one day ago",
  "1w": "one week ago",
  "30d": "30 days ago",
};

/**
 * The condition types that are a sentence on their own.
 *
 * `dataConditionNodesMap`'s labels for the types whose `details` component
 * takes no part of the comparison — a trigger either happened or it did not.
 */
const STANDALONE_CONDITIONS: Readonly<Record<string, string>> = {
  first_seen_event: "A new issue is created",
  issue_resolved_trigger: "An issue is resolved",
  every_event: "An event or issue activity is captured",
  regression_event: "A resolved issue regresses",
  reappeared_event: "An issue escalates",
  new_high_priority_issue: "Sentry marks a new issue as high priority",
  existing_high_priority_issue: "Sentry marks an existing issue as high priority",
  latest_release: "The issue is in the latest release",
  issue_priority_deescalating: "The issue priority de-escalates",
};

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Read a comparison field as text, whatever primitive it arrived as. */
function part(comparison: Record<string, unknown>, key: string): string | undefined {
  const value = comparison[key];
  if (typeof value === "string") return value || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Look a wire value up in a choice table, falling back to the value itself. */
function choice(labels: Readonly<Record<string, string>>, value: string | undefined): string {
  if (value === undefined) return "";
  return labels[value] ?? value;
}

/** A comparison object, or an empty one when the condition carries a scalar. */
function comparisonObject(condition: WorkflowCondition): Record<string, unknown> {
  const { comparison } = condition;
  return comparison && typeof comparison === "object" && !Array.isArray(comparison)
    ? (comparison as Record<string, unknown>)
    : {};
}

/** A scalar comparison as text — `issue_priority_greater_or_equal` sends one. */
function comparisonScalar(condition: WorkflowCondition): string | undefined {
  const { comparison } = condition;
  if (typeof comparison === "string") return comparison || undefined;
  if (typeof comparison === "number" || typeof comparison === "boolean") return String(comparison);
  return undefined;
}

/** `co`-style match plus its value, or the match alone when it takes none. */
function matchClause(comparison: Record<string, unknown>, valueKey: string): string {
  const match = choice(MATCH_LABELS, part(comparison, "match"));
  if (VALUELESS_MATCHES.has(String(comparison["match"] ?? ""))) return match;
  const value = part(comparison, valueKey);
  return value === undefined ? match : `${match} ${value}`;
}

/** `equal to` / `not equal to`, the sense an include flag reads in. */
function includeClause(comparison: Record<string, unknown>): string {
  return comparison["include"] === false ? "not equal to" : "equal to";
}

/** Underscored wire values as words, for the types with no phrasing of their own. */
function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * One data condition as a sentence.
 *
 * Mirrors the `details` component `dataConditionNodesMap` names for the type.
 * A type with no case falls through to its own name, humanised: an unreadable
 * line is still better than a missing condition, because a card that silently
 * drops a filter misrepresents when the alert fires.
 */
export function workflowConditionText(condition: WorkflowCondition): string {
  const standalone = STANDALONE_CONDITIONS[condition.type];
  if (standalone) return standalone;

  const comparison = comparisonObject(condition);

  switch (condition.type) {
    // The web's own choice list labels the unit `minute(s)`, which reads as a
    // form field rather than a sentence; a card is only ever read, so the
    // count picks the plural here.
    case "age_comparison": {
      const direction =
        part(comparison, "comparisonType") === "newer" ? "newer than" : "older than";
      const value = Number(part(comparison, "value"));
      const unit = part(comparison, "time") ?? "";
      const age = Number.isFinite(value) ? plural(value, unit) : unit;
      return `The issue is ${direction} ${age}`.trimEnd();
    }

    // The web resolves the team or the member behind `targetIdentifier` with a
    // second request each. A transcript card is not worth two more fetches, so
    // this names the kind of assignee and stops.
    case "assigned_to": {
      const target = part(comparison, "targetType");
      if (target === "Team") return "The issue is assigned to a team";
      if (target === "Member") return "The issue is assigned to a member";
      return "The issue is unassigned";
    }

    case "issue_occurrences":
      return `The issue has happened at least ${part(comparison, "value") ?? "?"} times`;

    case "issue_priority_greater_or_equal":
      return `Current issue priority is at least ${choice(PRIORITY_LABELS, comparisonScalar(condition))}`;

    case "issue_category":
      return `Issue category is ${includeClause(comparison)} ${choice(CATEGORY_LABELS, part(comparison, "value"))}`;

    case "issue_type":
      return `Issue type is ${includeClause(comparison)} ${part(comparison, "value") ?? ""}`.trimEnd();

    case "event_attribute":
      return `The event's ${part(comparison, "attribute") ?? "?"} attribute ${matchClause(comparison, "value")}`;

    case "tagged_event":
      return `The event's ${part(comparison, "key") ?? "?"} tag ${matchClause(comparison, "value")}`;

    case "level":
      return `The event's level ${choice(MATCH_LABELS, part(comparison, "match"))} ${choice(LEVEL_LABELS, part(comparison, "level"))}`;

    case "latest_adopted_release":
      return `The ${part(comparison, "releaseAgeType") ?? "latest"} adopted release for the issue is ${part(comparison, "ageComparison") ?? "older"} than the latest adopted release in ${part(comparison, "environment") || "any environment"}`;

    case "seer_activity_trigger": {
      const stages = Array.isArray(condition.comparison)
        ? condition.comparison.filter((stage): stage is string => typeof stage === "string")
        : [];
      if (stages.length === 0) return "Seer runs on an issue";
      return `Seer reaches ${stages.map(humanize).join(", ")}`;
    }

    // The four frequency pairs differ only in what they count and whether the
    // threshold is absolute or relative, so they share two sentences. Their
    // `filters` subfilters are dropped: each is a condition of its own, and a
    // card that nests them stops being one line per rule.
    case "event_frequency_count":
    case "event_unique_user_frequency_count":
    case "event_unique_user_frequency_with_conditions_count":
    case "percent_sessions_count":
      return `${frequencySubject(condition.type)} is more than ${part(comparison, "value") ?? "?"} ${choice(INTERVAL_LABELS, part(comparison, "interval"))}`;

    case "event_frequency_percent":
    case "event_unique_user_frequency_percent":
    case "event_unique_user_frequency_with_conditions_percent":
    case "percent_sessions_percent":
      return `${frequencySubject(condition.type)} is ${part(comparison, "value") ?? "?"}% higher ${choice(INTERVAL_LABELS, part(comparison, "interval"))} compared to ${choice(COMPARISON_INTERVAL_LABELS, part(comparison, "comparisonInterval"))}`;

    default: {
      const scalar = comparisonScalar(condition);
      const name = humanize(condition.type);
      return scalar ? `${name} ${scalar}` : name;
    }
  }
}

/** What a frequency condition counts, from its type. */
function frequencySubject(type: string): string {
  if (type.startsWith("percent_sessions")) return "Percentage of sessions affected by an issue";
  if (type.startsWith("event_unique_user")) return "Number of users affected by an issue";
  return "Number of events in an issue";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * One action as `Slack — #checkout-alerts`.
 *
 * The integration name carries the line — the web draws its logo instead —
 * and `targetDisplay` narrows it to the channel, address or team the
 * notification actually lands in when the server resolved one.
 */
export function workflowActionText(action: WorkflowAction): string {
  const label = actionTypeLabel(action.type);
  const target = action.config?.targetDisplay?.trim();
  const suffixed = target ? `${label} — ${target}` : label;
  return action.status === "disabled" ? `${suffixed} (disabled)` : suffixed;
}

// ---------------------------------------------------------------------------
// The whole panel
// ---------------------------------------------------------------------------

/** One line of the conditions panel: a group heading, or a member of one. */
export interface WorkflowConditionLine {
  /** True for `When …`, `If …` and `Then …`; false for what sits under them. */
  heading: boolean;
  text: string;
}

/**
 * How much of an alert a card is willing to spend lines on.
 *
 * A workflow can carry a dozen filters across several action filters, and a
 * Seer transcript is a scrolling column shared with the answer around it. The
 * excess is summarised rather than dropped silently, so the card never claims
 * an alert is simpler than it is.
 */
export const WORKFLOW_CONDITION_LINE_LIMIT = 12;

/**
 * An alert's conditions and actions, in reading order.
 *
 * The same three groups `ConditionsPanel` draws: the trigger, then each action
 * filter with the actions it gates. An empty trigger group is the server's way
 * of saying "any activity", which is why the heading changes rather than the
 * group disappearing.
 */
export function workflowConditionLines(
  workflow: Workflow,
  limit: number = WORKFLOW_CONDITION_LINE_LIMIT,
): WorkflowConditionLine[] {
  const lines: WorkflowConditionLine[] = [];

  const triggers = workflow.triggers;
  const triggerConditions = triggers?.conditions ?? [];
  lines.push({
    heading: true,
    text:
      triggerConditions.length > 0
        ? `When ${choice(LOGIC_LABELS, triggers?.logicType) || "any"} of the following occur`
        : "When an event or issue activity is captured",
  });
  for (const condition of triggerConditions) {
    lines.push({ heading: false, text: workflowConditionText(condition) });
  }

  for (const filter of workflow.actionFilters ?? []) {
    const conditions = filter.conditions ?? [];
    lines.push({
      heading: true,
      text: `If ${choice(LOGIC_LABELS, filter.logicType) || "all"} of these filters match`,
    });
    if (conditions.length === 0) {
      lines.push({ heading: false, text: "Any event" });
    } else {
      for (const condition of conditions) {
        lines.push({ heading: false, text: workflowConditionText(condition) });
      }
    }

    const actions = filter.actions ?? [];
    lines.push({ heading: true, text: "Then perform these actions" });
    if (actions.length === 0) {
      lines.push({ heading: false, text: "No actions configured" });
    } else {
      for (const action of actions) {
        lines.push({ heading: false, text: workflowActionText(action) });
      }
    }
  }

  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  kept.push({ heading: false, text: `…and ${lines.length - limit} more lines` });
  return kept;
}

/**
 * How often the alert is allowed to fire for one issue.
 *
 * `config.frequency` is in minutes and absent on an unthrottled alert, which
 * the web reads as "every trigger".
 */
export function workflowThrottleText(workflow: Workflow): string {
  const frequency = workflow.config?.frequency;
  if (typeof frequency !== "number" || frequency <= 0) return "Every trigger";
  if (frequency % 1440 === 0) return plural(frequency / 1440, "day");
  if (frequency % 60 === 0) return plural(frequency / 60, "hour");
  return plural(frequency, "minute");
}

/** `1 hour`, `30 minutes` — a count with its unit pluralised. */
function plural(count: number, unit: string): string {
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
}
