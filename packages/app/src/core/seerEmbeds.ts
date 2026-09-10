/**
 * The Seer markdown embeds, as the terminal understands them.
 *
 * Seer answers arrive as Markdoc: ordinary Markdown with `{% name %}` tags
 * carrying a JSON payload. The web app registers one React component per tag
 * (`sentry/static/app/components/seer/markdown/embeds`); this module is the
 * half of that which is not a renderer — which names exist, whether a given
 * occurrence is a block or an inline reference, how to read a payload that
 * arrived from an agent rather than a schema, and what an embed reads as when
 * it has to collapse to a run of text.
 *
 * Kept apart from the components on purpose: every rule here is a string in,
 * string out, so the table that has to track the web app's schemas can be
 * tested without a renderer.
 */

import { shortReplayId } from "~/api/replays";
import { countMetric } from "@sentry-tui/runtime-contract/telemetry";

/**
 * Where an embed may appear.
 *
 * Markdoc decides this structurally — a tag alone in its own block is a block
 * node, one among a sentence's words is inline — and the web renderer passes
 * the result to the embed, which draws a full card or a compact link from it.
 */
export type SeerEmbedLevel = "inline" | "block";

/**
 * Every embed the web app registers, and the levels its schema declares.
 *
 * Mirrors `ALL_SEER_EMBED_SCHEMAS`. Kept as levels rather than full schemas:
 * the terminal validates by reading fields defensively at the point of use,
 * so the one thing it cannot derive from a payload is the level a name is
 * allowed to take.
 */
export const SEER_EMBED_LEVELS: Readonly<Record<string, readonly SeerEmbedLevel[]>> = {
  agentWriteApproval: ["block"],
  alert: ["inline", "block"],
  autofix: ["block"],
  autofixRef: ["block"],
  chart: ["block"],
  dashboard: ["inline", "block"],
  docs: ["inline"],
  dsn: ["block"],
  errorsQuery: ["inline", "block"],
  issue: ["inline", "block"],
  issues: ["block"],
  issuesQuery: ["inline", "block"],
  logsQuery: ["inline", "block"],
  metricsQuery: ["inline", "block"],
  monitor: ["inline", "block"],
  profile: ["inline", "block"],
  release: ["inline", "block"],
  replay: ["inline", "block"],
  replaysQuery: ["inline", "block"],
  savedIssueView: ["inline", "block"],
  savedQuery: ["inline", "block"],
  spansQuery: ["inline", "block"],
  timestamp: ["inline"],
  trace: ["inline", "block"],
  user: ["inline"],
};

/**
 * Embeds whose payload never rides in the tag.
 *
 * These carry only a name in the transcript; the data arrives out of band on
 * the tool result's `structuredContent`, one poll later than the tag itself in
 * the worst case.
 */
export const STRUCTURED_SEER_EMBEDS: ReadonlySet<string> = new Set(["agentWriteApproval"]);

/** Whether the terminal has a renderer for this tag name. */
export function isSeerEmbed(name: string): boolean {
  return Object.hasOwn(SEER_EMBED_LEVELS, name);
}

/**
 * The level one occurrence of an embed takes.
 *
 * `aloneInBlock` is the terminal's stand-in for Markdoc's node position: a tag
 * with nothing but whitespace either side of it on its line is a block node.
 * A name whose schema allows only one level takes that level regardless, which
 * is what keeps a stray `{% timestamp %}` on its own line reading as a word
 * rather than growing a card.
 */
export function seerEmbedLevel(name: string, aloneInBlock: boolean): SeerEmbedLevel | null {
  const levels = SEER_EMBED_LEVELS[name];
  if (!levels) return null;
  if (!levels.includes("block")) return "inline";
  if (!levels.includes("inline")) return "block";
  return aloneInBlock ? "block" : "inline";
}

