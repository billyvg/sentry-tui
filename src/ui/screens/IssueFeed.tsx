/**
 * Issues — the stream, wired directly to the screen contract.
 *
 * Every Issues nav item but All Views is this component under a different
 * query, named by `core/issueViews.ts` and started from the defaults the
 * registry took from it. Saved searches render the same component as a
 * stateful pushed view, with their own `ScreenState` slice.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { RenderableEvents, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";

import { fetchIssue, issueSort, PAGE_SIZE, SORT_OPTIONS } from "~/api/issues";
import type { Group } from "~/api/types";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { assigneeAvatarUrl } from "~/core/avatars";
import { getIssueView } from "~/core/issueViews";
import { fitText, measureTextWidth } from "~/lib/text";
import { DirectDetailStatus } from "~/ui/components/DirectDetailStatus";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { IssueListHeader, IssueRow, ROW_HEIGHT } from "~/ui/components/IssueRow";
import { IssueListEmpty, IssueListError, IssueListSkeleton } from "~/ui/components/IssueListStates";
import { ResultFooter } from "~/ui/components/ResultFooter";
import { useDirectResource, type DirectResourceLoader } from "~/ui/hooks/useDirectResource";
import { useIssues } from "~/ui/hooks/useIssues";
import { useMemberAvatars } from "~/ui/hooks/useMemberAvatars";
import { useRowScrollFollow } from "~/ui/hooks/useRowScrollFollow";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { rowsOf, type ScreenState } from "~/ui/hooks/useScreenState";
import { BOLD, UNDERLINE } from "~/ui/lib/attributes";
import { IssueDetail } from "~/ui/screens/IssueDetail";
import type { DetailContext, ScreenProps, ViewStackEntry } from "~/ui/screens/types";
import { useTheme } from "~/ui/theme";

/** Column reserved for the scrollbox's vertical scrollbar. */
const SCROLLBAR_GUTTER = 1;

/** Rows the view-title line occupies when a title is shown. */
const TITLE_ROWS = 1;

interface SavedIssueFeedProps extends DetailContext {
  state: ScreenState;
  /** Name of the saved view being shown. */
  title: string;
  /** Saved query shown beside the view name. */
  description?: string;
}

type IssueFeedProps = ScreenProps | SavedIssueFeedProps;

/**
 * Fetch and render an issue list from its screen-state slice.
 *
 * Registered issue screens derive their heading from `screen`; a pushed
 * saved-search view supplies its heading and state slice directly.
 */
