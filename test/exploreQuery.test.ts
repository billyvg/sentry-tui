/**
 * The Explore query builder's rules, without a screen.
 *
 * What is asserted here is the request: which columns a state asks for, what
 * it sorts on, and what happens to a selection that the next selection makes
 * invalid. Those are the three ways a builder can produce a query the API
 * rejects, and none of them need a renderer to check.
 */

import { describe, expect, test } from "bun:test";

import {
  argumentKind,
  argumentLabel,
  availableExploreAggregates,
  defaultExploreQuery,
  effectiveSort,
  exploreMode,
  exploreYAxis,
  formatSort,
  groupByLabel,
  parseAggregateExpression,
  parseSort,
  resolveExploreQuery,
  sortOptions,
  withAggregate,
  withArgument,
  withGroupBys,
  withSort,
  withToggledDirection,
  EXPLORE_AGGREGATES,
} from "~/core/exploreQuery";
import { EXPLORE_TABLES, getExploreTable, type ExploreTable } from "~/core/exploreTables";

const TRACES: ExploreTable = getExploreTable("explore.traces")!;
const LOGS: ExploreTable = getExploreTable("explore.logs")!;
const METRICS: ExploreTable = getExploreTable("explore.metrics")!;

describe("parsing", () => {
  test("splits an aggregate expression into function and argument", () => {
    expect(parseAggregateExpression("p95(span.duration)")).toEqual({
      aggregate: "p95",
      argument: "span.duration",
    });
    expect(parseAggregateExpression("count()")).toEqual({ aggregate: "count", argument: "" });
  });

  test("a sort round-trips through its wire spelling", () => {
    expect(parseSort("-timestamp")).toEqual({ field: "timestamp", direction: "desc" });
    expect(parseSort("timestamp")).toEqual({ field: "timestamp", direction: "asc" });
    expect(formatSort({ field: "timestamp", direction: "desc" })).toBe("-timestamp");
    expect(formatSort({ field: "timestamp", direction: "asc" })).toBe("timestamp");
  });

  test("the builder starts on the table's own chart and sort", () => {
    const state = defaultExploreQuery(TRACES);
    expect(exploreYAxis(state)).toBe(TRACES.yAxis);
    expect(state.groupBys).toEqual([]);
    expect(formatSort(effectiveSort(state, TRACES))).toBe(TRACES.sort);
  });
});