/**
 * Record that a tag arrived with no renderer behind it.
 *
 * Expected rather than broken — the server can ship an embed before a released
 * binary knows it — so this is a counter, not an error, and the transcript
 * still renders. Deduplicated by name because Seer's markdown is re-parsed on
 * every poll while an answer streams, which would otherwise count one unknown
 * tag once per frame.
 */
const reportedUnknownEmbeds = new Set<string>();
export function reportUnknownSeerEmbed(name: string, level: SeerEmbedLevel): void {
  if (reportedUnknownEmbeds.has(name)) return;
  reportedUnknownEmbeds.add(name);
  countMetric("ui.seer_embed.unknown", { level });
}

// ---------------------------------------------------------------------------
// Reading payloads
// ---------------------------------------------------------------------------

/**
 * Read a field as non-empty text.
 *
 * Numbers are accepted because the schemas that take an id say so: agents
 * routinely emit a bare number where a string id is wanted, and a dashboard
 * that fails to render because its id arrived unquoted is the embed being
 * stricter than the product.
 */
export function embedText(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Read a field as a list of non-empty strings, dropping malformed entries. */
export function embedTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = embedText(entry);
    return text ? [text] : [];
  });
}

/** Read a field as a finite number, accepting the numeric strings agents emit. */
export function embedNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Narrow a field to the plain object an embed payload is expected to be. */
export function embedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The page filters every query embed carries.
 *
 * Seer sends these beside the search string rather than folded into it, so the
 * screens they open can be handed real filter values instead of parsing them
 * back out of a querystring.
 */
export interface SeerEmbedFilters {
  projects: string[];
  environments: string[];
  statsPeriod?: string;
  start?: string;
  end?: string;
}

const STATS_PERIOD = /^\d+[smhdw]$/;

/** Read the shared page-filter block off any query embed's payload. */
export function readEmbedFilters(data: Record<string, unknown>): SeerEmbedFilters {
  const statsPeriod = embedText(data["statsPeriod"]);
  return {
    projects: embedTexts(data["projects"]),
    environments: embedTexts(data["environments"]),
    // A period the screens cannot use is worse than no period: it would be
    // sent verbatim and rejected by the API for the whole card.
    statsPeriod: statsPeriod && STATS_PERIOD.test(statsPeriod) ? statsPeriod : undefined,
    start: embedText(data["start"]),
    end: embedText(data["end"]),
  };
}

/** The period line under a query card: an explicit range wins over a relative one. */
export function describeEmbedPeriod(filters: SeerEmbedFilters): string | undefined {
  if (filters.start && filters.end) return `${filters.start} → ${filters.end}`;
  return filters.statsPeriod;
}

/** Explore's two shapes: individual rows, or grouped and charted. */
export type SeerEmbedMode = "samples" | "aggregate";

/** One query embed's request, normalized out of an agent-authored payload. */
export interface SeerQueryEmbed {
  query: string;
  mode: SeerEmbedMode;
  groupBy: string[];
  yAxes: string[];
  fields: string[];
  sort?: string;
  title?: string;
  filters: SeerEmbedFilters;
}

/**
 * Read the fields the Explore-shaped embeds share.
 *
 * `mode` defaults to samples the way the schema does, and an unrecognized mode
 * falls there too rather than rendering nothing.
 */
