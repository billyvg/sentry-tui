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
import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";
import { FilterBar, type FilterDropdownType } from "~/ui/components/FilterBar";
import { IssueListHeader, IssueRow, ROW_HEIGHT } from "~/ui/components/IssueRow";
import { IssueListEmpty, IssueListError, IssueListSkeleton } from "~/ui/components/IssueListStates";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useIssues } from "~/ui/hooks/useIssues";
import { useRowScrollFollow } from "~/ui/hooks/useRowScrollFollow";

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
  query: queryProp,
  searchValue,
  onSearchInput,
  searchFocused = false,
  onSearchFocus,
  onSearchBlur,
}: IssueStreamProps) {
  const [localQuery] = useState(DEFAULT_QUERY);
  const query = queryProp ?? localQuery;
  const displayValue = searchValue ?? query;
  const [sort] = useState<SortOption>(DEFAULT_SORT);
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

  const sortLabel = useMemo(
    () => SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort,
    [sort],
  );

  const listWidth = Math.max(20, width);

  return (
    <box style={{ flexDirection: "column", width, height }}>
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
        <text fg={searchFocused ? theme.accent : theme.text}>{"/"}</text>
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
        anchorTop={2}
        onProjectChange={onProjectChange ?? (() => {})}
        onEnvChange={onEnvChange ?? (() => {})}
        onPeriodChange={onPeriodChange ?? (() => {})}
        onDropdownClose={onDropdownClose ?? (() => {})}
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
      <scrollbox ref={listRef} focused={focused} style={{ flexGrow: 1, flexBasis: 0, width }}>
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
