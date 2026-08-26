/**
 * Dashboards › All Dashboards and Dashboards › Sentry Built.
 *
 * One table over `GET /organizations/{org}/dashboards/`, configured per screen
 * by `core/dashboards.ts` — the two destinations differ only by the `filter`
 * and `sort` they send. Columns follow the web's manage table
 * (`views/dashboards/manage/dashboardTable.tsx:118-154`), including its split
 * between the standard layout and the prebuilt one, which trades Owner, Access
 * and Created for the dashboard's Description.
 *
 * Read-only: the ★ column shows whether a dashboard is starred and nothing
 * here can change it.
 */

import { useCallback, useEffect, useMemo } from "react";

import { dashboardSort, dashboardSortOptions, type DashboardListItem } from "~/api/dashboards";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { getDashboardListView, type DashboardListView } from "~/core/dashboards";
import { useTheme } from "~/ui/theme";
import type { Theme } from "~/core/theme";
import { timeAgo } from "~/lib/sparkline";
import { padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { SEARCH_ROWS } from "~/ui/components/FilterBar";
import { ResultFooter } from "~/ui/components/ResultFooter";
import { SearchInput } from "~/ui/components/SearchInput";
import { SortBar } from "~/ui/components/SortBar";
import { useDashboards } from "~/ui/hooks/useDashboards";
import { rowsOf } from "~/ui/hooks/useScreenState";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import { dashboardDetailView } from "~/ui/screens/DashboardDetail";
import type { ScreenProps } from "~/ui/screens/types";

/** Header row plus the two lines of screen heading above the table. */
const HEADING_ROWS = 4;

/**
 * Narrowest a dashboard title may be squeezed to before the table gives up a
 * column instead. A title is the only thing identifying a row, so it outranks
 * every piece of metadata beside it. Twenty-eight cells is also the room the
 * title has in a standard 80-column terminal, so wider breakpoints
 * shed lower-priority metadata rather than making the title less readable.
 */
const MIN_TITLE_WIDTH = 28;

function dashboardColumns(theme: Theme): {
  standard: ReadonlyArray<Column<DashboardListItem>>;
  prebuilt: ReadonlyArray<Column<DashboardListItem>>;
} {
  const STAR_COLUMN: Column<DashboardListItem> = {
    key: "star",
    label: "★",
    width: 1,
    render: (row) => (
      <text fg={row.isFavorited ? theme.warning : theme.border}>{row.isFavorited ? "★" : "☆"}</text>
    ),
  };

  const NAME_COLUMN: Column<DashboardListItem> = {
    key: "name",
    label: "Name",
    width: "flex",
    render: (row, selected, width) => (
      <text fg={selected ? theme.text : theme.accent} attributes={selected ? BOLD : 0}>
        {padText(row.title, width)}
      </text>
    ),
  };

  const WIDGETS_COLUMN: Column<DashboardListItem> = {
    key: "widgets",
    label: "Widgets",
    width: 7,
    align: "right",
    priority: 4,
    render: (row, _selected, width) => (
      <text fg={theme.text}>{padText(widgetCountLabel(row), width, "right")}</text>
    ),
  };

  const LAST_VISITED_COLUMN: Column<DashboardListItem> = {
    key: "lastVisited",
    label: "Last Visited",
    width: 12,
    priority: 5,
    render: (row, _selected, width) => (
      <text fg={theme.subText}>
        {padText(row.lastVisited ? timeAgo(row.lastVisited) : "—", width)}
      </text>
    ),
  };

  /**
   * The web's flag-on column set, minus the row actions a read-only client has
   * no use for: `★ · Name · Widgets · Owner · Access · Created · Last Visited`.
   */
  const STANDARD_COLUMNS: ReadonlyArray<Column<DashboardListItem>> = [
    STAR_COLUMN,
    NAME_COLUMN,
    WIDGETS_COLUMN,
    {
      key: "owner",
      label: "Owner",
      width: 18,
      priority: 3,
      render: (row, _selected, width) => (
        <text fg={theme.muted}>{padText(ownerLabel(row), width)}</text>
      ),
    },
    {
      key: "access",
      label: "Access",
      width: 10,
      priority: 1,
      render: (row, _selected, width) => (
        <text fg={theme.muted}>{padText(accessLabel(row), width)}</text>
      ),
    },
    {
      key: "created",
      label: "Created",
      width: 10,
      priority: 2,
      render: (row, _selected, width) => (
        <text fg={theme.subText}>
          {padText(row.dateCreated ? timeAgo(row.dateCreated) : "—", width)}
        </text>
      ),
    },
    LAST_VISITED_COLUMN,
  ];

  /**
   * The prebuilt column set: `★ · Name · Description · Widgets · Last Visited`.
   *
   * Sentry-built dashboards have no owner and cannot be edited, so the web drops
   * those three columns and shows the description instead
   * (`dashboardTable.tsx:120-146`).
   */
  const PREBUILT_COLUMNS: ReadonlyArray<Column<DashboardListItem>> = [
    STAR_COLUMN,
    NAME_COLUMN,
    {
      key: "description",
      label: "Description",
      width: "flex",
      priority: 1,
      render: (row, _selected, width) => (
        <text fg={theme.muted}>{padText(row.description ?? "", width)}</text>
      ),
    },
    WIDGETS_COLUMN,
    LAST_VISITED_COLUMN,
  ];

  return { standard: STANDARD_COLUMNS, prebuilt: PREBUILT_COLUMNS };
}

export function DashboardList(props: ScreenProps) {
  const theme = useTheme();
  const { client, org, screen, state, focused, width, height, reloadToken } = props;
  const { dispatch, focusSearch, handleSearchBlur } = state;

  const view = getDashboardListView(screen.id);
  // Every id in `SCREEN_COMPONENTS` pointing here has an entry, and
  // `src/core/dashboards.test.ts` is what keeps that true — but the map is a
  // `Partial`, so the fallback is what makes the type honest.
  const config: DashboardListView = view ?? {
    title: screen.item,
    description: "",
    sort: "recentlyViewed",
    searchPlaceholder: "Search dashboards…",
    emptyTitle: "No dashboards found.",
    emptyLines: [],
  };

  const isPrebuilt = config.filter === "onlyPrebuilt";
  const sortItems = useMemo(() => dashboardSortOptions(isPrebuilt), [isPrebuilt]);
  const sort = dashboardSort(state.sort, config.sort, isPrebuilt);

  const { dashboards: status, nextCursor } = useDashboards(client, {
    org,
    filter: config.filter,
    query: state.committedQuery,
    sort,
    reloadToken,
  });

  const rows = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";

  useEffect(() => {
    if (rows) dispatch({ type: "setEntries", payload: rows });
  }, [rows, dispatch]);

  useEffect(() => {
    dispatch({
      type: "setStatus",
      payload: { loading, error: error?.message, noun: "dashboards" },
    });
  }, [loading, error, dispatch]);

  const { pushView } = props;
  const open = useCallback(
    (index: number) => {
      const row = rowsOf<DashboardListItem>(state)[index];
      if (row) pushView(dashboardDetailView(row));
    },
    [state, pushView],
  );
  useScreenActions(props.registerActions, { open });

  const columnSets = dashboardColumns(theme);
  const columns = isPrebuilt ? columnSets.prebuilt : columnSets.standard;

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

      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
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
        rows={rows}
        columns={columns}
        width={width}
        minFlex={MIN_TITLE_WIDTH}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(row) => row.id}
        loading={isInitialLoad(status)}
        error={error}
        errorTitle="Failed to load dashboards"
        onRowClick={props.activateRow}
        empty={{
          title: config.emptyTitle,
          lines: [state.committedQuery || undefined, ...config.emptyLines],
        }}
        layout={[height, HEADING_ROWS]}
      />
      <ResultFooter count={rows?.length} noun="dashboard" hasMore={nextCursor !== null} />
    </box>
  );
}

