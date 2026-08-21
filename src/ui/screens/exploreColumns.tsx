/**
 * Column specs for the four Discover-backed Explore tables.
 *
 * The query config lives in `src/core/exploreTables.ts`; this is the other
 * half — how each requested field draws. Kept beside the screen rather than in
 * `core/` because a column is a renderer, and kept out of the screen file
 * because four column sets is most of a file on its own.
 *
 * Every column's `key` is the Discover field it reads, which is what lets
 * `test/exploreTables.test.tsx` assert that no column draws a field the query
 * never asked for.
 */

import { rowNumber, rowString } from "~/api/discover";
import type { ExploreEvent } from "~/api/exploreEvents";
import { theme } from "~/core/theme";
import type { ScreenId } from "~/core/screens";
import { formatCount, proportionalBar } from "~/lib/sparkline";
import { padText } from "~/lib/text";
import { clockTime } from "~/lib/time";
import type { Column } from "~/ui/components/DataTable";
import { BOLD, DIM } from "~/ui/lib/attributes";

/**
 * Cells the flex column keeps before anything sheds.
 *
 * These tables carry five or six fixed columns, so `DataTable`'s eight-cell
 * floor would let a description or a prompt be squeezed to nothing while a
 * transaction name kept eighteen cells to itself. Raising it inverts that:
 * the column that says what the row *is* holds a readable width, and the
 * lowest-priority column goes instead.
 */
export const EXPLORE_MIN_FLEX = 24;

/** What a column needs to know about the rest of the page it is drawn on. */
export interface ExploreColumnContext {
  /**
   * Longest span duration on the page, in milliseconds. The duration bars are
   * scaled to it, so a row's bar is read against its neighbours rather than
   * against an absolute scale a terminal has no room to label.
   */
  maxDurationMs: number;
}

