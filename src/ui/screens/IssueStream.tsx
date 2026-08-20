import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RenderableEvents, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";

import type { SentryClient } from "~/api/client";
import {
  DEFAULT_QUERY,
  DEFAULT_SORT,
  DEFAULT_STATS_PERIOD,
  PAGE_SIZE,
  SORT_OPTIONS,
  type SortOption,
} from "~/api/issues";
import type { Group } from "~/api/types";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import { assigneeAvatarUrl } from "~/core/avatars";
import { theme } from "~/core/theme";
import { fitText, measureTextWidth } from "~/lib/text";
import { FilterBar, SEARCH_ROWS, type FilterDropdownType } from "~/ui/components/FilterBar";
import { IssueListHeader, IssueRow, ROW_HEIGHT } from "~/ui/components/IssueRow";
import { IssueListEmpty, IssueListError, IssueListSkeleton } from "~/ui/components/IssueListStates";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useIssues } from "~/ui/hooks/useIssues";
import { useMemberAvatars } from "~/ui/hooks/useMemberAvatars";
import { useRowScrollFollow } from "~/ui/hooks/useRowScrollFollow";
import { BOLD } from "~/ui/lib/attributes";

/**
 * Column the scrollbox's vertical scrollbar takes out of its own viewport.
 * The list is laid out one column narrower so the bar lands in a gutter of its
 * own; at full width the rows overflow the viewport instead, which clips every
 * row rule a column short of the border and puts the thumb on top of the
 * rows' right padding.
 */
const SCROLLBAR_GUTTER = 1;

/** Rows the view-title line occupies when a `title` is given. */
const TITLE_ROWS = 1;

export interface IssueStreamProps {
  client: SentryClient | null;
  org: string;
  width: number;
  height: number;
  focused: boolean;
  selectedIndex: number;
  onIssuesChange?: (issues: Group[]) => void;
  onStatusChange?: (status: { loading: boolean; elapsedMs?: number; error?: string }) => void;
  /**
   * Rows to render instead of the fetched ones. The App owns the list once
   * loaded so optimistic triage updates can rewrite it; also lets tests render
   * a fixed state without a client.
   */
  issuesOverride?: Group[];
  /** Issue ids with a mutation in flight. */
  pendingIds?: ReadonlySet<string>;
  /** Which filter dropdown is open (null = none). */
  openDropdown?: FilterDropdownType;
  /** Selected project slugs (empty = all). */
  selectedProjects?: string[];
  /** Selected environment names (empty = all). */
  selectedEnvs?: string[];
  /** Stats period for the query. */
  statsPeriod?: string;
  onProjectChange?: (projects: string[]) => void;
  onEnvChange?: (envs: string[]) => void;
  onPeriodChange?: (period: string) => void;
  onDropdownClose?: () => void;
  onDropdownOpen?: (which: FilterDropdownType) => void;
  /** The committed query sent to the API for fetching. */
  query?: string;
  /** The live input value displayed in the search bar (may differ while editing). */
  searchValue?: string;
  /** Called as the user types into the search bar. */
  onSearchInput?: (value: string) => void;
  /** Whether the search input is focused. */
  searchFocused?: boolean;
  /** Called when the input gains focus (e.g. via mouse click). */
  onSearchFocus?: () => void;
  /** Called when the input loses focus. */
  onSearchBlur?: () => void;
  /** Bump to refetch the current query — the app's global refresh. */
  reloadToken?: number;
  /**
   * A row was clicked. The row is reported with its index so the owner of the
   * cursor can both move it and act on the issue itself.
   */
  onRowClick?: (index: number, group: Group) => void;
  /**
   * Sort passed to the API. Owned by the App because a saved or taxonomy view
   * can carry its own — see `src/core/issueViews.ts`.
   */
  sort?: SortOption;
  /** Name of the view being shown, rendered above the search bar. */
  title?: string;
  /** One-line explanation of the view, shown beside the title. */
  description?: string;
}

