/**
 * Explore › Traces, Metrics, Errors and Conversations — one screen, four ways.
 *
 * These four are the same `events/` query with a different dataset and column
 * set, so they are one component reading its configuration from
 * `src/core/exploreTables.ts` via the registry entry it was handed. The layout
 * is Logs': search box, filter row, volume chart, table — through the shared
 * `SearchInput` rather than a fourth copy of Logs' own bordered box.
 *
 * A table whose config names a `traceItemType` gets a second chip row under
 * the filters: the web's Visualize / Group By / Sort By toolbar
 * (`src/ui/components/ExploreQueryBar.tsx`), which can turn the page of rows
 * into a page of aggregates. Where the builder is *held* is the one decision
 * worth stating: in this component, not in the screen's state slice. The three
 * Discover tables share that slice, and a group by on `span.op` means nothing
 * to the metrics dataset — and the web behaves the same way, since its builder
 * lives in the URL and clicking Traces in the sidebar arrives without it.
 *
 * Read-only. Enter opens an inline panel of the row's fields — including the
 * ones the terminal was too narrow to draw — and nothing here writes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { rowNumber } from "~/api/discover";
import type { ExploreEvent } from "~/api/exploreEvents";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { matchesCommand } from "~/core/commands";
import {
  defaultExploreQuery,
  parseSort,
  resolveExploreQuery,
  sumsOverTime,
  withSort,
  withToggledDirection,
  type ExploreQueryState,
} from "~/core/exploreQuery";
import {
  exploreChartTitle,
  exploreEmptyLines,
  getExploreTable,
  type ExploreTable as ExploreTableConfig,
} from "~/core/exploreTables";
import { useTheme } from "~/ui/theme";
import { countLabel } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { BarChart, CHART_ROWS, fitsChart } from "~/ui/components/BarChart";
import { DataTable } from "~/ui/components/DataTable";
import {
  ExploreQueryBar,
  QUERY_BAR_ROWS,
  type ExploreQueryDropdown,
} from "~/ui/components/ExploreQueryBar";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { SearchInput } from "~/ui/components/SearchInput";
import { fieldSortItems } from "~/ui/components/SortSelector";
import { useExploreEvents } from "~/ui/hooks/useExploreEvents";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { useTraceItemAttributes } from "~/ui/hooks/useTraceItemAttributes";
import { BOLD } from "~/ui/lib/attributes";
import {
  aggregateColumns,
  EXPLORE_MIN_FLEX,
  exploreColumnsFor,
  field,
} from "~/ui/screens/exploreColumns";
import type { ScreenProps } from "~/ui/screens/types";

/** Widest field name in the detail panel's label column. */
const DETAIL_LABEL_WIDTH = 26;

export function ExploreTable(props: ScreenProps) {
  const theme = useTheme();
  const table = getExploreTable(props.screen.id);
  // Unreachable through the registry — `test/exploreTables.test.tsx` pins the
  // two lists together — but a screen wired up without a config would
  // otherwise render an empty table that reads as a failed fetch.
  if (!table) {
    return (
      <box style={{ flexDirection: "column", paddingLeft: 1 }}>
        <text fg={theme.danger}>{`No Explore table configured for ${props.screen.id}.`}</text>
      </box>
    );
  }
  // Keyed by screen, because all four draw the same component in the same
  // slot: without it React reconciles Traces into Metrics and keeps the hook
  // state, so the new screen shows the old one's rows and chart until its own
  // fetch lands — and a chart the endpoint rejected would never be replaced.
  return <ExploreTableScreen key={table.id} {...props} table={table} />;
}

