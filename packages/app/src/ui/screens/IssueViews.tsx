/**
 * Issues › All Views — the saved-search list, wired to the screen contract.
 *
 * The list itself is `IssueViewsList`. Opening a row pushes the saved search's
 * *results* as a view of their own: it gets a state slice seeded with the
 * view's query, sort, period and projects, so the stream on top of it behaves
 * like any other — search, filters, triage — and Escape drops back to the list
 * with its cursor where it was left.
 */

import { useCallback, useEffect } from "react";

import { fetchGroupSearchView, type GroupSearchView } from "~/api/groupSearchViews";
import { valueOf } from "~/core/async";
import { SAVED_VIEW_STATE_KEY } from "~/core/screens";
import { DirectDetailStatus } from "~/ui/components/DirectDetailStatus";
import { useDirectResource, type DirectResourceLoader } from "~/ui/hooks/useDirectResource";
import { rowsOf } from "~/ui/hooks/useScreenState";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { IssueFeed } from "~/ui/screens/IssueFeed";
import { IssueViewsList, type SavedViewRow } from "~/ui/screens/IssueViewsList";
import type { DetailContext, ScreenProps, ViewStackEntry } from "~/ui/screens/types";

export function IssueViews(props: ScreenProps) {
  const { client, org, state, focused, width, height, reloadToken, pushView, registerActions } =
    props;
  const { dispatch } = state;

  const open = useCallback(
    (index: number) => {
      const row = rowsOf<SavedViewRow>(state)[index];
      if (row) pushView(savedViewStream(row));
    },
    [state, pushView],
  );
  useScreenActions(registerActions, { open });

  const handleStatus = useCallback(
    (status: { loading: boolean; error?: string }) =>
      dispatch({ type: "setStatus", payload: { ...status, noun: "saved views" } }),
    [dispatch],
  );

  return (
    <IssueViewsList
      client={client}
      org={org}
      width={width}
      height={height}
      focused={focused}
      selectedIndex={state.selected}
      sort={state.sort}
      openDropdown={state.openDropdown}
      onSortChange={(sort) => dispatch({ type: "setSort", payload: sort })}
      onDropdownOpen={() => dispatch({ type: "setOpenDropdown", payload: "sort" })}
      onDropdownClose={() => dispatch({ type: "setOpenDropdown", payload: null })}
      onRowsChange={(rows) => dispatch({ type: "setEntries", payload: rows })}
      onStatusChange={handleStatus}
      reloadToken={reloadToken}
    />
  );
}

/** A saved search's results, as a view on the stack. */
function savedViewStream(row: SavedViewRow): ViewStackEntry {
  return {
    id: `saved-view:${row.view.id}`,
    sentryLocation: {
      screen: "issues.all-views",
      detail: { kind: "issue_view", viewId: row.view.id },
    },
    label: row.view.name,
    stateKey: SAVED_VIEW_STATE_KEY,
    // Opening a saved search means showing *its* filters, not the ones the
    // last one left behind in the slice.
    initialState: {
      query: row.view.query,
      sort: row.view.querySort,
      statsPeriod: row.statsPeriod,
      selectedProjects: row.projectIds,
      selectedEnvs: row.view.environments,
    },
    render: (ctx) =>
      ctx.state ? (
        <IssueFeed {...ctx} state={ctx.state} title={row.view.name} description={row.view.query} />
      ) : null,
  };
}

const loadSavedView: DirectResourceLoader<GroupSearchView> = (client, { org, id, signal }) =>
  fetchGroupSearchView(client, { org, viewId: id, signal });

/** A saved issue view addressed by its production URL. */
export function savedViewUrlStream(viewId: string): ViewStackEntry {
  return {
    id: `saved-view:${viewId}`,
    label: `View ${viewId}`,
    stateKey: SAVED_VIEW_STATE_KEY,
    sentryLocation: {
      screen: "issues.all-views",
      detail: { kind: "issue_view", viewId },
    },
    render: (ctx) =>
      ctx.state ? <SavedViewFromUrl {...ctx} state={ctx.state} viewId={viewId} /> : null,
  };
}

/** Resolve a saved view before handing its filters to the existing issue stream. */
function SavedViewFromUrl({
  client,
  org,
  state,
  viewId,
  reloadToken,
  width,
  height,
  updateView,
  ...ctx
}: DetailContext & { state: NonNullable<DetailContext["state"]>; viewId: string }) {
  const status = useDirectResource(client, {
    org,
    id: viewId,
    reloadToken,
    load: loadSavedView,
  });
  const view = valueOf(status);

  useEffect(() => {
    if (!view) return;
    state.dispatch({
      type: "seed",
      payload: {
        query: view.query,
        sort: view.querySort,
        statsPeriod: view.timeFilters.period ?? undefined,
        selectedProjects: view.projects.filter((id) => id !== -1).map(String),
        selectedEnvs: view.environments,
      },
    });
    updateView(`saved-view:${viewId}`, { label: view.name });
  }, [state.dispatch, updateView, view, viewId]);

  if (!view)
    return <DirectDetailStatus status={status} noun="saved view" width={width} height={height} />;
  return (
    <IssueFeed
      {...ctx}
      client={client}
      org={org}
      state={state}
      reloadToken={reloadToken}
      width={width}
      height={height}
      updateView={updateView}
      title={view.name}
      description={view.query}
    />
  );
}
