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
 * The columns live in `monitorColumns.tsx`. Cron and Uptime hand it a
 * visualization column and the three middle columns give way to a check-in
 * timeline — `monitorTimeline.tsx` builds that, and the stats behind it are
 * fetched once for the whole page rather than once per row.
 *
 * Read-only: nothing here enables, disables, or edits a monitor.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Detector } from "~/api/detectors";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { buildDetectorQuery, getMonitorListView, type MonitorListView } from "~/core/monitors";
import { theme } from "~/core/theme";
import { DataTable } from "~/ui/components/DataTable";
import { SearchInput } from "~/ui/components/SearchInput";
import { useCheckInStats } from "~/ui/hooks/useCheckInStats";
import { useDetectors } from "~/ui/hooks/useDetectors";
import { useProjects } from "~/ui/hooks/useProjects";
import { BOLD } from "~/ui/lib/attributes";
import {
  monitorColumns,
  MONITOR_MIN_FLEX,
  renderDetectorDetail,
} from "~/ui/screens/monitorColumns";
import {
  timelineColumn,
  timelineColumnWidth,
  timelineKindFor,
  timelineStatsIds,
} from "~/ui/screens/monitorTimeline";
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

  const status = useDetectors(client, { org, query, reloadToken });
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
   * Cron and Uptime trade their three middle columns for a check-in timeline.
   *
   * Keyed off the view's detector type rather than the screen id, so the two
   * screens that have a history to draw are named once, in `core/monitors.ts`,
   * and nothing here restates which ids those are.
   */
  const timelineKind = timelineKindFor(view.type);
  const trackWidth = timelineColumnWidth(width);
  const { monitorIds, uptimeDetectorIds } = useMemo(
    () => (timelineKind ? timelineStatsIds(rows) : { monitorIds: [], uptimeDetectorIds: [] }),
    [timelineKind, rows],
  );

  // One request per endpoint for the whole page — see `useCheckInStats`. It
  // stands down entirely on the five screens with no timeline, because both
  // id lists are empty there.
  const statsStatus = useCheckInStats(client, {
    org,
    monitorIds,
    uptimeDetectorIds,
    width: trackWidth,
    reloadToken,
  });
  const stats = valueOf(statsStatus);
  // Nothing to draw and nothing coming: the rows show the unlit track rather
  // than a pending rail that never resolves.
  const statsFailed = statsStatus.state === "error" && stats === undefined;

  /**
   * Say so when the timelines are missing because the request failed.
   *
   * A degraded timeline looks exactly like a monitor that never checked in,
   * and the list itself is fine, so nothing else on screen would give it away.
   * One notice per failure — the ref is what stops it firing on every render
   * while the error state persists.
   */
  const { notify } = props;
  const notifiedError = useRef<string | undefined>(undefined);
  const statsError = errorOf(statsStatus)?.message;
  useEffect(() => {
    if (!timelineKind) return;
    if (statsError && notifiedError.current !== statsError) {
      notify({ kind: "warning", text: "check-in history unavailable" });
    }
    notifiedError.current = statsError;
  }, [timelineKind, statsError, notify]);

  const columns = useMemo(
    () =>
      monitorColumns(
        timelineKind
          ? { visualization: timelineColumn({ stats, failed: statsFailed, width: trackWidth }) }
          : undefined,
      ),
    [timelineKind, stats, statsFailed, trackWidth],
  );
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
