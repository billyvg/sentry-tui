/**
 * Explore › All Queries and Explore › Discover — the org's saved queries.
 *
 * One screen for both: they are the same list over two endpoints, and which
 * one a screen reads is a lookup in `core/savedQueryScreens.ts` rather than a
 * second component. Mirrors `views/explore/savedQueries/savedQueriesTable.tsx`
 * — star, name, type, query, creator, last viewed — minus the columns that
 * exist only to hold buttons, since every action on this page is a write.
 *
 * Enter re-runs the query and pushes its results as a view of their own, the
 * way `Issues › All Views` opens a saved search.
 */

import { useCallback, useEffect, useMemo } from "react";

import {
  savedQueryListSort,
  savedQueryProjectSlugs,
  savedQuerySortOptions,
  type SavedQuery,
} from "~/api/savedQueries";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { savedQueryScreen, type SavedQueryScreenConfig } from "~/core/savedQueryScreens";
import { useTheme } from "~/ui/theme";
import type { Theme } from "~/core/theme";
import { timeAgo } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { SEARCH_ROWS } from "~/ui/components/FilterBar";
import { ResultFooter } from "~/ui/components/ResultFooter";
import { SearchInput } from "~/ui/components/SearchInput";
import { SortBar } from "~/ui/components/SortBar";
import { useProjectSlugs } from "~/ui/hooks/useProjects";
import { useSavedQueries } from "~/ui/hooks/useSavedQueries";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { rowsOf } from "~/ui/hooks/useScreenState";
import { BOLD } from "~/ui/lib/attributes";
import { savedQueryResultsView } from "~/ui/screens/SavedQueryResults";
import type { ScreenProps } from "~/ui/screens/types";

/** Lines the title and its one-line description take above the table. */
const HEADING_ROWS = 1;

/**
 * Cells the Query column needs before it is worth keeping.
 *
 * Below it the row still fits, but the query reads `span.op:h…`, and a saved
 * query you can't tell apart from its neighbour is worse than one fewer
 * column. Naming the width is what makes the table shed down to star, name and
 * query at 80 columns — the same three the web keeps at its small breakpoint.
 */
const MIN_QUERY_WIDTH = 20;

/**
 * The columns, and the order they are given up in.
 *
 * The star and the name never go: a saved query without its name is not
 * identifiable, and the star is one cell. Last-viewed goes first, then the
 * type, then the creator — the same order the web's container queries shed in
 * (`savedQueriesTable.tsx:366-394`), which drops `last-visited` at its medium
 * breakpoint and `created-by` and `dataset` at its small one.
 */
function columnsFor(
  config: SavedQueryScreenConfig,
  theme: Theme,
): ReadonlyArray<Column<SavedQuery>> {
  return [
    {
      key: "star",
      label: " ",
      width: 1,
      render: (query) => (
        <text fg={query.starred ? theme.warning : theme.muted}>{query.starred ? "★" : " "}</text>
      ),
    },
    {
      key: "name",
      label: "Name",
      width: 24,
      render: (query, selected, width) => (
        <text fg={selected ? theme.text : theme.subText} attributes={selected ? BOLD : 0}>
          {padText(fitText(query.name, width), width)}
        </text>
      ),
    },
    {
      key: "type",
      label: "Type",
      width: 12,
      priority: 2,
      render: (query, _selected, width) => (
        <text fg={theme.muted}>{padText(fitText(query.datasetLabel, width), width)}</text>
      ),
    },
    {
      key: "query",
      label: "Query",
      width: "flex",
      render: (query, _selected, width) => (
        // Dimmer when the cell is the fallback, so the columns a query selects
        // don't read as a search it doesn't have.
        <text fg={query.query ? theme.muted : theme.subText}>
          {padText(fitText(describe(query), width), width)}
        </text>
      ),
    },
    {
      key: "creator",
      label: "Creator",
      width: 14,
      priority: 3,
      render: (query, _selected, width) => (
        <text fg={theme.subText}>
          {padText(fitText(query.createdBy ?? (query.isPrebuilt ? "Sentry" : "—"), width), width)}
        </text>
      ),
    },
    {
      key: "activity",
      label: config.activityLabel,
      width: 11,
      align: "right",
      priority: 1,
      render: (query, _selected, width) => (
        <text fg={theme.subText}>{padText(activity(query), width, "right")}</text>
      ),
    },
  ];
}