/** Columns for a screen, or an empty list if it isn't one of the four. */
export function exploreColumnsFor(
  id: ScreenId,
  context: ExploreColumnContext,
): ReadonlyArray<Column<ExploreEvent>> {
  switch (id) {
    case "explore.traces":
      return traceColumns(context);
    case "explore.metrics":
      return METRIC_COLUMNS;
    case "explore.errors":
      return ERROR_COLUMNS;
    case "explore.conversations":
      return CONVERSATION_COLUMNS;
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

/**
 * Span ID · Name · Description · Duration · Transaction · Time.
 *
 * Description and Duration never shed: the first says what the span did and
 * the second is the reason to be on this screen at all. Transaction goes
 * first — it repeats down the page — then the span id, then the name, whose
 * information is usually a prefix of the description.
 */
function traceColumns(context: ExploreColumnContext): ReadonlyArray<Column<ExploreEvent>> {
  return [
    {
      key: "id",
      label: "Span ID",
      width: 8,
      priority: 3,
      render: (event, _selected, width) => (
        <text fg={theme.muted}>{padText(shortId(event.id), width)}</text>
      ),
    },
    {
      key: "span.name",
      label: "Name",
      width: 16,
      priority: 2,
      render: (event, _selected, width) => (
        <text fg={theme.subText}>{padText(field(event, "span.name"), width)}</text>
      ),
    },
    {
      key: "span.description",
      label: "Description",
      width: "flex",
      render: (event, _selected, width) => (
        <text fg={theme.text}>{padText(field(event, "span.description"), width)}</text>
      ),
    },
    {
      key: "span.duration",
      label: "Duration",
      width: 15,
      render: (event, _selected, width) => (
        <DurationCell
          durationMs={rowNumber(event.row, "span.duration")}
          maxMs={context.maxDurationMs}
          width={width}
        />
      ),
    },
    {
      key: "transaction",
      label: "Transaction",
      width: 18,
      priority: 1,
      render: (event, _selected, width) => (
        <text fg={theme.subText}>{padText(field(event, "transaction"), width)}</text>
      ),
    },
    {
      key: "timestamp",
      label: "Time",
      width: 8,
      priority: 4,
      render: (event, _selected, width) => (
        <text fg={theme.muted}>{padText(clockTime(rowString(event.row, "timestamp")), width)}</text>
      ),
    },
  ];
}

/** Value in the fixed part of the cell, bar in whatever is left. */
const DURATION_VALUE_WIDTH = 7;

/**
 * A duration as a proportional bar plus its number.
 *
 * The bar is the one thing this table does better than the browser: a column
 * of them turns "which of these spans is slow" from reading forty numbers into
 * a glance. The number stays because a bar alone can't say whether the longest
 * span on the page took four milliseconds or four seconds.
 */
function DurationCell({
  durationMs,
  maxMs,
  width,
}: {
  durationMs: number | undefined;
  maxMs: number;
  width: number;
}) {
  const valueWidth = Math.min(DURATION_VALUE_WIDTH, width);
  const barWidth = Math.max(0, width - valueWidth - 1);

  if (durationMs === undefined) {
    return <text fg={theme.subText}>{padText("—", width, "right")}</text>;
  }

  const fraction = maxMs > 0 ? durationMs / maxMs : 0;
  return (
    <>
      {barWidth > 0 ? (
        <>
          <text fg={theme.accent}>{proportionalBar(fraction, barWidth)}</text>
          <text> </text>
        </>
      ) : null}
      <text fg={theme.text}>{padText(formatDuration(durationMs), valueWidth, "right")}</text>
    </>
  );
}

/**
 * A duration in the largest unit that keeps it under four characters of
 * mantissa: `840µs`, `12.4ms`, `1.24s`, `3.2m`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1) return `${Math.round(ms * 1000)}µs`;
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Metric · Type · Value · Project · Time.
 *
 * The metric's name and its value are the row; everything else annotates them.
 */
const METRIC_COLUMNS: ReadonlyArray<Column<ExploreEvent>> = [
  {
    key: "metric.name",
    label: "Metric",
    width: "flex",
    render: (event, _selected, width) => (
      <text fg={theme.text}>{padText(field(event, "metric.name"), width)}</text>
    ),
  },
  {
    key: "metric.type",
    label: "Type",
    width: 12,
    priority: 2,
    render: (event, _selected, width) => (
      <text fg={theme.subText}>{padText(field(event, "metric.type"), width)}</text>
    ),
  },
  {
    key: "value",
    label: "Value",
    width: 14,
    align: "right",
    render: (event, _selected, width) => (
      <text fg={theme.accent}>
        {padText(
          formatMetricValue(rowNumber(event.row, "value"), rowString(event.row, "metric.unit")),
          width,
          "right",
        )}
      </text>
    ),
  },
  {
    key: "project",
    label: "Project",
    width: 14,
    priority: 1,
    render: (event, _selected, width) => (
      <text fg={theme.subText}>{padText(field(event, "project"), width)}</text>
    ),
  },
  {
    key: "timestamp",
    label: "Time",
    width: 8,
    priority: 3,
    render: (event, _selected, width) => (
      <text fg={theme.muted}>{padText(clockTime(rowString(event.row, "timestamp")), width)}</text>
    ),
  },
];

/**
 * Symbols for the units Sentry's metrics API spells out in full.
 *
 * The API answers `"millisecond"`, which costs eleven cells of a column that
 * has fifteen. Anything not listed is printed as it arrived — an unknown unit
 * abbreviated by guesswork would be worse than a long one.
 */
const UNIT_SYMBOLS: Record<string, string> = {
  nanosecond: "ns",
  microsecond: "µs",
  millisecond: "ms",
  second: "s",
  minute: "min",
  hour: "h",
  day: "d",
  week: "wk",
  bit: "b",
  byte: "B",
  kilobyte: "kB",
  kibibyte: "KiB",
  megabyte: "MB",
  mebibyte: "MiB",
  gigabyte: "GB",
  gibibyte: "GiB",
  terabyte: "TB",
  tebibyte: "TiB",
  percent: "%",
  ratio: "",
};

/**
 * A metric sample and the unit it was recorded in.
 *
 * `none` is the API's own name for "unitless" (`metrics/constants.tsx`), so it
 * is dropped rather than printed, and so is the empty symbol for a ratio.
 */
export function formatMetricValue(value: number | undefined, unit: string | undefined): string {
  if (value === undefined) return "—";
  const magnitude = Math.abs(value) < 1000 ? String(Number(value.toFixed(2))) : formatCount(value);
  if (!unit || unit === "none") return magnitude;
  const symbol = UNIT_SYMBOLS[unit] ?? unit;
  if (!symbol) return magnitude;
  // A symbol sits against its number (`248.5ms`); a word the map didn't cover
  // gets a space, because `248.5furlongs` doesn't read.
  return symbol.length <= 3 ? `${magnitude}${symbol}` : `${magnitude} ${symbol}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Level colours, mirroring the issue stream's `theme.level` map. */
const LEVELS: Record<string, string> = {
  fatal: theme.level.fatal,
  error: theme.level.error,
  warning: theme.level.warning,
  info: theme.level.info,
  sample: theme.level.sample,
};

/**
 * Event ID · Time · Level · Title · Project · User.
 *
 * Deliberately not the issue stream: no counts, no sparkline, no assignee, and
 * the event id leads so a row reads as one occurrence rather than a group.
 * Time and the title are what survive any width — an event without either is
 * not an event.
 * `DEFAULT_ERROR_VIEW` (`views/discover/results/data.tsx:30-39`) orders the
 * web's columns title-first; the id goes ahead of it here because it is the
 * thing you copy out of a terminal.
 */
const ERROR_COLUMNS: ReadonlyArray<Column<ExploreEvent>> = [
  {
    key: "id",
    label: "Event ID",
    width: 8,
    priority: 3,
    render: (event, _selected, width) => (
      <text fg={theme.muted}>{padText(shortId(event.id), width)}</text>
    ),
  },
  {
    key: "timestamp",
    label: "Time",
    width: 8,
    render: (event, _selected, width) => (
      <text fg={theme.muted}>{padText(clockTime(rowString(event.row, "timestamp")), width)}</text>
    ),
  },
  {
    // Sheds last of the optional columns: the colour is worth a lot per cell,
    // but not more than the title it is colouring.
    key: "level",
    label: "Level",
    width: 7,
    priority: 4,
    render: (event, _selected, width) => {
      const level = field(event, "level").toLowerCase();
      const colour = LEVELS[level] ?? theme.level.unknown;
      return (
        <text fg={colour} attributes={level === "error" || level === "fatal" ? BOLD : 0}>
          {padText(level ? level.toUpperCase() : "", width)}
        </text>
      );
    },
  },
  {
    key: "title",
    label: "Title",
    width: "flex",
    render: (event, _selected, width) => (
      <text fg={theme.text}>{padText(field(event, "title"), width)}</text>
    ),
  },
  {
    key: "project",
    label: "Project",
    width: 14,
    priority: 2,
    render: (event, _selected, width) => (
      <text fg={theme.subText}>{padText(field(event, "project"), width)}</text>
    ),
  },
  {
    key: "user.display",
    label: "User",
    width: 18,
    priority: 1,
    render: (event, _selected, width) => (
      <text fg={theme.subText}>{padText(field(event, "user.display"), width)}</text>
    ),
  },
];

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * Conversation · Prompt · Model · Tokens · Cost · Time.
 *
 * The prompt is the flex column and never sheds: a list of AI calls with the
 * prompts hidden is a list of identical rows. Cost and tokens are the two
 * numbers anyone opens this screen to add up, so they outrank the model.
 */
const CONVERSATION_COLUMNS: ReadonlyArray<Column<ExploreEvent>> = [
  {
    key: "gen_ai.conversation.id",
    label: "Conversation",
    width: 12,
    render: (event, _selected, width) => (
      <text fg={theme.muted}>
        {padText(shortId(field(event, "gen_ai.conversation.id"), 12), width)}
      </text>
    ),
  },
  {
    key: "gen_ai.input.messages",
    label: "Prompt",
    width: "flex",
    render: (event, _selected, width) => (
      <text fg={theme.text}>
        {padText(messagePreview(field(event, "gen_ai.input.messages")), width)}
      </text>
    ),
  },
  {
    key: "gen_ai.response.model",
    label: "Model",
    width: 20,
    priority: 3,
    render: (event, _selected, width) => (
      <text fg={theme.subText}>{padText(field(event, "gen_ai.response.model"), width)}</text>
    ),
  },
  {
    key: "gen_ai.usage.total_tokens",
    label: "Tokens",
    width: 8,
    align: "right",
    priority: 4,
    render: (event, _selected, width) => {
      const tokens = rowNumber(event.row, "gen_ai.usage.total_tokens");
      return (
        <text fg={theme.text}>
          {padText(tokens === undefined ? "—" : formatCount(tokens), width, "right")}
        </text>
      );
    },
  },
  {
    key: "gen_ai.cost.total_tokens",
    label: "Cost",
    width: 9,
    align: "right",
    priority: 5,
    render: (event, _selected, width) => (
      <text fg={theme.accent}>
        {padText(formatCost(rowNumber(event.row, "gen_ai.cost.total_tokens")), width, "right")}
      </text>
    ),
  },
  {
    key: "timestamp",
    label: "Time",
    width: 8,
    priority: 2,
    render: (event, _selected, width) => (
      <text fg={theme.muted}>{padText(clockTime(rowString(event.row, "timestamp")), width)}</text>
    ),
  },
  {
    key: "id",
    label: "Span",
    width: 8,
    priority: 1,
    render: (event, _selected, width) => (
      <text fg={theme.subText} attributes={DIM}>
        {padText(shortId(event.id), width)}
      </text>
    ),
  },
];

/**
 * A token cost in dollars.
 *
 * Four places under a dollar, because a single model call routinely costs
 * fractions of a cent and `$0.00` would make a whole column read as free.
 */
export function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "—";
  if (cost === 0) return "$0";
  return cost < 1 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

/**
 * The first readable line of a gen-AI message payload.
 *
 * The field is a JSON array of `{type, text}` parts when the SDK sends
 * structured messages and a bare string when it doesn't, so both are handled;
 * anything else falls back to the raw value, which is still more use than an
 * empty cell. Newlines collapse to spaces — a table row is one line.
 */
export function messagePreview(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const text = firstText(JSON.parse(trimmed));
      if (text) return collapse(text);
    } catch {
      // Not JSON after all, or truncated by the API — show it raw.
    }
  }
  return collapse(trimmed);
}

/** Keys that hold the prose, checked before anything else on an object. */
const TEXT_KEYS = ["text", "content", "message"];
/** Keys that hold more messages. `parts` is what the Python SDK nests under. */
const NESTED_KEYS = ["parts", "messages", "input", "items"];

/**
 * Depth-first search for the first non-empty string that reads as prose.
 *
 * Preferred keys first, then anything nested, then — as a last resort — every
 * other value: SDKs disagree about the envelope
 * (`[{role, parts: [{type, content}]}]` from one, `[{type, text}]` from
 * another), and guessing wrong should cost a slightly odd preview, not a blank
 * column. `role` and `type` are skipped because they would win the search with
 * the word "user".
 */
function firstText(value: unknown, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstText(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of [...TEXT_KEYS, ...NESTED_KEYS]) {
      const found = firstText(record[key], depth + 1);
      if (found) return found;
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key === "role" || key === "type") continue;
      const found = firstText(nested, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Shared cell helpers
// ---------------------------------------------------------------------------

/** A field as a string, empty when the dataset didn't return it. */
export function field(event: ExploreEvent, name: string): string {
  return rowString(event.row, name) ?? "";
}

/**
 * The leading bytes of a 32-character id.
 *
 * Enough to recognise a row and to search for it, without spending a fifth of
 * a narrow terminal on hex.
 */
function shortId(id: string, width = 8): string {
  return id.slice(0, width);
}
