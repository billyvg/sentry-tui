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

import { DETECTOR_SORT_OPTIONS, detectorSort, type Detector } from "~/api/detectors";
import { timelineWindowSeconds } from "~/api/monitorStats";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { buildDetectorQuery, getMonitorListView, type MonitorListView } from "~/core/monitors";
import { useTheme } from "~/ui/theme";
import { DataTable } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { ResultFooter } from "~/ui/components/ResultFooter";
import { SearchInput } from "~/ui/components/SearchInput";
import { useCheckInStats } from "~/ui/hooks/useCheckInStats";
import { useDetectors } from "~/ui/hooks/useDetectors";
import { useProjectSlugs } from "~/ui/hooks/useProjects";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import { monitorDetailView } from "~/ui/screens/MonitorDetail";
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
const HEADING_ROWS = 4;

/** Every detector list can be narrowed by project. */
const MONITOR_FILTERS = ["project"] as const;

/** Cron and Uptime also use the selected period for their check-in timeline. */
const MONITOR_TIMELINE_FILTERS = ["project", "date"] as const;

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
  const theme = useTheme();
  const { client, org, screen, state, focused, width, height, reloadToken, onProjectSelect } =
    props;
  const { dispatch, focusSearch, handleSearchBlur } = state;

  const view = getMonitorListView(screen.id) ?? fallbackView(screen.item);
  const query = buildDetectorQuery(view, state.committedQuery);
  const sort = detectorSort(state.sort);
  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;

  const {
    detectors: status,
    nextCursor,
    page,
    nextPage,
    previousPage,
  } = useDetectors(client, {
    org,
    query,
    sortBy: sort,
    project,
    reloadToken,
  });
  const rows = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";
  const since = loadingSince(status);

  useEffect(() => {
    if (rows) dispatch({ type: "setEntries", payload: rows });
  }, [rows, dispatch]);

  const reportedPage = useRef(page);
  useEffect(() => {
    if (reportedPage.current === page) return;
    reportedPage.current = page;
    dispatch({ type: "setSelected", payload: 0 });
  }, [page, dispatch]);

  useEffect(() => {
    dispatch({
      type: "setStatus",
      payload: { loading, since, error: error?.message, noun: "monitors" },
    });
  }, [loading, since, error, dispatch]);

  // Resolve only the projects on this page: a detector carries a numeric id,
  // while its detail line wants the slug that project is called.
  const projectIds = useMemo(
    () => rows?.flatMap((row) => (row.projectId ? [row.projectId] : [])) ?? [],
    [rows],
  );
  const projectSlugs = useProjectSlugs(client, org, projectIds);

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
      pushView(monitorDetailView(row, slug ?? row.latestGroup?.project?.slug, state.statsPeriod));
    },
    [rows, pushView, projectSlugs, state.statsPeriod],
  );
  useScreenActions(props.registerActions, { open, nextPage, previousPage });

  const closeDropdown = useCallback(
    () => dispatch({ type: "setOpenDropdown", payload: null }),
    [dispatch],
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
  const windowSeconds = timelineWindowSeconds(state.statsPeriod);
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
    statsPeriod: state.statsPeriod,
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
        theme,
        timelineKind
          ? {
              visualization: timelineColumn({
                stats,
                failed: statsFailed,
                width: trackWidth,
                windowSeconds,
                theme,
              }),
            }
          : undefined,
      ),
    [timelineKind, stats, statsFailed, trackWidth, windowSeconds, theme],
  );
  const renderDetail = useCallback(
    (detector: Detector, _selected: boolean, detailWidth: number) =>
      renderDetectorDetail(detector, detailWidth, { projectSlugs, theme }),
    [projectSlugs, theme],
  );

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInput
        value={state.searchQuery}
        placeholder={view.searchPlaceholder}
        focused={state.searchFocused}
        width={width}
        onInput={(query) => dispatch({ type: "setSearchQuery", payload: query })}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.text} attributes={BOLD}>
          {view.title}
        </text>
        <text fg={theme.muted}>{`  ${view.description}`}</text>
      </box>
      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        filters={timelineKind ? MONITOR_TIMELINE_FILTERS : MONITOR_FILTERS}
        sort={{
          value: sort,
          items: DETECTOR_SORT_OPTIONS,
          onChange: (value) => dispatch({ type: "setSort", payload: value }),
        }}
        width={width}
        anchorTop={SEARCH_ROWS + 1}
        onProjectChange={onProjectSelect}
        onEnvChange={() => {}}
        onPeriodChange={(period) => dispatch({ type: "setStatsPeriod", payload: period })}
        onDropdownOpen={(dropdown) => dispatch({ type: "setOpenDropdown", payload: dropdown })}
        onDropdownClose={closeDropdown}
      />

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
      <ResultFooter
        count={rows?.length}
        noun="monitor"
        hasMore={nextCursor !== null}
        pagination={
          nextCursor !== null || page > 1
            ? {
                page,
                hasPrevious: page > 1,
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
