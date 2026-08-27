/**
 * Issues › All Views — the org's saved issue searches.
 *
 * Mirrors `sentry/static/app/views/issueList/issueViews/issueViewsList/`: two
 * tables, "Created by Me" and "Created by Others", with starred views floated
 * to the top of each (the endpoint chains them that way). Selecting a row
 * applies the saved view's query and filters to the issue stream.
 */

import { useEffect, useMemo, useRef } from "react";

import type { ScrollBoxRenderable } from "@opentui/core";

import type { SentryClient } from "~/api/client";
import { VIEW_SORT_OPTIONS, viewSort, type GroupSearchView } from "~/api/groupSearchViews";
import { DEFAULT_STATS_PERIOD } from "~/api/issues";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { useTheme } from "~/ui/theme";
import { timeAgo } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import type { FilterDropdownType } from "~/ui/components/FilterBar";
import { ResultFooter } from "~/ui/components/ResultFooter";
import { SortBar } from "~/ui/components/SortBar";
import { useGroupSearchViews } from "~/ui/hooks/useGroupSearchViews";
import { useRowScrollFollow } from "~/ui/hooks/useRowScrollFollow";
import { BOLD } from "~/ui/lib/attributes";

/** A saved view is one line; its section header is one more. */
const ROW_HEIGHT = 1;

const COL_NAME = 26;
const COL_LAST_VIEWED = 10;
const COL_STARS = 6;

/** Column the scrollbox's vertical scrollbar takes out of its own viewport. */
const SCROLLBAR_GUTTER = 1;

/**
 * A saved view plus the parts of it the app can't read straight off the wire.
 *
 * `projects` comes back as numeric IDs, and they are carried through as IDs.
 * The issues endpoint accepts either an ID or a slug for `project`, so
 * translating them here would buy nothing and cost correctness: the project
 * list arrives asynchronously, and a view opened before it lands — or naming a
 * project the user cannot see — would have had its filter silently dropped and
 * opened scoped to the whole org. Widening a filter without saying so is the
 * wrong direction for a triage tool.
 */
export interface SavedViewRow {
  view: GroupSearchView;
  /** Project IDs, as the API returns them; empty means all projects. */
  projectIds: string[];
  /** Stats period the view was saved with. */
  statsPeriod: string;
}

export interface IssueViewsListProps {
  client: SentryClient | null;
  org: string;
  width: number;
  height: number;
  focused: boolean;
  selectedIndex: number;
  sort: string;
  openDropdown: FilterDropdownType;
  onSortChange: (sort: string) => void;
  onDropdownOpen: () => void;
  onDropdownClose: () => void;
  /** The flattened, ordered rows — what the App's cursor indexes into. */
  onRowsChange?: (rows: SavedViewRow[]) => void;
  onStatusChange?: (status: { loading: boolean; error?: string }) => void;
  reloadToken?: number;
}

export function IssueViewsList({
  client,
  org,
  width,
  height,
  focused,
  selectedIndex,
  sort: sortValue,
  openDropdown,
  onSortChange,
  onDropdownOpen,
  onDropdownClose,
  onRowsChange,
  onStatusChange,
  reloadToken,
}: IssueViewsListProps) {
  const theme = useTheme();
  const listRef = useRef<ScrollBoxRenderable>(null);
  const sort = viewSort(sortValue);
  const { sections: status, nextCursors } = useGroupSearchViews(client, {
    org,
    sort,
    reloadToken,
  });

  const sections = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";

  const rows = useMemo(
    () =>
      (sections ?? []).flatMap((section) =>
        section.views.map((view): SavedViewRow => ({
          view,
          // `[-1]` is Sentry's "all projects" sentinel, and the only id worth
          // dropping — everything else goes to the API as-is.
          projectIds: view.projects.filter((id) => id !== -1).map(String),
          statsPeriod: view.timeFilters?.period ?? DEFAULT_STATS_PERIOD,
        })),
      ),
    [sections],
  );

  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows, onRowsChange]);

  useEffect(() => {
    onStatusChange?.({ loading, error: error?.message });
  }, [loading, error, onStatusChange]);

  useRowScrollFollow(listRef, {
    index: selectedIndex,
    rowCount: rows.length,
    rowHeight: ROW_HEIGHT,
    layout: [height],
  });

  const listWidth = Math.max(20, width - SCROLLBAR_GUTTER);

  // Rows are numbered across both sections so the App's single cursor index
  // lines up with the flattened list it was handed.
  let rowIndex = -1;

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.text} attributes={BOLD}>
          All Views
        </text>
        <text fg={theme.muted}>{"  Saved issue searches for this organization."}</text>
      </box>

      <SortBar
        value={sort}
        items={VIEW_SORT_OPTIONS}
        open={openDropdown === "sort"}
        width={width}
        anchorTop={1}
        onChange={onSortChange}
        onOpen={onDropdownOpen}
        onClose={onDropdownClose}
      />

      <scrollbox
        ref={listRef}
        focused={focused}
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
        }}
        style={{ flexGrow: 1, flexBasis: 0, width }}
      >
        {sections === undefined && isInitialLoad(status) ? (
          <text fg={theme.muted}>{" Loading views…"}</text>
        ) : null}

        {error && sections === undefined ? (
          <box style={{ flexDirection: "column", padding: 1 }}>
            <text fg={theme.danger}>Failed to load views</text>
            <text fg={theme.muted}>{error.message}</text>
          </box>
        ) : null}

        {sections?.map((section) => (
          <box key={section.title} style={{ flexDirection: "column", width: listWidth }}>
            <text fg={theme.muted} attributes={BOLD}>
              {` ${section.title}`}
            </text>
            {section.views.length === 0 ? (
              <text fg={theme.subText}>{"   No saved views."}</text>
            ) : null}
            {section.views.map((view) => {
              rowIndex += 1;
              return (
                <ViewRow
                  key={view.id}
                  view={view}
                  width={listWidth}
                  selected={focused && rowIndex === selectedIndex}
                />
              );
            })}
          </box>
        ))}
      </scrollbox>
      <ResultFooter
        count={sections === undefined ? undefined : rows.length}
        noun="view"
        hasMore={nextCursors.mine !== null || nextCursors.others !== null}
      />
    </box>
  );
}

function ViewRow({
  view,
  width,
  selected,
}: {
  view: GroupSearchView;
  width: number;
  selected: boolean;
}) {
  const theme = useTheme();
  // Leading marker doubles as the cursor and the star indicator: the cursor
  // takes the first cell, the star the second, so neither can hide the other.
  const cursor = selected ? "❯" : " ";
  const star = view.starred ? "★" : " ";
  const fixed = 2 + COL_NAME + COL_LAST_VIEWED + COL_STARS + 3;
  const queryWidth = Math.max(6, width - fixed);

  return (
    <box
      style={{ flexDirection: "row", width, backgroundColor: selected ? theme.panel : undefined }}
    >
      <text fg={theme.accent}>{cursor}</text>
      <text fg={view.starred ? theme.warning : theme.muted}>{star}</text>
      <text fg={selected ? theme.text : theme.subText} attributes={selected ? BOLD : 0}>
        {` ${padText(view.name, COL_NAME)}`}
      </text>
      <text fg={theme.muted}>{` ${padText(fitText(view.query, queryWidth), queryWidth)}`}</text>
      <text fg={theme.subText}>
        {` ${padText(view.lastVisited ? timeAgo(view.lastVisited) : "—", COL_LAST_VIEWED, "right")}`}
      </text>
      <text fg={theme.subText}>{padText(`${view.stars}★`, COL_STARS, "right")}</text>
    </box>
  );
}