function ExploreTableScreen({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  onProjectSelect,
  registerActions,
  activateRow,
  table,
}: ScreenProps & { table: ExploreTableConfig }) {
  const theme = useTheme();
  const { setEntries, setStatus, setOpenDropdown, setDetailOpen, focusSearch, handleSearchBlur } =
    state;
  const query = state.committedQuery;
  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;

  // The builder starts on the table's own defaults and is this component's
  // own — see the module comment for why it is not in the screen's slice.
  const [builder, setBuilder] = useState<ExploreQueryState>(() => defaultExploreQuery(table));
  const [queryDropdown, setQueryDropdown] = useState<ExploreQueryDropdown>(null);
  const hasBuilder = table.traceItemType !== undefined;

  const resolved = useMemo(() => resolveExploreQuery(table, builder), [table, builder]);
  const fixedSortItems = useMemo(() => fieldSortItems(table.fields), [table.fields]);

  const attributes = useTraceItemAttributes(client, {
    org,
    itemType: table.traceItemType,
    statsPeriod: state.statsPeriod,
    project,
    environment,
  });

  const { events, timeseries } = useExploreEvents(client, table, {
    org,
    query,
    request: resolved,
    statsPeriod: state.statsPeriod,
    project,
    environment,
    reloadToken,
  });

  const loading = events.state === "loading";
  const since = loadingSince(events);

  const rows = valueOf(events);
  const error = errorOf(events);
  const buckets = valueOf(timeseries);

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      since,
      error: error?.message,
      noun: table.noun,
    });
  }, [loading, since, error, events, setStatus, table.noun]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);
  const closeQueryDropdown = useCallback(() => setQueryDropdown(null), []);

  /** Open one of the builder's menus, closing any filter menu it overlaps. */
  const openQueryDropdown = useCallback(
    (which: ExploreQueryDropdown) => {
      setOpenDropdown(null);
      setQueryDropdown(which);
    },
    [setOpenDropdown],
  );

  /**
   * Enter toggles the field panel rather than pushing a view, as the log
   * stream does: the cursor keys keep working while it is open, so there is
   * nothing to pop back out of. Escape closes it, ahead of the view stack.
   */
  useScreenActions(registerActions, {
    open: () => setDetailOpen((open) => !open),
    back: () => {
      if (!state.detailOpen) return false;
      setDetailOpen(false);
      return true;
    },
    // The builder's keys are the screen's rather than the app's: they only
    // mean anything where there is a builder, and the app has no way to know
    // which tables have one.
    handleKey: (key) => {
      if (!hasBuilder) return false;
      if (matchesCommand("sentry.explore.visualize", key)) {
        openQueryDropdown("visualize");
        return true;
      }
      if (matchesCommand("sentry.explore.visualizeField", key)) {
        openQueryDropdown("field");
        return true;
      }
      if (matchesCommand("sentry.explore.groupBy", key)) {
        openQueryDropdown("groupBy");
        return true;
      }
      if (matchesCommand("sentry.view.sort", key)) {
        openQueryDropdown("sort");
        return true;
      }
      if (matchesCommand("sentry.explore.sortDirection", key)) {
        setBuilder((current) => withToggledDirection(current, table));
        return true;
      }
      return false;
    },
  });

  /** Longest duration on the page, which the bars in the column scale to. */
  const maxDurationMs = useMemo(() => longestDuration(rows), [rows]);
  /** Largest aggregate on the page, which its own bars scale to. */
  const maxAggregate = useMemo(() => largest(rows, resolved.yAxis), [rows, resolved.yAxis]);
  const columns = useMemo(
    () =>
      resolved.mode === "aggregate"
        ? aggregateColumns(builder.groupBys, resolved.yAxis, maxAggregate, theme)
        : exploreColumnsFor(table.id, { maxDurationMs, theme }),
    [resolved.mode, resolved.yAxis, builder.groupBys, maxAggregate, table.id, maxDurationMs, theme],
  );

  const selected = rows?.[state.selected] ?? null;
  const showDetail = state.detailOpen && selected !== null;
  // The chart and the panel both want the same rows. Once a row is open, the
  // row is what is being read, so the chart yields rather than squeezing the
  // table to a handful of lines.
  const hasChart =
    !showDetail &&
    fitsChart(height, hasBuilder ? QUERY_BAR_ROWS : 0) &&
    buckets !== undefined &&
    buckets.length > 0;
  const inner = Math.max(20, width - 2);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInput
        value={state.searchQuery}
        placeholder={table.searchPlaceholder}
        focused={state.searchFocused}
        width={width}
        onInput={state.setSearchQuery}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        summaryLabel={rows ? countLabel(rows.length, rowNoun(table)) : ""}
        sort={
          hasBuilder
            ? undefined
            : {
                value: resolved.sort,
                items: fixedSortItems,
                onChange: (value) => setBuilder((current) => withSort(current, parseSort(value))),
              }
        }
        width={width}
        anchorTop={SEARCH_ROWS}
        onProjectChange={onProjectSelect}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      {hasBuilder ? (
        <ExploreQueryBar
          table={table}
          query={builder}
          attributes={attributes}
          open={queryDropdown}
          width={width}
          anchorTop={SEARCH_ROWS + QUERY_BAR_ROWS}
          onChange={setBuilder}
          onOpen={openQueryDropdown}
          onClose={closeQueryDropdown}
        />
      ) : null}

      {/*
       * The chart plots the visualize expression across the whole query, group
       * bys included but not broken out. The web draws one series per group
       * here (`useExploreTimeseries` sends `topEvents`); a terminal chart has
       * one colour of bar and no legend to tell five series apart, so it stays
       * the total — which is still the thing the aggregate column sums to.
       */}
      {hasChart && buckets ? (
        <BarChart
          buckets={buckets}
          width={inner}
          height={CHART_ROWS}
          title={exploreChartTitle(table, resolved.yAxis)}
          noun={sumsOverTime(builder.aggregate) ? table.noun : undefined}
        />
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(event, index) => `${index}:${event.id}`}
        minFlex={EXPLORE_MIN_FLEX}
        loading={isInitialLoad(events)}
        error={error}
        errorTitle={`Failed to load ${table.noun}`}
        onRowClick={activateRow}
        empty={{
          title: `No ${table.noun} found.`,
          lines: exploreEmptyLines(table, query),
        }}
        // The chart and the detail panel each shorten the viewport, so both
        // move the scroll offset.
        layout={[height, hasChart, showDetail]}
      />

      {showDetail && selected ? (
        <EventDetail event={selected} fields={resolved.fields} width={inner} />
      ) : null}
    </box>
  );
}

