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

import { useCallback, useEffect, useRef } from "react";

import { RenderableEvents, type InputRenderable } from "@opentui/core";

import type { DashboardListItem } from "~/api/dashboards";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { getDashboardListView, type DashboardListView } from "~/core/dashboards";
import { theme } from "~/core/theme";
import { timeAgo } from "~/lib/sparkline";
import { padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { SEARCH_ROWS } from "~/ui/components/FilterBar";
import { useDashboards } from "~/ui/hooks/useDashboards";
import { rowsOf } from "~/ui/hooks/useScreenState";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import { dashboardDetailView } from "~/ui/screens/DashboardDetail";
import type { ScreenProps } from "~/ui/screens/types";

/** Header row plus the two lines of screen heading above the table. */
const HEADING_ROWS = 2;

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
    <text fg={theme.text}>{padText(String(row.widgetDisplay?.length ?? 0), width, "right")}</text>
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
    width: 16,
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
    width: 9,
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

export function DashboardList(props: ScreenProps) {
  const { client, org, screen, state, focused, width, height, reloadToken } = props;
  const { setEntries, setStatus, focusSearch, handleSearchBlur } = state;

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

  const status = useDashboards(client, {
    org,
    filter: config.filter,
    query: state.committedQuery,
    sort: config.sort,
    reloadToken,
  });

  const rows = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({ loading, error: error?.message, noun: "dashboards" });
  }, [loading, error, setStatus]);

  const { pushView } = props;
  const open = useCallback(
    (index: number) => {
      const row = rowsOf<DashboardListItem>(state)[index];
      if (row) pushView(dashboardDetailView(row));
    },
    [state, pushView],
  );
  useScreenActions(props.registerActions, { open });

  const isPrebuilt = config.filter === "onlyPrebuilt";
  const columns = isPrebuilt ? PREBUILT_COLUMNS : STANDARD_COLUMNS;

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchBox
        value={state.searchQuery}
        placeholder={config.searchPlaceholder}
        focused={state.searchFocused}
        width={width}
        onInput={state.setSearchQuery}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.text} attributes={BOLD}>
          {config.title}
        </text>
        <text fg={theme.muted}>{`  ${config.description}`}</text>
      </box>
      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.subText}>{rows ? countLabel(rows.length) : ""}</text>
      </box>

      <DataTable
        rows={rows}
        columns={columns}
        width={width}
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
    </box>
  );
}

/** `3 dashboards`, agreeing in number. */
function countLabel(count: number): string {
  return `${count} ${count === 1 ? "dashboard" : "dashboards"}`;
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

/**
 * The screen's search box — a local placeholder, deliberately.
 *
 * `SearchInput` is being extracted as a shared component on another branch,
 * along with the log stream's migration onto it. Rather than land a second
 * component at the same path, this stays inside the one screen that needs it
 * and is deleted in favour of the shared one when that branch merges.
 *
 * The focus listeners are the part that can't be trimmed: the app's key router
 * decides where keystrokes go from `state.searchFocused`, so a click into or
 * out of the input has to tell it, or the two disagree about who has the caret.
 */
function SearchBox({
  value,
  placeholder,
  focused,
  width,
  onInput,
  onFocus,
  onBlur,
}: {
  value: string;
  placeholder: string;
  focused: boolean;
  width: number;
  onInput: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const inputRef = useRef<InputRenderable | null>(null);

  const attach = useCallback(
    (node: InputRenderable | null) => {
      const previous = inputRef.current;
      if (previous) {
        previous.removeAllListeners(RenderableEvents.FOCUSED);
        previous.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, onFocus);
        node.on(RenderableEvents.BLURRED, onBlur);
      }
    },
    [onFocus, onBlur],
  );

  return (
    <box
      style={{
        flexDirection: "row",
        width,
        flexShrink: 0,
        height: SEARCH_ROWS,
        border: true,
        borderStyle: "rounded",
        borderColor: focused ? theme.accent : theme.border,
        backgroundColor: theme.panel,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={theme.subText}>{"("}</text>
      <text fg={focused ? theme.accent : theme.text}>{"/"}</text>
      <text fg={theme.subText}>{")"} </text>
      <input
        ref={attach}
        value={value}
        placeholder={placeholder}
        focused={focused}
        onInput={onInput}
        style={{
          flexGrow: 1,
          textColor: theme.text,
          backgroundColor: theme.panel,
          focusedTextColor: theme.text,
          focusedBackgroundColor: theme.panel,
          placeholderColor: theme.subText,
        }}
      />
    </box>
  );
}