export function SavedQueries(props: ScreenProps) {
  const theme = useTheme();
  const {
    client,
    org,
    screen,
    state,
    focused,
    width,
    height,
    reloadToken,
    pushView,
    registerActions,
    activateRow,
  } = props;
  const { dispatch, focusSearch, handleSearchBlur } = state;

  // Every screen pointed at this component has an entry; the fallback keeps a
  // mis-wired registry line rendering an empty table rather than throwing.
  const config = savedQueryScreen(screen.id) ?? savedQueryScreen("explore.all-queries")!;
  const sortItems = savedQuerySortOptions(config.source);
  const sort = savedQueryListSort(state.sort, config.source);

  const { queries: status, nextCursor } = useSavedQueries(client, {
    org,
    source: config.source,
    search: state.committedQuery || undefined,
    sort,
    reloadToken,
  });

  const queries = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";
  const since = loadingSince(status);

  // Resolve only the ids carried by this page. `-1` is the all-projects
  // sentinel, not a project the endpoint can look up.
  const projectIds = useMemo(
    () => queries?.flatMap((query) => query.projects.filter((id) => id !== -1).map(String)) ?? [],
    [queries],
  );
  const slugById = useProjectSlugs(client, org, projectIds);

  useEffect(() => {
    if (queries) dispatch({ type: "setEntries", payload: queries });
  }, [queries, dispatch]);

  useEffect(() => {
    dispatch({
      type: "setStatus",
      payload: {
        loading,
        since,
        error: error?.message,
        noun: config.noun,
      },
    });
  }, [loading, since, error, status, config.noun, dispatch]);

  const open = useCallback(
    (index: number) => {
      const query = rowsOf<SavedQuery>(state)[index];
      if (query) pushView(savedQueryResultsView(query, savedQueryProjectSlugs(query, slugById)));
    },
    [state, pushView, slugById],
  );
  useScreenActions(registerActions, { open });

  const columns = useMemo(() => columnsFor(config, theme), [config, theme]);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInput
        value={state.searchQuery}
        placeholder={config.searchPlaceholder}
        focused={state.searchFocused}
        width={width}
        onInput={(query) => dispatch({ type: "setSearchQuery", payload: query })}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      <box
        style={{ flexDirection: "row", width, flexShrink: 0, height: HEADING_ROWS, paddingLeft: 1 }}
      >
        <text fg={theme.text} attributes={BOLD}>
          {config.title}
        </text>
        <text fg={theme.muted}>{`  ${config.description}`}</text>
      </box>

      <SortBar
        value={sort}
        items={sortItems}
        open={state.openDropdown === "sort"}
        width={width}
        anchorTop={SEARCH_ROWS + 1}
        onChange={(sort) => dispatch({ type: "setSort", payload: sort })}
        onOpen={() => dispatch({ type: "setOpenDropdown", payload: "sort" })}
        onClose={() => dispatch({ type: "setOpenDropdown", payload: null })}
      />

      <DataTable
        rows={queries}
        columns={columns}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(query) => `${query.source}:${query.id}`}
        loading={isInitialLoad(status)}
        error={error}
        errorTitle={`Failed to load ${config.noun}`}
        minFlex={MIN_QUERY_WIDTH}
        onRowClick={activateRow}
        empty={{
          title: "No saved queries found.",
          lines: [
            state.committedQuery ? `No query name matches "${state.committedQuery}".` : undefined,
            config.emptyHint,
          ],
        }}
        layout={[height]}
      />
      <ResultFooter count={queries?.length} noun="query" hasMore={nextCursor !== null} />
    </box>
  );
}

/** What the Query column shows: the search itself, else the columns it selects. */
function describe(query: SavedQuery): string {
  return query.query || query.fields.join(", ");
}

/** What the last column shows, per the header the config chose. */
function activity(query: SavedQuery): string {
  const iso = query.lastVisited ?? query.dateUpdated;
  return iso ? timeAgo(iso) : "—";
}