/**
 * Every field the query asked for, including the columns the pane was too
 * narrow to draw — which is what makes shedding safe on a screen with no
 * detail view behind it.
 */
function EventDetail({
  event,
  fields,
  width,
}: {
  event: ExploreEvent;
  /** The fields the query asked for, which in aggregate mode the user chose. */
  fields: readonly string[];
  width: number;
}) {
  const theme = useTheme();
  const valueWidth = Math.max(10, width - DETAIL_LABEL_WIDTH - 2);
  return (
    <box
      style={{
        flexDirection: "column",
        width,
        border: ["top"],
        borderColor: theme.border,
        paddingTop: 1,
        flexShrink: 0,
      }}
    >
      <text fg={theme.accent} attributes={BOLD}>
        {"▾ Row Details"}
      </text>
      {fields.map((name) => (
        <box key={name} style={{ flexDirection: "row", width }}>
          <text fg={theme.muted}>{`  ${padText(name, DETAIL_LABEL_WIDTH)}`}</text>
          <text fg={theme.text}>{fitText(displayValue(event, name), valueWidth)}</text>
        </box>
      ))}
    </box>
  );
}

/** A field's value for the panel, with a dash standing in for an absent one. */
function displayValue(event: ExploreEvent, name: string): string {
  const value = field(event, name);
  return value === "" ? "—" : value.replace(/\s+/g, " ");
}

/** Largest value of one numeric field on the page, or 0 when it has none. */
function largest(rows: readonly ExploreEvent[] | undefined, name: string): number {
  let max = 0;
  for (const row of rows ?? []) {
    const value = rowNumber(row.row, name);
    if (value !== undefined && value > max) max = value;
  }
  return max;
}

/** Longest `span.duration` on the page, or 0 when the dataset has none. */
function longestDuration(rows: readonly ExploreEvent[] | undefined): number {
  if (!rows) return 0;
  let max = 0;
  for (const row of rows) {
    const value = Number(row.row["span.duration"]);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/**
 * The singular of the table's noun, for the row count.
 *
 * `countLabel` pluralises, and the config's noun is already plural because the
 * status bar says "loading spans…".
 */
function rowNoun(table: ExploreTableConfig): string {
  return table.noun.endsWith("s") ? table.noun.slice(0, -1) : table.noun;
}
