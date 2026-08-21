/**
 * Explore's query builder — Visualize, Group By and Sort By, as data.
 *
 * The web puts a toolbar beside the Traces table
 * (`views/explore/toolbar/index.tsx`) that decides *what the query asks for*
 * rather than which rows come back: an aggregate to plot and tabulate, the
 * attributes to group it by, and the column the result is ordered on. This
 * module is that toolbar with the widgets taken off — the option lists, the
 * rules for keeping a selection valid as the aggregate changes, and the one
 * function that turns a builder state into the `field[]`/`sort` an `events/`
 * request wants.
 *
 * The two modes are the whole point. With no group by, the query is the
 * table's own sample columns — a page of spans. Add one and the same endpoint
 * answers aggregates instead: the group-by attributes plus the visualize
 * expression, one row per group. The web calls these `Mode.SAMPLES` and
 * `Mode.AGGREGATE` (`contexts/pageParamsContext/mode.tsx`) and switches on the
 * group-by list exactly as `exploreMode` does here.
 *
 * Everything is pure and free of React so `test/exploreQuery.test.ts` can
 * assert the request shape without rendering a screen. Which *attributes* are
 * on offer is not here — that is an org's data, fetched by
 * `src/api/traceItemAttributes.ts`.
 */

import type { ExploreTable } from "~/core/exploreTables";

/** Sort direction, spelled as the web's `Sort['kind']` spells it. */
export type SortDirection = "asc" | "desc";

export interface ExploreSort {
  /** A field of the current mode's result — a column, a group by, or the yAxis. */
  field: string;
  direction: SortDirection;
}

/**
 * What the builder is set to.
 *
 * A sort is held per mode, as the web holds `sortBys` and `aggregateSortBys`
 * separately: the two modes return different columns, so one shared sort would
 * be invalid every time the group-by list emptied. `null` means "whatever the
 * mode defaults to" rather than a value, so a table's own `-timestamp` keeps
 * applying until the user picks something else.
 */
export interface ExploreQueryState {
  /** Aggregate function name, e.g. `count` or `p95`. */
  aggregate: string;
  /** Its argument, or `""` for the aggregates that take none. */
  argument: string;
  /** Attributes to group by. Non-empty is what puts the query in aggregate mode. */
  groupBys: readonly string[];
  sampleSort: ExploreSort | null;
  aggregateSort: ExploreSort | null;
}

export type ExploreMode = "samples" | "aggregate";

/** What an aggregate takes between its parentheses. */
export type AggregateArgumentKind =
  /** Nothing: `epm()`. */
  | "none"
  /** Spans themselves. `count` is offered one field and labelled "spans". */
  | "spans"
  /** Any numeric attribute. */
  | "number"
  /** Any attribute at all — `count_unique` is the only one. */
  | "any"
  /** One of the `measurements.score.*` web vitals. */
  | "score";

export interface ExploreAggregate {
  name: string;
  argument: AggregateArgumentKind;
}

/** The field `count` is offered, and the fallback argument for a numeric one. */
export const DEFAULT_VISUALIZE_FIELD = "span.duration";
/** What `count_unique` resets to — `updateVisualizeAggregate` hard-codes it too. */
const DEFAULT_UNIQUE_FIELD = "span.op";
/** What the two score aggregates default to, from their `defaultValue`. */
const DEFAULT_SCORE_FIELD = "measurements.score.total";
/** Prefix of the attributes the score aggregates accept. */
const SCORE_PREFIX = "measurements.score.";

/**
 * The aggregates Explore offers, in the web's own order.
 *
 * `ALLOWED_EXPLORE_VISUALIZE_AGGREGATES` (`utils/fields/index.ts:1086`)
 * verbatim, and each one's argument kind is read off its entry in
 * `SPAN_AGGREGATION_FIELDS` in the same file: no `parameters` means no
 * argument, a `[STRING]` column type means `count_unique`, and the score pair
 * restrict their column to the web vitals.
 */
export const EXPLORE_AGGREGATES: readonly ExploreAggregate[] = [
  { name: "count", argument: "spans" },
  { name: "avg", argument: "number" },
  { name: "p50", argument: "number" },
  { name: "p75", argument: "number" },
  { name: "p90", argument: "number" },
  { name: "p95", argument: "number" },
  { name: "p99", argument: "number" },
  { name: "p100", argument: "number" },
  { name: "sum", argument: "number" },
  { name: "min", argument: "number" },
  { name: "max", argument: "number" },
  { name: "count_unique", argument: "any" },
  { name: "epm", argument: "none" },
  { name: "eps", argument: "none" },
  { name: "failure_rate", argument: "none" },
  { name: "failure_count", argument: "none" },
  { name: "performance_score", argument: "score" },
  { name: "opportunity_score", argument: "score" },
];