export function IssueFeed(props: IssueFeedProps) {
  const {
    client,
    org,
    state,
    focused,
    width,
    height,
    reloadToken,
    pendingIds,
    pushView,
    activateRow,
    registerActions,
  } = props;
  const theme = useTheme();
  const view = "screen" in props ? getIssueView(props.screen.item) : undefined;
  const title = "screen" in props ? view?.label : props.title;
  const description = "screen" in props ? view?.description : props.description;
  const onProjectChange = "screen" in props ? props.onProjectSelect : state.setSelectedProjects;
  const inputRef = useRef<InputRenderable>(null);
  const listRef = useRef<ScrollBoxRenderable>(null);

  const open = useCallback(
    (index: number) => {
      const group = rowsOf<Group>(state)[index];
      if (group) pushView(issueView(group, client, org));
    },
    [state, pushView, client, org],
  );
  const closeDropdown = useCallback(() => state.setOpenDropdown(null), [state.setOpenDropdown]);

  // Sync native focus/blur (for example, mouse clicks) back to screen state.
  const inputRefCallback = useCallback(
    (node: InputRenderable | null) => {
      const previous = inputRef.current;
      if (previous) {
        previous.removeAllListeners(RenderableEvents.FOCUSED);
        previous.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, state.focusSearch);
        node.on(RenderableEvents.BLURRED, state.handleSearchBlur);
      }
    },
    [state.focusSearch, state.handleSearchBlur],
  );

  const sort = issueSort(state.sort);
  const { issues, statsLoading, nextCursor, prevCursor, page, nextPage, previousPage } = useIssues(
    client,
    {
      org,
      query: state.committedQuery,
      sort,
      statsPeriod: state.statsPeriod,
      project: state.selectedProjects.length > 0 ? state.selectedProjects : undefined,
      environment: state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined,
      reloadToken,
    },
  );

  useScreenActions(registerActions, { open, nextPage, previousPage });

  const reportedPage = useRef(page);
  useEffect(() => {
    if (reportedPage.current === page) return;
    reportedPage.current = page;
    state.setSelected(0);
  }, [page, state.setSelected]);

  const loading = issues.state === "loading";
  const since = loadingSince(issues);
  const fetched = valueOf(issues);
  const stored = rowsOf<Group>(state);
  // Once loaded, screen state owns the rows so optimistic triage edits survive.
  // Before that, render the hook's fetch state without mistaking an unfilled
  // slice for a settled empty result.
  const rows = stored.length > 0 ? stored : fetched;
  const error = errorOf(issues);
  const stale = rows !== undefined && (loading || error !== undefined);

  useEffect(() => {
    if (fetched) state.setEntries(fetched);
  }, [fetched, state.setEntries]);

  useEffect(() => {
    state.setStatus({
      loading: loading || statsLoading,
      since,
      error: error?.message,
      noun: "issues",
    });
  }, [loading, statsLoading, since, error, issues, state.setStatus]);

  useRowScrollFollow(listRef, {
    index: state.selected,
    rowCount: rows?.length ?? 0,
    rowHeight: ROW_HEIGHT,
    layout: [height],
  });

  const hasAssignee = useMemo(
    () => (rows ?? []).some((group) => group.assignedTo?.type === "user"),
    [rows],
  );
  const avatars = useMemberAvatars(client, org, hasAssignee);
  const listWidth = Math.max(20, width - SCROLLBAR_GUTTER);

  return (
    <box style={{ flexDirection: "column", width, height }}>
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

      <box
        style={{
          flexDirection: "row",
          width,
          flexShrink: 0,
          height: 3,
          border: true,
          borderStyle: "rounded",
          borderColor: state.searchFocused ? theme.accent : theme.border,
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={theme.hotkey} attributes={UNDERLINE}>
          {"/"}
        </text>
        <text> </text>
        <input
          ref={inputRefCallback}
          value={state.searchQuery}
          placeholder="Search issues…"
          focused={state.searchFocused}
          onInput={state.setSearchQuery}
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

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sort={{ value: sort, items: SORT_OPTIONS, onChange: state.setSort }}
        width={width}
        anchorTop={SEARCH_ROWS + (title ? TITLE_ROWS : 0)}
        onProjectChange={onProjectChange}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      <IssueListHeader
        width={listWidth}
        selectionBelow={focused && state.selected === 0 && (rows?.length ?? 0) > 0}
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
        {rows === undefined && isInitialLoad(issues) ? (
          <IssueListSkeleton width={listWidth} rows={PAGE_SIZE} />
        ) : null}

        {rows !== undefined && rows.length === 0 && !loading ? (
          <IssueListEmpty query={state.committedQuery} />
        ) : null}

        {rows?.map((group, index) => (
          <IssueRow
            key={group.id}
            group={group}
            selected={focused && index === state.selected}
            selectionBelow={focused && index + 1 === state.selected}
            width={listWidth}
            pending={pendingIds.has(group.id)}
            assigneeAvatarUrl={assigneeAvatarUrl(group.assignedTo, avatars)}
            onClick={() => activateRow(index)}
          />
        ))}

        {error && rows === undefined ? <IssueListError error={error} /> : null}
      </scrollbox>

      {stale ? (
        <text fg={theme.muted}>{error ? ` ⚠ ${fitText(error.message, listWidth - 3)}` : ""}</text>
      ) : null}
      <ResultFooter
        count={rows?.length}
        noun="issue"
        hasMore={nextCursor !== null}
        pagination={
          nextCursor !== null || prevCursor !== null || page > 1
            ? {
                page,
                hasPrevious: page > 1 && prevCursor !== null,
                hasNext: nextCursor !== null,
                loading,
                onPrevious: previousPage,
                onNext: nextPage,
              }
            : undefined
        }
      />
    </box>
  );
}

/**
 * The detail view for one issue.
 *
 * `ctx.issue` rather than the captured `group`: an optimistic triage write
 * rewrites the entry on the stack, and the view has to show the new status
 * rather than the one it was pushed with.
 */
function issueView(group: Group, client: ScreenProps["client"], org: string): ViewStackEntry {
  return {
    id: `issue:${group.id}`,
    label: group.shortId,
    issue: group,
    render: (ctx) => (
      <IssueDetail
        client={client}
        org={org}
        group={ctx.issue ?? group}
        width={ctx.width}
        height={ctx.height}
        focused={ctx.focused}
        reloadToken={ctx.reloadToken}
      />
    ),
  };
}

const loadIssue: DirectResourceLoader<Group> = (client, { org, id, signal }) =>
  fetchIssue(client, { org, issueId: id, signal });

/** An issue detail addressed by a copied URL rather than a loaded list row. */
export function issueUrlView(issueId: string, eventId?: string): ViewStackEntry {
  return {
    id: `issue:${issueId}`,
    label: `Issue ${issueId}`,
    render: (ctx) => <IssueFromUrl {...ctx} issueId={issueId} eventId={eventId} />,
  };
}

/** Resolve the issue record before handing it to the existing detail pane. */
function IssueFromUrl({
  client,
  org,
  issueId,
  eventId,
  reloadToken,
  width,
  height,
  focused,
  updateView,
}: DetailContext & { issueId: string; eventId?: string }) {
  const status = useDirectResource(client, { org, id: issueId, reloadToken, load: loadIssue });
  const group = valueOf(status);

  useEffect(() => {
    if (group) updateView(`issue:${issueId}`, { label: group.shortId, issue: group });
  }, [group, issueId, updateView]);

  if (!group) {
    return <DirectDetailStatus status={status} noun="issue" width={width} height={height} />;
  }
  return (
    <IssueDetail
      client={client}
      org={org}
      group={group}
      eventId={eventId}
      width={width}
      height={height}
      focused={focused}
      reloadToken={reloadToken}
    />
  );
}