/**
 * A custom dashboard with no widget rows really is empty. An unknown prebuilt
 * is different: its widgets live only in Web's bundled config, so zero would
 * be a confidently wrong count.
 */
function widgetCountLabel(row: DashboardListItem): string {
  if (row.widgetDisplay.length > 0) return String(row.widgetDisplay.length);
  return row.prebuiltId == null ? "0" : "—";
}

/**
 * Who owns a dashboard.
 *
 * A prebuilt one has no creator — the web draws Sentry's own system avatar
 * there (`dashboardTable.tsx:276-283`), which reads as the string here.
 */
function ownerLabel(row: DashboardListItem): string {
  const owner = row.createdBy;
  if (!owner) return "Sentry";
  return owner.name || owner.email || "—";
}

/**
 * Who may edit a dashboard.
 *
 * `editAccessSelector.tsx:68` treats an absent `permissions` and
 * `isEditableByEveryone` alike, and shows an `All` badge for both; otherwise
 * the creator plus whichever teams were granted access.
 */
function accessLabel(row: DashboardListItem): string {
  const permissions = row.permissions;
  if (!permissions || permissions.isEditableByEveryone) return "All";
  const teams = permissions.teamsWithEditAccess?.length ?? 0;
  return teams > 0 ? `Creator +${teams}` : "Creator";
}
