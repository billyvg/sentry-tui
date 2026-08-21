/**
 * The four Discover-backed Explore tables, as configuration.
 *
 * Traces, Metrics, Errors and Conversations are one `events/` query with a
 * different `dataset`, `field[]` and base filter — so they are one component
 * (`src/ui/screens/ExploreTable.tsx`) reading a row of this table, not four
 * near-identical screens. The pattern, and the reason for it, is
 * `src/core/issueViews.ts`; the contract is
 * `docs/plans/002-screen-contract.md` §2.
 *
 * Everything that distinguishes one screen from its siblings lives here.
 * Nothing here is user state: the four share the `explore.discover` slice, so
 * the project filter and the typed query follow you across them while the base
 * filter does not.
 *
 * Field choices are quoted from the web app and cited per screen. Column
 * *layout* is not here — that is the renderer's business — but every column a
 * screen draws must name a field this table requested, which
 * `test/exploreTables.test.tsx` asserts.
 */

import type { DiscoverDataset } from "~/api/discover";
import { getScreen, type ScreenId } from "~/core/screens";

export interface ExploreTable {
  /** The screen this configures. Ids are the key: a nav label can be copy-edited. */
  id: ScreenId;
  dataset: DiscoverDataset;
  /** Columns requested from `events/`, in the web app's own order. */
  fields: readonly string[];
  /** Sort column, `-` prefixed for descending. */
  sort: string;
  /** Field carrying the row's identity. */
  idField: string;
  /**
   * The filter that makes this screen this screen, ANDed with whatever the
   * user typed. Deliberately not screen state — see the module comment.
   */
  baseQuery?: string;
  /** Aggregate plotted in the chart above the table. */
  yAxis: string;
  /** What a row is called, for the status bar and the row count. */
  noun: string;
  /** Placeholder in the search box. */
  searchPlaceholder: string;
  /** Attribution string sent with every request. */
  referrer: string;
  /**
   * The organization feature this dataset sits behind, when it sits behind
   * one. We cannot read an org's flags, so a gated screen returns an empty
   * page rather than being hidden — the empty state names the flag so that
   * reads as "not enabled here" rather than "nothing happened".
   */
  feature?: string;
  /** Dim tag drawn after the item's label in the sidebar, as the web does. */
  badge?: string;
}

/**
 * Explore › Traces — the Spans tab.
 *
 * Fields and sort are `defaultFields()` / `defaultSortBys()` verbatim from
 * `views/explore/spans/spansQueryParams.tsx:186-206`, and the chart plots
 * `DEFAULT_VISUALIZATION` (`contexts/pageParamsContext/visualizes.tsx:21`,
 * resolving to `count(span.duration)`). The aggregate/group-by builder that
 * sits above the web's table is out of scope: it is a query-construction UI,
 * not a view of data.
 */
const TRACES: ExploreTable = {
  id: "explore.traces",
  dataset: "spans",
  fields: ["id", "span.name", "span.description", "span.duration", "transaction", "timestamp"],
  sort: "-timestamp",
  idField: "id",
  yAxis: "count(span.duration)",
  noun: "spans",
  searchPlaceholder: "Search spans…",
  referrer: "sentry-tui.explore-traces",
};

/**
 * Explore › Metrics — trace metric samples.
 *
 * Columns follow `TraceSamplesTableEmbeddedColumns`
 * (`views/explore/metrics/constants.tsx`), which is the variant that names the
 * metric — the standalone table can assume no metric has been selected, so it
 * has to. Keys are `TraceMetricKnownFieldKey` (`metrics/types.tsx`), and
 * `metric.unit` comes along because a bare `value` doesn't mean anything
 * without it.
 */
const METRICS: ExploreTable = {
  id: "explore.metrics",
  dataset: "tracemetrics",
  fields: ["id", "metric.name", "metric.type", "value", "metric.unit", "project", "timestamp"],
  sort: "-timestamp",
  idField: "id",
  // `count()` is rejected by this dataset — "invalid number of arguments" —
  // so the sample count is spelled out the way the spans chart spells its own.
  yAxis: "count(value)",
  noun: "metrics",
  searchPlaceholder: "Search metrics…",
  referrer: "sentry-tui.explore-metrics",
  feature: "tracemetrics-enabled",
  badge: "NEW",
};

/**
 * Explore › Errors — the alpha `errors-v2` route
 * (`views/navigation/secondary/sections/explore/exploreSecondaryNavigation.tsx:68-79`).
 *
 * Individual error *events*, not grouped issues, which is the whole point of
 * the screen: Issues answers "what is broken", this answers "what happened".
 * Fields are `DEFAULT_ERROR_VIEW` (`views/discover/results/data.tsx:30-39`),
 * plus `id` for the row key and `level`, which is the field that most quickly
 * tells an event apart from the issue it rolls up into.
 */
