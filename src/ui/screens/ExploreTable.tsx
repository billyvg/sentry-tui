/**
 * Explore › Traces, Metrics, Errors and Conversations — one screen, four ways.
 *
 * These four are the same `events/` query with a different dataset and column
 * set, so they are one component reading its configuration from
 * `src/core/exploreTables.ts` via the registry entry it was handed. The layout
 * is Logs': search box, filter row, volume chart, table — through the shared
 * `SearchInput` rather than a fourth copy of Logs' own bordered box.
 *
 * Read-only. Enter opens an inline panel of the row's fields — including the
 * ones the terminal was too narrow to draw — and nothing here writes.
 */

import { useCallback, useEffect, useMemo } from "react";

import type { ExploreEvent } from "~/api/exploreEvents";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import {
  exploreChartTitle,
  exploreEmptyLines,
  getExploreTable,
  type ExploreTable as ExploreTableConfig,
} from "~/core/exploreTables";
import { theme } from "~/core/theme";
import { countLabel } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { BarChart, CHART_ROWS, fitsChart } from "~/ui/components/BarChart";
import { DataTable } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { SearchInput } from "~/ui/components/SearchInput";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useExploreEvents } from "~/ui/hooks/useExploreEvents";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import { EXPLORE_MIN_FLEX, exploreColumnsFor, field } from "~/ui/screens/exploreColumns";
import type { ScreenProps } from "~/ui/screens/types";

/** Widest field name in the detail panel's label column. */
const DETAIL_LABEL_WIDTH = 26;

export function ExploreTable(props: ScreenProps) {
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
  registerActions,
  activateRow,
  table,
}: ScreenProps & { table: ExploreTableConfig }) {
  const { setEntries, setStatus, setOpenDropdown, setDetailOpen, focusSearch, handleSearchBlur } =
    state;
  const query = state.committedQuery;
  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;

  const { events, timeseries } = useExploreEvents(client, table, {
    org,
    query,
    statsPeriod: state.statsPeriod,
    project,
    environment,
    reloadToken,
  });

  const loading = events.state === "loading";
  const since = events.state === "loading" ? events.since : undefined;
  const elapsed = useElapsed(loading, since);

  const rows = valueOf(events);
  const error = errorOf(events);
  const buckets = valueOf(timeseries);

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      elapsedMs: elapsed ?? elapsedMs(events, Date.now()),
      error: error?.message,
      noun: table.noun,
    });
  }, [loading, elapsed, error, events, setStatus, table.noun]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

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
  });

  /** Longest duration on the page, which the bars in the column scale to. */
  const maxDurationMs = useMemo(() => longestDuration(rows), [rows]);
  const columns = useMemo(
    () => exploreColumnsFor(table.id, { maxDurationMs }),
    [table.id, maxDurationMs],
  );

  const selected = rows?.[state.selected] ?? null;
  const showDetail = state.detailOpen && selected !== null;
  // The chart and the panel both want the same rows. Once a row is open, the
  // row is what is being read, so the chart yields rather than squeezing the
  // table to a handful of lines.
  const hasChart = !showDetail && fitsChart(height) && buckets !== undefined && buckets.length > 0;
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
        sortLabel={rows ? countLabel(rows.length, rowNoun(table)) : ""}
        width={width}
        anchorTop={SEARCH_ROWS}
        onProjectChange={state.setSelectedProjects}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      {hasChart && buckets ? (
        <BarChart
          buckets={buckets}
          width={inner}
          height={CHART_ROWS}
          title={exploreChartTitle(table)}
          noun={table.noun}
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

      {showDetail && selected ? <EventDetail event={selected} table={table} width={inner} /> : null}
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
  table,
  width,
}: {
  event: ExploreEvent;
  table: ExploreTableConfig;
  width: number;
}) {
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
      {table.fields.map((name) => (
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