describe("aggregates", () => {
  test("every offered aggregate produces a callable expression", () => {
    for (const { name } of EXPLORE_AGGREGATES) {
      const state = withAggregate(defaultExploreQuery(TRACES), name, TRACES);
      const yAxis = exploreYAxis(state);
      expect({ name, yAxis }).toEqual({ name, yAxis: `${name}(${state.argument})` });
      // A no-argument aggregate is the only one allowed to be empty inside.
      expect({ name, empty: state.argument === "" }).toEqual({
        name,
        empty: argumentKind(name) === "none",
      });
    }
  });

  test("count is offered exactly one field, and it is span.duration", () => {
    const state = withAggregate(defaultExploreQuery(TRACES), "count", TRACES);
    expect(exploreYAxis(state)).toBe("count(span.duration)");
    expect(argumentLabel(state, TRACES)).toBe("spans");
  });

  test("count_unique resets to a string attribute, as the web hard-codes", () => {
    const state = withAggregate(defaultExploreQuery(TRACES), "count_unique", TRACES);
    expect(exploreYAxis(state)).toBe("count_unique(span.op)");
  });

  test("a numeric aggregate carries a numeric argument across", () => {
    let state = withAggregate(defaultExploreQuery(TRACES), "p95", TRACES);
    state = withArgument(state, "span.self_time");
    expect(exploreYAxis(withAggregate(state, "avg", TRACES))).toBe("avg(span.self_time)");
  });

  test("switching away from count_unique resets rather than carrying a string", () => {
    const unique = withAggregate(defaultExploreQuery(TRACES), "count_unique", TRACES);
    expect(exploreYAxis(withAggregate(unique, "avg", TRACES))).toBe("avg(span.duration)");
  });

  test("the score aggregates only keep an argument that is a web vital", () => {
    const state = withAggregate(defaultExploreQuery(TRACES), "performance_score", TRACES);
    expect(exploreYAxis(state)).toBe("performance_score(measurements.score.total)");
    const kept = withAggregate(
      withArgument(state, "measurements.score.cls"),
      "opportunity_score",
      TRACES,
    );
    expect(exploreYAxis(kept)).toBe("opportunity_score(measurements.score.cls)");
  });

  test("a no-argument aggregate drops the argument and the label says spans", () => {
    const state = withAggregate(defaultExploreQuery(TRACES), "failure_rate", TRACES);
    expect(exploreYAxis(state)).toBe("failure_rate()");
    expect(argumentLabel(state, TRACES)).toBe("spans");
  });

  test("Metrics keeps count on value and resets numeric functions to value", () => {
    const unique = withAggregate(defaultExploreQuery(METRICS), "count_unique", METRICS);
    expect(exploreYAxis(unique)).toBe("count_unique(metric.name)");
    expect(exploreYAxis(withAggregate(unique, "avg", METRICS))).toBe("avg(value)");
    expect(exploreYAxis(withAggregate(unique, "count", METRICS))).toBe("count(value)");
    expect(argumentLabel(defaultExploreQuery(METRICS), METRICS)).toBe("metrics");
  });

  test("Logs uses message for counts and a reported attribute for numbers", () => {
    const initial = defaultExploreQuery(LOGS);
    expect(exploreYAxis(initial)).toBe("count(message)");
    expect(exploreYAxis(withAggregate(initial, "count_unique", LOGS))).toBe(
      "count_unique(message)",
    );
    expect(exploreYAxis(withAggregate(initial, "avg", LOGS, ["duration_ms"]))).toBe(
      "avg(duration_ms)",
    );
  });

  test("Logs and Metrics do not offer span-only aggregates", () => {
    const metrics = availableExploreAggregates(METRICS).map(({ name }) => name);
    const logsBeforeAttributes = availableExploreAggregates(LOGS).map(({ name }) => name);
    const logsWithNumbers = availableExploreAggregates(LOGS, ["duration_ms"]).map(
      ({ name }) => name,
    );

    expect(metrics).toContain("avg");
    expect(metrics).not.toContain("failure_rate");
    expect(logsBeforeAttributes).toEqual(["count", "count_unique"]);
    expect(logsWithNumbers).toContain("avg");
    expect(logsWithNumbers).not.toContain("performance_score");
  });

  test("every configured aggregate exists in the catalog", () => {
    for (const table of EXPLORE_TABLES) {
      if (!table.builder) continue;
      expect(
        availableExploreAggregates(table, ["reported.number"]).map(({ name }) => name),
      ).toEqual([...table.builder.aggregates]);
    }
  });
});