const AGGREGATES_BY_NAME = new Map(EXPLORE_AGGREGATES.map((a) => [a.name, a]));

/** What the named aggregate takes as an argument; `number` for an unknown one. */
export function argumentKind(aggregate: string): AggregateArgumentKind {
  return AGGREGATES_BY_NAME.get(aggregate)?.argument ?? "number";
}

/**
 * Attributes the group-by list will not offer.
 *
 * `DISALLOWED_GROUP_BY_FIELDS` (`hooks/useGroupByFields.tsx`) — grouping by a
 * span id or a timestamp produces one group per row, which is the sample table
 * with extra steps.
 */
export const DISALLOWED_GROUP_BYS: ReadonlySet<string> = new Set(["id", "timestamp"]);

// ---------------------------------------------------------------------------
// Reading and writing the state
// ---------------------------------------------------------------------------

/** Split `p95(span.duration)` into its two halves. Bare text is a no-arg call. */
export function parseAggregateExpression(yAxis: string): { aggregate: string; argument: string } {
  const match = /^([a-zA-Z0-9_]+)\((.*)\)$/.exec(yAxis.trim());
  if (!match) return { aggregate: yAxis.trim(), argument: "" };
  return { aggregate: match[1]!, argument: match[2]!.trim() };
}

/** The `yAxis` a builder state asks for, e.g. `p95(span.duration)`. */
export function exploreYAxis(state: ExploreQueryState): string {
  return `${state.aggregate}(${argumentKind(state.aggregate) === "none" ? "" : state.argument})`;
}

/** The builder as a table first opens it: the config's own chart and sort. */
export function defaultExploreQuery(table: ExploreTable): ExploreQueryState {
  const { aggregate, argument } = parseAggregateExpression(table.yAxis);
  return { aggregate, argument, groupBys: [], sampleSort: null, aggregateSort: null };
}

/** Grouping by anything switches the query from rows to aggregates. */
export function exploreMode(state: ExploreQueryState): ExploreMode {
  return state.groupBys.length > 0 ? "aggregate" : "samples";
}

/**
 * Change the aggregate, carrying the argument across when it still means
 * something.
 *
 * `updateVisualizeAggregate` (`contexts/pageParamsContext/visualizes.tsx`)
 * rule for rule: `count` has exactly one field, `count_unique` takes a string
 * and resets to `span.op`, the no-argument aggregates drop theirs, the score
 * pair keep an argument only if it is a web vital — and anything else keeps
 * what was there, unless what was there belonged to an aggregate of a
 * different shape.
 */
export function withAggregate(state: ExploreQueryState, aggregate: string): ExploreQueryState {
  return repointSort(state, {
    ...state,
    aggregate,
    argument: argumentFor(aggregate, state),
  });
}

/** Change the aggregate's argument, leaving the function itself alone. */
export function withArgument(state: ExploreQueryState, argument: string): ExploreQueryState {
  return repointSort(state, { ...state, argument });
}

/**
 * Follow the visualize expression with the sort that was pointing at it.
 *
 * Aggregate rows are sorted by the yAxis by default, and by the yAxis by name
 * when the user picked it — so changing `p95` to `avg` would otherwise leave
 * the query ordered on a column it no longer returns.
 */
function repointSort(previous: ExploreQueryState, next: ExploreQueryState): ExploreQueryState {
  const sort = next.aggregateSort;
  if (!sort || sort.field !== exploreYAxis(previous)) return next;
  return { ...next, aggregateSort: { ...sort, field: exploreYAxis(next) } };
}

function argumentFor(aggregate: string, previous: ExploreQueryState): string {
  const kind = argumentKind(aggregate);
  const wasKind = argumentKind(previous.aggregate);
  if (kind === "none") return "";
  if (kind === "spans") return DEFAULT_VISUALIZE_FIELD;
  if (kind === "any") return DEFAULT_UNIQUE_FIELD;
  if (kind === "score") {
    return previous.argument.startsWith(SCORE_PREFIX) ? previous.argument : DEFAULT_SCORE_FIELD;
  }
  // A numeric aggregate: the previous argument only transfers if it was also
  // being read as a number.
  if (wasKind === "none" || wasKind === "any" || previous.argument === "") {
    return DEFAULT_VISUALIZE_FIELD;
  }
  return previous.argument;
}

/**
 * Replace the group-by list, dropping a sort the new one invalidates.
 *
 * Ordering by an attribute that is no longer a column is a 400 from `events/`,
 * so the sort falls back to the mode's default rather than being carried into
 * a query that cannot run.
 */
