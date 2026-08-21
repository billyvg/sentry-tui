/**
 * Issues › All Views — the saved-search list, wired to the screen contract.
 *
 * The list itself is `IssueViewsList`. Opening a row pushes the saved search's
 * *results* as a view of their own: it gets a state slice seeded with the
 * view's query, sort, period and projects, so the stream on top of it behaves
 * like any other — search, filters, triage — and Escape drops back to the list
 * with its cursor where it was left.
 */

import { useCallback } from "react";

import { SAVED_VIEW_STATE_KEY } from "~/core/screens";
import { rowsOf } from "~/ui/hooks/useScreenState";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { IssueStreamView } from "~/ui/screens/IssueFeed";
import { IssueViewsList, type SavedViewRow } from "~/ui/screens/IssueViewsList";
import type { ScreenProps, ViewStackEntry } from "~/ui/screens/types";

export function IssueViews(props: ScreenProps) {
  const { client, org, state, focused, width, height, reloadToken, pushView, registerActions } =
    props;
  const { setStatus } = state;

  const open = useCallback(
    (index: number) => {
      const row = rowsOf<SavedViewRow>(state)[index];
      if (row) pushView(savedViewStream(row));
    },
    [state, pushView],
  );
  useScreenActions(registerActions, { open });

  const handleStatus = useCallback(
    (status: { loading: boolean; error?: string }) => setStatus({ ...status, noun: "saved views" }),
    [setStatus],
  );

  return (
    <IssueViewsList
      client={client}
      org={org}
      width={width}
      height={height}
      focused={focused}
      selectedIndex={state.selected}
      onRowsChange={state.setEntries}
      onStatusChange={handleStatus}
      reloadToken={reloadToken}
    />
  );
}

/** A saved search's results, as a view on the stack. */
function savedViewStream(row: SavedViewRow): ViewStackEntry {
  return {
    id: `saved-view:${row.view.id}`,
    label: row.view.name,
    stateKey: SAVED_VIEW_STATE_KEY,
    // Opening a saved search means showing *its* filters, not the ones the
    // last one left behind in the slice.
    initialState: {
      query: row.view.query,
      sort: row.view.querySort,
      statsPeriod: row.statsPeriod,
      selectedProjects: row.projectSlugs,
      selectedEnvs: row.view.environments,
    },
    render: (ctx) =>
      ctx.state ? (
        <IssueStreamView
          {...ctx}
          state={ctx.state}
          title={row.view.name}
          description={row.view.query}
        />
      ) : null,
  };
}