const ERRORS: ExploreTable = {
  id: "explore.errors",
  dataset: "errors",
  fields: ["id", "title", "level", "project", "user.display", "timestamp"],
  sort: "-timestamp",
  idField: "id",
  yAxis: "count()",
  noun: "events",
  searchPlaceholder: "Search error events…",
  referrer: "sentry-tui.explore-errors",
  feature: "explore-errors",
  badge: "ALPHA",
};

/**
 * Explore › Conversations — gen-AI spans.
 *
 * The base filter is the web's, from
 * `views/explore/conversations/components/conversationsChart.tsx:51-52`:
 * every span carrying a conversation id, narrowed to the client calls so one
 * row is one model call rather than one span of a trace. Fields are the
 * `GEN_AI_*` tags from `views/explore/constants.tsx:56-70`.
 *
 * The web's own list is served by a dedicated `/ai-conversations/` endpoint
 * that pre-aggregates spans into conversations (`hooks/useConversations.tsx`).
 * This screen is the span-level view of the same data, which is what puts it
 * on the shared Discover path with its three siblings; rolling spans up into
 * conversations is a different screen, and a bigger one.
 */
const CONVERSATIONS: ExploreTable = {
  id: "explore.conversations",
  dataset: "spans",
  fields: [
    "id",
    "gen_ai.conversation.id",
    "gen_ai.input.messages",
    "gen_ai.response.model",
    "gen_ai.usage.total_tokens",
    "gen_ai.cost.total_tokens",
    "timestamp",
  ],
  sort: "-timestamp",
  idField: "id",
  baseQuery: "has:gen_ai.conversation.id gen_ai.operation.type:ai_client",
  // The web's "Individual Chats" series, which counts conversations rather
  // than the spans that make them up.
  yAxis: "count_unique(gen_ai.conversation.id)",
  noun: "AI spans",
  searchPlaceholder: "Search AI conversations…",
  referrer: "sentry-tui.explore-conversations",
  feature: "gen-ai-conversations",
  badge: "BETA",
};

export const EXPLORE_TABLES: readonly ExploreTable[] = [TRACES, METRICS, ERRORS, CONVERSATIONS];

const BY_ID = new Map<ScreenId, ExploreTable>(EXPLORE_TABLES.map((table) => [table.id, table]));

/** The table config for a screen, or `undefined` if it isn't one of them. */
export function getExploreTable(id: ScreenId): ExploreTable | undefined {
  return BY_ID.get(id);
}

/**
 * The query to send: the screen's base filter and the user's, ANDed.
 *
 * Parenthesised rather than space-joined, matching the web's `useCombinedQuery`
 * (`views/insights/pages/agents/hooks/useCombinedQuery.tsx`) — a typed query
 * containing an `OR` would otherwise silently swallow the base filter.
 */
export function exploreQuery(table: ExploreTable, userQuery: string): string {
  const base = table.baseQuery?.trim() ?? "";
  const typed = userQuery.trim();
  if (!base) return typed;
  if (!typed) return base;
  return `(${base}) and (${typed})`;
}

/**
 * Title for the chart above the table.
 *
 * A bare `count()` says nothing a reader can use, so the noun is folded in;
 * an aggregate that already names its field is left alone.
 */
export function exploreChartTitle(table: ExploreTable): string {
  return table.yAxis === "count()" ? `count(${table.noun})` : table.yAxis;
}

/**
 * Empty-state copy.
 *
 * A gated dataset answers an empty page rather than an error, and we cannot
 * read the org's flags to tell the two apart — so the state says both, and
 * never claims there is nothing to see.
 */
export function exploreEmptyLines(table: ExploreTable, query: string): Array<string | undefined> {
  return [
    query || undefined,
    "Try widening the time range or adjusting the query.",
    table.feature
      ? `This organization may not have ${table.feature} enabled.`
      : "This organization may not be sending this data yet.",
  ];
}

/**
 * Sidebar badges for the Explore group, by nav label.
 *
 * The web draws a feature badge beside three of these items; the labels come
 * from the screen registry so a nav copy edit can't leave a badge orphaned.
 */
export const EXPLORE_NAV_BADGES: Readonly<Record<string, string>> = Object.fromEntries(
  EXPLORE_TABLES.filter((table) => table.badge).map((table) => [
    getScreen(table.id).item,
    table.badge!,
  ]),
);