export function withGroupBys(
  state: ExploreQueryState,
  groupBys: readonly string[],
  table: ExploreTable,
): ExploreQueryState {
  const next: ExploreQueryState = { ...state, groupBys: groupBys.filter(Boolean) };
  const sort = next.aggregateSort;
  if (sort && !sortOptions(next, table).includes(sort.field)) {
    return { ...next, aggregateSort: null };
  }
  return next;
}

/** Set the sort for whichever mode the builder is in. */
export function withSort(state: ExploreQueryState, sort: ExploreSort): ExploreQueryState {
  return exploreMode(state) === "aggregate"
    ? { ...state, aggregateSort: sort }
    : { ...state, sampleSort: sort };
}

/** Flip the current mode's sort between ascending and descending. */
export function withToggledDirection(
  state: ExploreQueryState,
  table: ExploreTable,
): ExploreQueryState {
  const current = effectiveSort(state, table);
  return withSort(state, {
    field: current.field,
    direction: current.direction === "desc" ? "asc" : "desc",
  });
}

// ---------------------------------------------------------------------------
// Resolving to a request
// ---------------------------------------------------------------------------

/** The sort in force: what the user picked, or the mode's default. */
export function effectiveSort(state: ExploreQueryState, table: ExploreTable): ExploreSort {
  if (exploreMode(state) === "aggregate") {
    return state.aggregateSort ?? { field: exploreYAxis(state), direction: "desc" };
  }
  return state.sampleSort ?? parseSort(table.sort);
}

/** `-timestamp` → `{field: "timestamp", direction: "desc"}`. */
export function parseSort(sort: string): ExploreSort {
  return sort.startsWith("-")
    ? { field: sort.slice(1), direction: "desc" }
    : { field: sort, direction: "asc" };
}

/** A sort back in the wire's `-field` spelling. */
export function formatSort(sort: ExploreSort): string {
  return sort.direction === "desc" ? `-${sort.field}` : sort.field;
}

/**
 * Fields the sort chip can offer, which is whatever the query returns.
 *
 * `useSortByFields` — the sample columns in one mode, and the visualize plus
 * the group bys in the other.
 */
export function sortOptions(state: ExploreQueryState, table: ExploreTable): string[] {
  if (exploreMode(state) === "samples") return [...table.fields];
  return unique([exploreYAxis(state), ...state.groupBys]);
}

/** Everything a request needs that the builder decides. */
export interface ResolvedExploreQuery {
  mode: ExploreMode;
  /** Columns to request, group bys first — the order the table draws them in. */
  fields: readonly string[];
  /** Sort in the wire's `-field` spelling. */
  sort: string;
  /** Aggregate plotted above the table. */
  yAxis: string;
  /** Field carrying a row's identity; aggregate rows have none. */
  idField: string;
}

/**
 * Turn a builder state into the request the screen makes.
 *
 * In aggregate mode the columns are the group bys followed by the visualize
 * expression, matching `useExploreAggregatesTable`'s "group bys first, then
 * the aggregates". Its two extra `any()` columns are left out: they exist to
 * give the web a trace to link a group to, and nothing here links.
 */
export function resolveExploreQuery(
  table: ExploreTable,
  state: ExploreQueryState,
): ResolvedExploreQuery {
  const yAxis = exploreYAxis(state);
  const mode = exploreMode(state);
  const sort = formatSort(effectiveSort(state, table));
  if (mode === "samples") {
    return { mode, fields: table.fields, sort, yAxis, idField: table.idField };
  }
  return {
    mode,
    fields: unique([...state.groupBys, yAxis]),
    sort,
    yAxis,
    idField: state.groupBys[0] ?? "",
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * What the argument chip shows.
 *
 * `count` and the no-argument aggregates both read as "spans" in the web's own
 * field list — `count(span.duration)` counts spans, and saying so is more use
 * than naming a duration nothing is measuring.
 */
export function argumentLabel(state: ExploreQueryState): string {
  const kind = argumentKind(state.aggregate);
  return kind === "none" || kind === "spans" ? "spans" : state.argument || "—";
}

/** What the group-by chip shows: the attribute, a count of them, or a dash. */
export function groupByLabel(state: ExploreQueryState): string {
  if (state.groupBys.length === 0) return "—";
  if (state.groupBys.length === 1) return state.groupBys[0]!;
  return `${state.groupBys.length} groups`;
}

/**
 * Whether adding an aggregate's buckets together says anything.
 *
 * The chart's total is a sum over the period, which is a real number for a
 * count and nonsense for a percentile — twelve p95s do not add up to a p95,
 * and neither do twelve rates or twelve distinct-value counts.
 */
export function sumsOverTime(aggregate: string): boolean {
  return aggregate === "count" || aggregate === "failure_count";
}

/** Attributes the score aggregates accept, out of everything on offer. */
export function isScoreAttribute(key: string): boolean {
  return key.startsWith(SCORE_PREFIX);
}
