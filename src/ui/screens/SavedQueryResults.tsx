/**
 * A saved query's results, as a view on the stack.
 *
 * `Issues › All Views` is the precedent: opening a saved thing pushes its
 * *results* as a stateful view, seeded with the filters it was saved with, so
 * the list on top of it has a cursor, a search bar and a filter row like any
 * screen, and Escape drops back to the list with its cursor where it was.
 *
 * The table is built from the saved query's own `fields`, `dataset` and sort
 * rather than borrowing another screen's fixed columns — a saved query carries
 * the columns it was saved with, and the web honours them too
 * (`getSavedQueryTraceItemUrl` navigates with the query's fields). That is also
 * what lets one view run a logs query, a spans query and a legacy Discover
 * query without knowing which it has.
 */

import { useEffect, useMemo } from "react";

import type { DiscoverRow } from "~/api/discover";
import type { SavedQuery } from "~/api/savedQueries";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { SAVED_QUERY_RESULTS_STATE_KEY } from "~/core/savedQueryScreens";
import { useTheme } from "~/ui/theme";
import type { Theme } from "~/core/theme";
import { fitText, measureTextWidth, padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { ResultFooter } from "~/ui/components/ResultFooter";
import { SearchInput } from "~/ui/components/SearchInput";
import { fieldSortItems } from "~/ui/components/SortSelector";
import { useDiscoverRows } from "~/ui/hooks/useDiscoverRows";
import type { ScreenState } from "~/ui/hooks/useScreenState";
import { BOLD } from "~/ui/lib/attributes";
import type { DetailContext, ViewStackEntry } from "~/ui/screens/types";

/**
 * A saved query's results, ready to push.
 *
 * @param query The row Enter was pressed on.
 * @param projectSlugs Its projects, already resolved from ids — the list
 *   screen has the mapping loaded, and this view has no business refetching it.
 */
export function savedQueryResultsView(query: SavedQuery, projectSlugs: string[]): ViewStackEntry {
  return {
    id: `saved-query:${query.source}:${query.id}`,
    label: query.name,
    stateKey: SAVED_QUERY_RESULTS_STATE_KEY,
    // The query opens on *its* filters, not on whatever the last one left in
    // the shared slice.
    initialState: {
      query: query.query,
      sort: query.sort,
      statsPeriod: query.statsPeriod,
      selectedProjects: projectSlugs,
      selectedEnvs: query.environment,
    },
    render: (ctx) =>
      ctx.state ? <SavedQueryResults {...ctx} state={ctx.state} query={query} /> : null,
  };
}

function SavedQueryResults({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  query: savedQuery,
}: DetailContext & { state: ScreenState; query: SavedQuery }) {
  const theme = useTheme();
  const { setEntries, setStatus, setOpenDropdown, focusSearch, handleSearchBlur } = state;

  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;
  const sortItems = useMemo(() => fieldSortItems(savedQuery.fields), [savedQuery.fields]);
  const sort = sortItems.some((item) => item.value === state.sort)
    ? state.sort
    : (savedQuery.sort ?? sortItems[0]?.value);

  const { rows: status, nextCursor } = useDiscoverRows(client, {
    org,
    dataset: savedQuery.dataset,
    fields: savedQuery.fields,
    sort,
    query: state.committedQuery,
    statsPeriod: state.statsPeriod,
    project,
    environment,
    referrer: "sentry-tui.saved-query",
    reloadToken,
  });

  const rows = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";
  const since = loadingSince(status);

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      since,
      error: error?.message,
      noun: "results",
    });
  }, [loading, since, error, status, setStatus]);

  const columns = useMemo(() => columnsFor(savedQuery.fields, theme), [savedQuery.fields, theme]);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInput
        value={state.searchQuery}
        placeholder="Refine this query…"
        focused={state.searchFocused}
        width={width}
        onInput={state.setSearchQuery}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      <box style={{ flexDirection: "row", width, flexShrink: 0, height: 1, paddingLeft: 1 }}>
        <text fg={theme.accent} attributes={BOLD}>
          {fitText(savedQuery.name, Math.max(8, width - 24))}
        </text>
        <text fg={theme.muted}>{`  ${savedQuery.datasetLabel}`}</text>
      </box>

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sort={sort ? { value: sort, items: sortItems, onChange: state.setSort } : undefined}
        width={width}
        anchorTop={SEARCH_ROWS + 1}
        onProjectChange={state.setSelectedProjects}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={() => setOpenDropdown(null)}
        onDropdownOpen={setOpenDropdown}
      />

      <DataTable
        rows={rows}
        columns={columns}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(_row, index) => String(index)}
        loading={isInitialLoad(status)}
        error={error}
        errorTitle="Failed to run the query"
        minFlex={MIN_PROSE_WIDTH}
        empty={{
          title: "This query returned nothing.",
          lines: [
            state.committedQuery || undefined,
            "Try widening the time range or adjusting the query.",
            `This organization may not have ${savedQuery.datasetLabel} enabled.`,
          ],
        }}
        layout={[height]}
      />
      <ResultFooter count={rows?.length} noun="result" hasMore={nextCursor !== null} />
    </box>
  );
}