export function readQueryEmbed(data: Record<string, unknown>): SeerQueryEmbed {
  const mode = embedText(data["mode"]);
  return {
    query: embedText(data["query"]) ?? "",
    mode: mode === "aggregate" ? "aggregate" : "samples",
    groupBy: embedTexts(data["groupBy"]),
    yAxes: embedTexts(data["yAxes"]),
    fields: embedTexts(data["fields"]),
    sort: embedText(data["sort"]),
    title: embedText(data["title"]),
    filters: readEmbedFilters(data),
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * The aggregate the Metrics UI opens a metric with, by type.
 *
 * `DEFAULT_YAXIS_BY_TYPE` in `views/explore/metrics/constants.tsx`, with the
 * same `sum` fallback for a type neither side has seen before.
 */
const DEFAULT_METRIC_AGGREGATE: Readonly<Record<string, string>> = {
  counter: "sum",
  distribution: "sum",
  gauge: "avg",
};

/** What a metric with no unit is filtered and aggregated as. */
const NONE_UNIT = "none";

/** Quote a filter value that is not a bare token, as the search syntax requires. */
function searchValue(value: string): string {
  return /^[\w.@:/-]+$/.test(value) ? value : JSON.stringify(value);
}

/**
 * A metrics query embed, resolved against the metric it names.
 *
 * Explore does not take a metric as a parameter — it identifies one in two
 * different places depending on the mode, and getting either wrong silently
 * returns another metric's numbers:
 *
 * - **aggregate**: inside the aggregate's own arguments, so the bare
 *   `p95(value)` Seer sends means nothing until it is qualified.
 * - **samples**: in the search string, because a sample row has no aggregate
 *   to carry the identity.
 *
 * Mirrors `metricsQueryUtils.ts` and the `views/explore/metrics/utils.tsx`
 * helpers it calls.
 */
export interface MetricsEmbedRequest {
  query: string;
  yAxes: string[];
}

export function resolveMetricsEmbed(
  data: Record<string, unknown>,
  embed: SeerQueryEmbed,
): MetricsEmbedRequest {
  const name = embedText(data["name"]);
  const type = embedText(data["type"]);
  if (!name || !type) return { query: embed.query, yAxes: embed.yAxes };

  const unit = embedText(data["unit"]);
  // `-` is how the API spells "no unit"; both spellings filter as `none`.
  const resolvedUnit = unit && unit !== "-" ? unit : NONE_UNIT;
  const qualify = (aggregate: string) => `${aggregate}(value,${name},${type},${resolvedUnit})`;

  const yAxes =
    embed.yAxes.length > 0
      ? embed.yAxes.map((yAxis) => {
          const parsed = /^([A-Za-z_][\w]*)\s*\(/.exec(yAxis);
          return parsed?.[1] ? qualify(parsed[1]) : yAxis;
        })
      : [qualify(DEFAULT_METRIC_AGGREGATE[type] ?? "sum")];

  if (embed.mode === "aggregate") return { query: embed.query, yAxes };

  // A metric with no unit matches rows that never carried the attribute as
  // well as rows that carry it as `none`.
  const unitFilter =
    resolvedUnit === NONE_UNIT
      ? `(!has:metric.unit OR metric.unit:${NONE_UNIT})`
      : `metric.unit:${searchValue(resolvedUnit)}`;
  const identity = `(metric.name:${searchValue(name)} metric.type:${searchValue(type)} ${unitFilter})`;

  return { query: embed.query ? `${embed.query} ${identity}` : identity, yAxes };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Title case for the step identifiers autofix reports (`root_cause`). */
function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

/** A leading fragment of an opaque id, enough to recognise without the noise. */
function shortId(value: string, length = 8): string {
  return value.length > length ? value.slice(0, length) : value;
}

/**
 * `**Noun id**`, or bare `**Noun**` when the id never arrived.
 *
 * The id is the whole point of these references, so a payload missing it still
 * has to read as a sentence rather than leaving a gap where a word goes.
 */
function reference(noun: string, id: string | undefined): string {
  return id ? `**${noun} ${id}**` : `**${noun}**`;
}

/**
 * Compact relative time, without the live timer the web embed runs.
 *
 * A transcript scrolls out of view and is never re-rendered on a clock, so a
 * ticking terminal timestamp would only ever be right for the frame it drew.
 */
export function relativeTime(value: string, now = Date.now()): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const seconds = Math.round((parsed - now) / 1000);
  const absolute = Math.abs(seconds);
  const [amount, unit] =
    absolute < 60
      ? [absolute, "second"]
      : absolute < 3600
        ? [Math.round(absolute / 60), "minute"]
        : absolute < 86_400
          ? [Math.round(absolute / 3600), "hour"]
          : [Math.round(absolute / 86_400), "day"];
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ${seconds < 0 ? "ago" : "from now"}`;
}

/** Render a timestamp payload the way its `format` asks for. */
export function embedTimestamp(data: Record<string, unknown>): string {
  const value = embedText(data["value"]);
  if (!value) return "";
  if (data["format"] === "relative") return relativeTime(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

/**
 * What a query embed is called.
 *
 * The agent's own title wins; otherwise the search string stands in, and a
 * query with no search at all falls back to the noun so the card is never
 * headed by an empty string.
 */
export function queryEmbedTitle(embed: SeerQueryEmbed, noun: string): string {
  return embed.title ?? (embed.query || `All ${noun}`);
}

/**
 * The one-line form of an embed.
 *
 * Used for genuinely inline occurrences, and as the whole rendering for an
 * organization without the embeds feature — in both cases the result is fed
 * back through the Markdown renderer, so emphasis and links are the vocabulary
 * available for saying "this is a reference to something".
 */
export function inlineSeerEmbed(name: string, data: Record<string, unknown>): string {
  const id = embedText(data["id"]);
  const title = embedText(data["title"]);
  const label = embedText(data["name"]);

  switch (name) {
    case "timestamp":
      return embedTimestamp(data);
    case "docs": {
      const href = embedText(data["href"]);
      return title && href ? `[${title}](${href})` : (title ?? href ?? "");
    }
    case "user":
      return `@${label ?? "user"}`;
    case "dsn":
      return `\`${embedText(data["value"]) ?? "DSN"}\``;
    case "issue":
      return `**${id ?? "issue"}**`;
    case "issues": {
      const ids = embedTexts(data["ids"]);
      return ids.length > 0 ? ids.map((entry) => `**${entry}**`).join(", ") : "Issues";
    }
    case "dashboard":
      return title ? `**${title}**` : reference("Dashboard", id);
    case "replay": {
      const replayId = embedText(data["id"]);
      return reference("Replay", replayId ? shortReplayId(replayId) : undefined);
    }
    case "release":
      return reference("Release", embedText(data["version"]));
    case "alert": {
      const kind = embedText(data["kind"]);
      if (label) return `**${label}**`;
      return reference(kind ? `${kind} alert` : "Alert", id);
    }
    case "monitor":
      return label ? `**${label}**` : reference("Monitor", id);
    case "savedIssueView":
      return label ? `**${label}**` : reference("Issue view", id);
    case "savedQuery": {
      const dataset = embedText(data["dataset"]);
      const base = label ? `**${label}**` : reference("Saved query", id);
      return dataset ? `${base} (${dataset})` : base;
    }
    case "trace": {
      const traceId = embedText(data["traceId"]);
      return reference("Trace", traceId ? shortId(traceId) : undefined);
    }
    case "profile": {
      const profileId = embedText(data["profileId"]);
      return reference("Profile", profileId ? shortId(profileId) : undefined);
    }
    case "chart":
      return title ?? "Chart";
    case "autofix":
      return embedText(data["result"]) ?? "Autofix result";
    case "autofixRef":
      return `**Autofix · ${humanize(embedText(data["step"]) ?? "run")}**`;
    case "agentWriteApproval":
      return "Seer requested permission to make changes.";
    case "issuesQuery":
      return `**${queryEmbedTitle(readQueryEmbed(data), "issues")}**`;
    case "errorsQuery":
      return `**${queryEmbedTitle(readQueryEmbed(data), "errors")}**`;
    case "spansQuery":
      return `**${queryEmbedTitle(readQueryEmbed(data), "spans")}**`;
    case "logsQuery":
      return `**${queryEmbedTitle(readQueryEmbed(data), "logs")}**`;
    case "replaysQuery":
      return `**${queryEmbedTitle(readQueryEmbed(data), "replays")}**`;
    case "metricsQuery": {
      const metric = embedText(data["name"]);
      return `**${embedText(data["title"]) ?? metric ?? "Metric"}**`;
    }
    default:
      return "";
  }
}