export function IssueStream({
  client,
  org,
  width,
  height,
  focused,
  selectedIndex,
  onIssuesChange,
  onStatusChange,
  issuesOverride,
  pendingIds,
  openDropdown = null,
  selectedProjects = [],
  selectedEnvs = [],
  statsPeriod = DEFAULT_STATS_PERIOD,
  onProjectChange,
  onEnvChange,
  onPeriodChange,
  onDropdownClose,
  onDropdownOpen,
  query: queryProp,
  searchValue,
  onSearchInput,
  searchFocused = false,
  onSearchFocus,
  onSearchBlur,
  reloadToken,
  onRowClick,
  sort = DEFAULT_SORT,
  title,
  description,
}: IssueStreamProps) {
  const [localQuery] = useState(DEFAULT_QUERY);
  const query = queryProp ?? localQuery;
  const displayValue = searchValue ?? query;
  const inputRef = useRef<InputRenderable>(null);
  const listRef = useRef<ScrollBoxRenderable>(null);

  // Sync native focus/blur (e.g. mouse clicks) back to the parent.
  const inputRefCallback = useCallback(
    (node: InputRenderable | null) => {
      const prev = inputRef.current;
      if (prev) {
        prev.removeAllListeners(RenderableEvents.FOCUSED);
        prev.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, () => onSearchFocus?.());
        node.on(RenderableEvents.BLURRED, () => onSearchBlur?.());
      }
    },
    [onSearchFocus, onSearchBlur],
  );

  const { issues, statsLoading } = useIssues(client, {
    org,
    query,
    sort,
    statsPeriod,
    project: selectedProjects.length > 0 ? selectedProjects : undefined,
    environment: selectedEnvs.length > 0 ? selectedEnvs : undefined,
    reloadToken,
  });

  const loading = issues.state === "loading";
  const since = issues.state === "loading" ? issues.since : undefined;
  const elapsed = useElapsed(loading, since);

  const fetched = valueOf(issues);
  const rows = issuesOverride ?? fetched;
  const error = errorOf(issues);
  // Stale rows stay on screen during a refresh, dimmed rather than replaced.
  const stale = rows !== undefined && (loading || error !== undefined);

  // Report what was *fetched*, never the override. Echoing the override back
  // would close a loop — the parent's copy would overwrite each phase-two
  // merge, so counts and sparklines would never arrive.
  useEffect(() => {
    if (fetched) onIssuesChange?.(fetched);
  }, [fetched, onIssuesChange]);

  useEffect(() => {
    onStatusChange?.({
      loading: loading || statsLoading,
      elapsedMs: elapsed ?? elapsedMs(issues, Date.now()),
      error: error?.message,
    });
  }, [loading, statsLoading, elapsed, error, rows, issues, onStatusChange]);

  useRowScrollFollow(listRef, {
    index: selectedIndex,
    rowCount: rows?.length ?? 0,
    rowHeight: ROW_HEIGHT,
    layout: [height],
  });

  // One member fetch serves the whole list, and only once a row is actually
  // assigned to somebody — most streams never need it.
  const hasAssignee = useMemo(
    () => (rows ?? []).some((group) => group.assignedTo?.type === "user"),
    [rows],
  );
  const avatars = useMemberAvatars(client, org, hasAssignee);

  const sortLabel = useMemo(
    () => SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort,
    [sort],
  );

  const listWidth = Math.max(20, width - SCROLLBAR_GUTTER);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/*
       * Which view this is. The secondary nav closes on selection, so without
       * this line Warnings and Feed are indistinguishable. Mirrors the web's
       * page title and `titleDescription`.
       */}
      {title ? (
        <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
          <text fg={theme.text} attributes={BOLD}>
            {title}
          </text>
          {description ? (
            <text fg={theme.muted}>
              {`  ${fitText(description, Math.max(0, listWidth - measureTextWidth(title) - 3))}`}
            </text>
          ) : null}
        </box>
      ) : null}

      {/* Search query, mirroring the web app's search bar. */}
      <box
        style={{
          flexDirection: "row",
          width,
          flexShrink: 0,
          height: 3,
          border: true,
          borderStyle: "rounded",
          borderColor: searchFocused ? theme.accent : theme.border,
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={theme.subText}>{"("}</text>
        <text fg={theme.hotkey}>{"/"}</text>
        <text fg={theme.subText}>{")"} </text>
        <input
          ref={inputRefCallback}
          value={displayValue}
          placeholder="Search issues…"
          focused={searchFocused}
          onInput={onSearchInput}
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

      {/* Filter row: project / environment / period, then sort. */}
      <FilterBar
        client={client}
        org={org}
        openDropdown={openDropdown}
        selectedProjects={selectedProjects}
        selectedEnvs={selectedEnvs}
        statsPeriod={statsPeriod}
        sortLabel={sortLabel}
        anchorTop={SEARCH_ROWS + (title ? TITLE_ROWS : 0)}
        onProjectChange={onProjectChange ?? (() => {})}
        onEnvChange={onEnvChange ?? (() => {})}
        onPeriodChange={onPeriodChange ?? (() => {})}
        onDropdownClose={onDropdownClose ?? (() => {})}
        onDropdownOpen={onDropdownOpen}
      />

      {/* The header's rule doubles as the first row's top edge. */}
      <IssueListHeader
        width={listWidth}
        selectionBelow={focused && selectedIndex === 0 && (rows?.length ?? 0) > 0}
      />

      {/*
       * `flexBasis: 0` is what makes this box scroll at all: on `auto` the
       * scrollbox takes its content's height as its base size, grows past the
       * pane, and ends up with a viewport as tall as the list — nothing
       * overflows, so there is nothing to scroll. Starting from zero and
       * growing into the leftover space bounds the viewport to the pane.
       */}
      <scrollbox
        ref={listRef}
        focused={focused}
        // A continuously drawn track keeps the gutter reading as a scroll rail
        // rather than as a gap the rules fail to reach.
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
        }}
        style={{ flexGrow: 1, flexBasis: 0, width }}
      >
        {rows === undefined && isInitialLoad(issues) ? (
          <IssueListSkeleton width={listWidth} rows={PAGE_SIZE} />
        ) : null}

        {rows !== undefined && rows.length === 0 && !loading ? (
          <IssueListEmpty query={query} />
        ) : null}

        {rows?.map((group, index) => (
          <IssueRow
            key={group.id}
            group={group}
            selected={focused && index === selectedIndex}
            selectionBelow={focused && index + 1 === selectedIndex}
            width={listWidth}
            pending={pendingIds?.has(group.id) ?? false}
            assigneeAvatarUrl={assigneeAvatarUrl(group.assignedTo, avatars)}
            onClick={onRowClick ? () => onRowClick(index, group) : undefined}
          />
        ))}

        {error && rows === undefined ? <IssueListError error={error} /> : null}
      </scrollbox>

      {stale ? (
        <text fg={theme.muted}>{error ? ` ⚠ ${fitText(error.message, listWidth - 3)}` : ""}</text>
      ) : null}
    </box>
  );
}