// ---------------------------------------------------------------------------
// Columns from a saved query's fields
// ---------------------------------------------------------------------------

/** Cells a field of known shape is worth, matched against the field name. */
const FIELD_WIDTHS: ReadonlyArray<{ test: RegExp; width: number; align?: "right" }> = [
  { test: /timestamp|^time$/, width: 19 },
  { test: /^project(\.\w+)?$/, width: 14 },
  { test: /^(id|trace|replay_id|profile\.id)$|_id$/, width: 12 },
  // An aggregate — `count()`, `p95(span.duration)` — is always a number.
  { test: /\(.*\)/, width: 12, align: "right" },
  { test: /duration|latency|size|count/, width: 10, align: "right" },
  { test: /^(release|environment|platform|user|browser|os)(\.\w+)?$/, width: 16 },
];

/** Fields whose content is prose and should take whatever the row has left. */
const FLEX_FIELDS =
  /^(message|description|name|transaction|title|url|culprit)$|\.(description|name)$/;

/** Default for a field nothing else matched. */
const DEFAULT_FIELD_WIDTH = 18;

/**
 * Widest a column will be stretched to fit its own header.
 *
 * The header *is* the field name here — there is no friendly label for an
 * arbitrary saved field — so a column narrower than its name reads as
 * `span.dura…`, which names nothing. Sizing up to the name fixes that; the cap
 * stops a long aggregate from taking the row hostage.
 */
const MAX_HEADER_WIDTH = 20;

/**
 * Cells the flex column needs before the row is worth reading.
 *
 * Without it a narrow pane technically fits — every fixed column keeps its
 * width and the message is squeezed to eight cells of `POST /a…` — which is
 * the one outcome worse than shedding a column.
 */
export const MIN_PROSE_WIDTH = 24;

/**
 * Turn a saved query's field list into table columns.
 *
 * The web can let a column grow to its content; a terminal cannot, so widths
 * come from what a field name says about its values. Exactly one column is
 * flex — otherwise short fields would leave the row ending in whitespace — and
 * every other column can shed, rightmost first, because the leading field of a
 * saved query is as often an opaque id as it is a name.
 */
function columnsFor(fields: readonly string[], theme: Theme): ReadonlyArray<Column<DiscoverRow>> {
  const shapes = fields.map((field) => {
    const match = FIELD_WIDTHS.find((candidate) => candidate.test.test(field));
    return {
      field,
      width: Math.max(
        match?.width ?? DEFAULT_FIELD_WIDTH,
        Math.min(measureTextWidth(field), MAX_HEADER_WIDTH),
      ),
      align: match?.align,
      wide: FLEX_FIELDS.test(field),
      /** Nothing in the table matched, so nothing is known about its values. */
      unknown: match === undefined,
    };
  });

  // Prefer a prose column for the flex slot, then the first column nothing had
  // an opinion about, and fall back to the last column so a row of purely
  // narrow fields still fills its width.
  const flexAt = pick(
    shapes.findIndex((shape) => shape.wide),
    shapes.findIndex((shape) => shape.unknown),
    shapes.length - 1,
  );

  return shapes.map((shape, index) => ({
    key: shape.field,
    label: shape.field,
    width: index === flexAt ? ("flex" as const) : shape.width,
    align: shape.align,
    // Rightmost sheds first; only the flex column is never shed.
    priority: index === flexAt ? undefined : shapes.length - index,
    render: (row: DiscoverRow, _selected: boolean, width: number) => (
      <text fg={index === 0 ? theme.text : theme.muted}>
        {padText(fitText(cellText(row[shape.field]), width), width, shape.align ?? "left")}
      </text>
    ),
  }));
}

/** The first of the candidate indices that points at a real column. */
function pick(...candidates: number[]): number {
  return candidates.find((index) => index >= 0) ?? 0;
}

/** A Discover value as one line of text. */
function cellText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