describe("modes", () => {
  test("no group by is a page of samples, and the table's own columns", () => {
    const state = defaultExploreQuery(TRACES);
    expect(exploreMode(state)).toBe("samples");
    const resolved = resolveExploreQuery(TRACES, state);
    expect(resolved.fields).toEqual(TRACES.fields);
    expect(resolved.sort).toBe(TRACES.sort);
    expect(resolved.idField).toBe(TRACES.idField);
  });

  test("a group by asks for the groups and the aggregate instead", () => {
    const state = withGroupBys(defaultExploreQuery(TRACES), ["span.op"], TRACES);
    expect(exploreMode(state)).toBe("aggregate");
    const resolved = resolveExploreQuery(TRACES, state);
    expect(resolved.fields).toEqual(["span.op", "count(span.duration)"]);
    expect(resolved.sort).toBe("-count(span.duration)");
    expect(resolved.yAxis).toBe("count(span.duration)");
  });

  test("group bys lead the columns, in the order they were added", () => {
    const state = withGroupBys(defaultExploreQuery(TRACES), ["span.op", "transaction"], TRACES);
    expect(resolveExploreQuery(TRACES, state).fields).toEqual([
      "span.op",
      "transaction",
      "count(span.duration)",
    ]);
  });

  test("a group by that is also the aggregate is asked for once", () => {
    let state = withAggregate(defaultExploreQuery(TRACES), "count_unique", TRACES);
    state = withGroupBys(state, ["span.op"], TRACES);
    expect(resolveExploreQuery(TRACES, state).fields).toEqual(["span.op", "count_unique(span.op)"]);
  });

  test("clearing the group bys goes back to samples and the sample sort", () => {
    let state = withGroupBys(defaultExploreQuery(TRACES), ["span.op"], TRACES);
    state = withSort(state, { field: "span.op", direction: "asc" });
    state = withGroupBys(state, [], TRACES);
    expect(exploreMode(state)).toBe("samples");
    expect(resolveExploreQuery(TRACES, state).sort).toBe(TRACES.sort);
  });

  test("an empty group by is not a group by", () => {
    expect(exploreMode(withGroupBys(defaultExploreQuery(TRACES), [""], TRACES))).toBe("samples");
  });
});

describe("sorting", () => {
  test("each mode offers the columns that mode actually returns", () => {
    const samples = defaultExploreQuery(TRACES);
    expect(sortOptions(samples, TRACES)).toEqual([...TRACES.fields]);

    const aggregate = withGroupBys(samples, ["span.op"], TRACES);
    expect(sortOptions(aggregate, TRACES)).toEqual(["count(span.duration)", "span.op"]);
  });

  test("each mode remembers its own sort", () => {
    let state = withSort(defaultExploreQuery(TRACES), {
      field: "span.duration",
      direction: "asc",
    });
    state = withGroupBys(state, ["span.op"], TRACES);
    expect(resolveExploreQuery(TRACES, state).sort).toBe("-count(span.duration)");

    state = withSort(state, { field: "span.op", direction: "asc" });
    expect(resolveExploreQuery(TRACES, state).sort).toBe("span.op");

    state = withGroupBys(state, [], TRACES);
    expect(resolveExploreQuery(TRACES, state).sort).toBe("span.duration");
  });

  test("the direction toggles without losing the field", () => {
    const state = withToggledDirection(defaultExploreQuery(TRACES), TRACES);
    expect(effectiveSort(state, TRACES)).toEqual({ field: "timestamp", direction: "asc" });
    expect(effectiveSort(withToggledDirection(state, TRACES), TRACES)).toEqual({
      field: "timestamp",
      direction: "desc",
    });
  });

  test("a sort on the aggregate follows it when the aggregate changes", () => {
    let state = withGroupBys(defaultExploreQuery(TRACES), ["span.op"], TRACES);
    state = withSort(state, { field: "count(span.duration)", direction: "asc" });
    state = withAggregate(state, "p95", TRACES);
    expect(resolveExploreQuery(TRACES, state).sort).toBe("p95(span.duration)");
  });

  test("dropping the group by a sort names falls back to the default", () => {
    let state = withGroupBys(defaultExploreQuery(TRACES), ["span.op", "transaction"], TRACES);
    state = withSort(state, { field: "transaction", direction: "asc" });
    state = withGroupBys(state, ["span.op"], TRACES);
    expect(resolveExploreQuery(TRACES, state).sort).toBe("-count(span.duration)");
  });
});

describe("labels", () => {
  test("the group-by chip counts what it cannot name", () => {
    const state = defaultExploreQuery(TRACES);
    expect(groupByLabel(state)).toBe("—");
    expect(groupByLabel(withGroupBys(state, ["span.op"], TRACES))).toBe("span.op");
    expect(groupByLabel(withGroupBys(state, ["span.op", "transaction"], TRACES))).toBe("2 groups");
  });
});
