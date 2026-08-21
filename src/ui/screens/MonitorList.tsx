/**
 * Monitors › All Monitors, My Monitors, Error, Metric, Cron, Uptime and
 * Mobile Build.
 *
 * Seven destinations, one table over `GET /organizations/{org}/detectors/`,
 * configured per screen by `core/monitors.ts` — they differ only by the filter
 * their query carries. Two lines per row, the same anatomy as the web's
 * 76px-tall detector row: `Name · Type · Last Issue · Assignee · Alerts`, and
 * under it the type-dependent detail line `core/detectors.ts` builds.
 *
 * The columns live in `monitorColumns.tsx`, which is also where a check-in
 * timeline slots in: hand `monitorColumns` a visualization column and the
 * three middle columns give way to it.
 *
 * Read-only: nothing here enables, disables, or edits a monitor.
 */

import { useCallback, useEffect, useMemo } from "react";

import type { Detector } from "~/api/detectors";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { buildDetectorQuery, getMonitorListView, type MonitorListView } from "~/core/monitors";
import { theme } from "~/core/theme";
import { DataTable } from "~/ui/components/DataTable";
import { SearchInput } from "~/ui/components/SearchInput";
import { useDetectors } from "~/ui/hooks/useDetectors";
import { useProjects } from "~/ui/hooks/useProjects";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import { monitorDetailView } from "~/ui/screens/MonitorDetail";
import {
  monitorColumns,
  MONITOR_MIN_FLEX,
  renderDetectorDetail,
} from "~/ui/screens/monitorColumns";
import type { ScreenProps } from "~/ui/screens/types";

/** The two lines of screen heading between the search box and the table. */
const HEADING_ROWS = 2;

/**
 * What a screen falls back to when its id has no configuration.
 *
 * Every id in `SCREEN_COMPONENTS` pointing here has one, and
 * `src/core/monitors.test.ts` is what keeps that true — but the table is a
 * `Partial`, so this is what makes the type honest.
 */
function fallbackView(item: string): MonitorListView {
  return {
    title: item,
    description: "",
    searchPlaceholder: "Search monitors…",
    emptyTitle: "No monitors found.",
    emptyLines: ["This organization may not have monitors (the workflow engine) enabled."],
  };
}

export function MonitorList(props: ScreenProps) {
  const { client, org, screen, state, focused, width, height, reloadToken } = props;
  const { setEntries, setStatus, setOpenDropdown, focusSearch, handleSearchBlur } = state;

  const view = getMonitorListView(screen.id) ?? fallbackView(screen.item);
  const query = buildDetectorQuery(view, state.committedQuery);

  // `resetKey` is the screen: the seven share a slice *and* a component
  // instance, so without it this screen opens showing the last one's rows.
  const status = useDetectors(client, { org, query, reloadToken, resetKey: screen.id });
  const rows = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";
  const since = loadingSince(status);

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({ loading, since, error: error?.message, noun: "monitors" });
  }, [loading, since, error, setStatus]);

  /**
   * Make `P` / `E` / `D` no-ops instead of a soft keyboard lock.
   *
   * The app's key router opens a filter dropdown for any list screen, and only
   * the `Dropdown` component's own listener closes one — so a screen that
   * renders no `FilterBar` has nothing to close what the router just opened,
   * and every key after it goes to a dropdown that isn't on screen.
   *
   * The detector list takes neither an environment nor a period, and the one
   * page filter it does take (project) has nowhere to live until `FilterBar`
   * can render a subset of its chips — so, as on the dashboards list, the
   * three keys do nothing rather than do damage.
   */
  useEffect(() => {
    if (state.openDropdown) setOpenDropdown(null);
  }, [state.openDropdown, setOpenDropdown]);

  // Project slugs for the detail line: a detector carries a numeric
  // `projectId`, and only the projects list knows what that is called.
  const projects = useProjects(client, org);
  const projectSlugs = useMemo(
    () => new Map(projects.map((project) => [project.id, project.slug])),
    [projects],
  );

  /**
   * Enter opens the monitor under the cursor.
   *
   * The row it pushes is the one the list already has — the list endpoint
   * returns the same serializer the detail endpoint does — so the pane paints
   * with no request of its own, and the project slug goes with it rather than
   * being resolved a second time.
   *
   * Read from `rows` rather than from `state.entries`, which is what the
   * contract's example does. The seven Monitors screens share one slice, and
   * that slice still holds the *previous* screen's detectors until this
   * screen's fetch lands — so `state.entries` during the skeleton is Cron's
   * rows on the Metric screen, and Enter opened a monitor that wasn't on
   * screen. Caught in a real terminal, not by a test. `rows` is undefined
   * until the fetch lands, so Enter does nothing while the skeleton is up,
   * which is the honest answer.
   */
  const { pushView } = props;
  const open = useCallback(
    (index: number) => {
      const row = rows?.[index];
      if (!row) return;
      const slug = row.projectId ? projectSlugs.get(row.projectId) : undefined;
      pushView(monitorDetailView(row, slug ?? row.latestGroup?.project?.slug));
    },
    [rows, pushView, projectSlugs],
  );
  useScreenActions(props.registerActions, { open });

  const columns = useMemo(() => monitorColumns(), []);
  const renderDetail = useCallback(
    (detector: Detector, _selected: boolean, detailWidth: number) =>
      renderDetectorDetail(detector, detailWidth, { projectSlugs }),
    [projectSlugs],
  );

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInput
        value={state.searchQuery}
        placeholder={view.searchPlaceholder}
        focused={state.searchFocused}
        width={width}
        onInput={state.setSearchQuery}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.text} attributes={BOLD}>
          {view.title}
        </text>
        <text fg={theme.muted}>{`  ${view.description}`}</text>
      </box>
      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.subText}>{rows ? countLabel(rows.length) : ""}</text>
      </box>

      <DataTable
        rows={rows}
        columns={columns}
        width={width}
        minFlex={MONITOR_MIN_FLEX}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(detector) => detector.id}
        loading={isInitialLoad(status)}
        error={error}
        errorTitle="Failed to load monitors"
        onRowClick={props.activateRow}
        renderDetail={renderDetail}
        empty={{
          title: view.emptyTitle,
          lines: [state.committedQuery || undefined, ...view.emptyLines],
        }}
        layout={[height, HEADING_ROWS]}
      />
    </box>
  );
}

/** `3 monitors`, agreeing in number. */
function countLabel(count: number): string {
  return `${count} ${count === 1 ? "monitor" : "monitors"}`;
}
