/**
 * Issues — the stream, wired to the screen contract.
 *
 * Every Issues nav item but All Views is this: the same `/issues/` list under
 * a different query, named by `core/issueViews.ts` and started from the
 * defaults the registry took from it. The stream itself is `IssueStream`; what
 * lives here is the wiring — screen state in, an issue's detail onto the view
 * stack on the way out.
 *
 * `IssueStreamView` is the same body without a registry entry, so a saved
 * search's results can be pushed as a view and behave identically.
 */

import { useCallback, useEffect } from "react";

import { fetchIssue, issueSort } from "~/api/issues";
import type { Group } from "~/api/types";
import { valueOf } from "~/core/async";
import { getIssueView } from "~/core/issueViews";
import { DirectDetailStatus } from "~/ui/components/DirectDetailStatus";
import { useDirectResource, type DirectResourceLoader } from "~/ui/hooks/useDirectResource";
import { rowsOf, type ScreenState } from "~/ui/hooks/useScreenState";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { IssueDetail } from "~/ui/screens/IssueDetail";
import { IssueStream } from "~/ui/screens/IssueStream";
import type { DetailContext, ScreenProps, ViewStackEntry } from "~/ui/screens/types";

export function IssueFeed(props: ScreenProps) {
  const view = getIssueView(props.screen.item);
  return (
    <IssueStreamView
      {...props}
      title={view?.label}
      description={view?.description}
      state={props.state}
      onProjectChange={props.onProjectSelect}
    />
  );
}

/**
 * The issue stream over a given slice.
 *
 * Takes a `DetailContext` rather than `ScreenProps` because a pushed view has
 * one and a screen's props are a superset of it — so both call sites work.
 */
export function IssueStreamView({
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
  title,
  description,
  onProjectChange,
}: DetailContext & {
  state: ScreenState;
  /** Name of the view being shown, rendered above the search bar. */
  title?: string;
  /** One-line explanation of the view, shown beside the title. */
  description?: string;
  /** Override for ordinary screens that remember explicit dropdown selections. */
  onProjectChange?: (projects: string[]) => void;
}) {
  const { setStatus, setOpenDropdown } = state;
  const issues = rowsOf<Group>(state);

  const open = useCallback(
    (index: number) => {
      const group = rowsOf<Group>(state)[index];
      if (group) pushView(issueView(group, client, org));
    },
    [state, pushView, client, org],
  );
  useScreenActions(registerActions, { open });

  const handleStatus = useCallback(
    (status: { loading: boolean; since?: number; error?: string }) =>
      setStatus({ ...status, noun: "issues" }),
    [setStatus],
  );

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  return (
    <IssueStream
      client={client}
      org={org}
      width={width}
      height={height}
      focused={focused}
      selectedIndex={state.selected}
      onIssuesChange={state.setEntries}
      onStatusChange={handleStatus}
      // Once loaded, the app owns the list so optimistic triage edits survive;
      // before that the stream renders its own fetch state.
      issuesOverride={issues.length > 0 ? issues : undefined}
      pendingIds={pendingIds}
      openDropdown={state.openDropdown}
      selectedProjects={state.selectedProjects}
      selectedEnvs={state.selectedEnvs}
      statsPeriod={state.statsPeriod}
      onProjectChange={onProjectChange ?? state.setSelectedProjects}
      onEnvChange={state.setSelectedEnvs}
      onPeriodChange={state.setStatsPeriod}
      onSortChange={state.setSort}
      onDropdownClose={closeDropdown}
      onDropdownOpen={state.setOpenDropdown}
      query={state.committedQuery}
      searchValue={state.searchQuery}
      onSearchInput={state.setSearchQuery}
      searchFocused={state.searchFocused}
      onSearchFocus={state.focusSearch}
      onSearchBlur={state.handleSearchBlur}
      reloadToken={reloadToken}
      onRowClick={activateRow}
      sort={issueSort(state.sort)}
      title={title}
      description={description}
    />
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
