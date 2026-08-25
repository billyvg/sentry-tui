/**
 * A dashboard's widgets, stacked.
 *
 * The web lays widgets out on a 6-column responsive react-grid-layout
 * (`views/dashboards/dashboard.tsx`). At eighty columns that grid gives you
 * widgets thirteen cells wide, so this keeps the author's reading order —
 * `layout.y`, then `layout.x` — and draws one widget per row, full width, with
 * `j`/`k` stepping between them.
 *
 * Pushed onto the view stack with a `stateKey`, so the app drives the widget
 * cursor and the page filters exactly as it does a screen's, and Escape drops
 * back to the list with its own cursor intact.
 *
 * Read-only: no widget or dashboard editing, per the plan's scope.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ScrollBoxRenderable } from "@opentui/core";

import { widgetRenderKind } from "~/api/dashboardWidgets";
import type { DashboardListItem, DashboardWidget } from "~/api/dashboards";
import { errorOf, valueOf } from "~/core/async";
import { DASHBOARD_DETAIL_STATE_KEY } from "~/core/screens";
import { useTheme } from "~/ui/theme";
import { fitText } from "~/lib/text";
import { FilterBar } from "~/ui/components/FilterBar";
import { WidgetCard } from "~/ui/components/WidgetCard";
import { useDashboardDetail, useWidgetData, widgetKey } from "~/ui/hooks/useDashboardDetail";
import type { ScreenState } from "~/ui/hooks/useScreenState";
import { BOLD, DIM } from "~/ui/lib/attributes";
import { orderWidgets, scrollTopForWidget, widgetCardHeight } from "~/ui/lib/widgetStack";
import type { DetailContext, ViewStackEntry } from "~/ui/screens/types";

/**
 * Widgets fetched before the cursor has moved anywhere.
 *
 * Two, not thirty: the first screenful is one or two cards tall, and a
 * dashboard at `MAX_WIDGETS` would otherwise open with thirty `events/` calls
 * in flight.
 */
const INITIAL_WIDGETS = 2;

/** Widgets kept fetched ahead of the cursor, so `j` lands on data, not a skeleton. */
const LOOKAHEAD = 2;

/** Stats period a dashboard opens on before its own saved period arrives. */
const DEFAULT_DASHBOARD_PERIOD = "14d";

/** Cells the widget stack's scrollbar takes out of its own viewport. */
const SCROLLBAR_GUTTER = 2;

/** Rows above the stack: the heading and the filter row with its margins. */
const HEADER_ROWS = 1;

/** A dashboard's widget grid, as a view on the stack. */
export function dashboardDetailView(row: DashboardListItem): ViewStackEntry {
  return {
    id: `dashboard:${row.id}`,
    label: row.title,
    stateKey: DASHBOARD_DETAIL_STATE_KEY,
    // Opening a dashboard means showing *its* filters, not the ones the last
    // one left in the slice. The saved period arrives with the detail response
    // and is applied then; the environments are already on the list row.
    initialState: {
      statsPeriod: DEFAULT_DASHBOARD_PERIOD,
      selectedEnvs: row.environment ?? [],
      selectedProjects: [],
    },
    render: (ctx) =>
      ctx.state ? <DashboardWidgetGrid {...ctx} state={ctx.state} dashboard={row} /> : null,
  };
}

/** A dashboard detail addressed by id before its list row has been fetched. */
export function dashboardUrlView(dashboardId: string): ViewStackEntry {
  return dashboardDetailView({
    id: dashboardId,
    title: `Dashboard ${dashboardId}`,
    widgetDisplay: [],
  });
}

interface DashboardWidgetGridProps extends DetailContext {
  state: ScreenState;
  /** The list row the view was opened from — its title and widget shapes. */
  dashboard: DashboardListItem;
}

export function DashboardWidgetGrid({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  dashboard,
  updateView,
}: DashboardWidgetGridProps) {
  const theme = useTheme();
  const { setEntries, setStatus, setOpenDropdown, setStatsPeriod } = state;
  const listRef = useRef<ScrollBoxRenderable>(null);

  const detail = useDashboardDetail(client, { org, id: dashboard.id, reloadToken });
  const details = valueOf(detail);
  const error = errorOf(detail);
  const loading = detail.state === "loading";

  useEffect(() => {
    if (details) updateView(`dashboard:${dashboard.id}`, { label: details.title });
  }, [details, dashboard.id, updateView]);

  const widgets = useMemo(() => orderWidgets(details?.widgets ?? []), [details]);

  /**
   * Cards to draw before the dashboard itself lands.
   *
   * The list row already carries one `displayType` per widget
   * (`DashboardListItem.widgetDisplay`), which is everything the layout needs —
   * so the grid opens at its real geometry and the cards fill in rather than
   * appearing.
   */
  const placeholders = useMemo(
    () =>
      (dashboard.widgetDisplay ?? []).map((displayType, index): DashboardWidget => ({
        id: `placeholder-${index}`,
        title: "",
        displayType,
        queries: [],
      })),
    [dashboard.widgetDisplay],
  );

  const showing = details ? widgets : placeholders;
  const isPlaceholder = !details;
  /**
   * A Sentry-built dashboard, whose widgets the API never sends: they live in
   * the web app's own `prebuiltConfigs`, and the detail response carries only
   * the shell. Worth saying out loud rather than reading as an empty dashboard.
   */
  const isPrebuilt = Boolean(details?.prebuiltId ?? dashboard.prebuiltId);

  useEffect(() => {
    setEntries(widgets);
  }, [widgets, setEntries]);

  useEffect(() => {
    setStatus({ loading, error: error?.message, noun: "dashboard" });
  }, [loading, error, setStatus]);

  /**
   * The dashboard's own saved period, applied once.
   *
   * Guarded by id rather than run on every response: the user may change the
   * period, and a refresh must not put it back.
   */
  const seededPeriod = useRef<string | null>(null);
  useEffect(() => {
    if (!details?.period || seededPeriod.current === details.id) return;
    seededPeriod.current = details.id;
    setStatsPeriod(details.period);
  }, [details, setStatsPeriod]);

  /**
   * How far down the stack the data has been asked for. Only ever rises, so
   * scrolling back up doesn't re-request what is already on screen.
   */
  const [upto, setUpto] = useState(INITIAL_WIDGETS);
  useEffect(() => {
    setUpto((current) => Math.max(current, state.selected + 1 + LOOKAHEAD));
  }, [state.selected]);

  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;

  const data = useWidgetData(client, {
    org,
    dashboardId: dashboard.id,
    widgets,
    upto,
    statsPeriod: state.statsPeriod,
    project,
    environment,
    reloadToken,
  });

  const cardWidth = Math.max(20, width - SCROLLBAR_GUTTER);
  const heights = useMemo(
    () => showing.map((widget) => widgetCardHeight(widget, widgetRenderKind(widget.displayType))),
    [showing],
  );

  // The scrollbox never sees the cursor keys — the app's router owns them — so
  // the viewport has to be pulled along by hand. Card heights differ, so this
  // can't go through `useRowScrollFollow`.
  useEffect(() => {
    const box = listRef.current;
    if (!box || heights.length === 0) return;
    const viewportHeight = box.viewport.height;
    if (viewportHeight <= 0) return;
    const next = scrollTopForWidget({
      heights,
      index: state.selected,
      viewportHeight,
      scrollTop: box.scrollTop,
    });
    if (next !== box.scrollTop) box.scrollTop = next;
  }, [heights, state.selected, height]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <box style={{ flexDirection: "row", width, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.text} attributes={BOLD}>
          {fitText(details?.title ?? dashboard.title, Math.max(8, width - 24))}
        </text>
        <text fg={theme.muted}>
          {details?.period ? `  saved on ${details.period}` : "  read-only"}
        </text>
      </box>

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        // Keep the chip row clipped below about 90 cells rather than letting
        // it wrap into fragments that push the widget stack off screen.
        width={width}
        anchorTop={HEADER_ROWS}
        onProjectChange={state.setSelectedProjects}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={setOpenDropdown}
      />

      {error && !details ? (
        <box style={{ flexDirection: "column", padding: 1 }}>
          <text fg={theme.danger}>Failed to load dashboard</text>
          <text fg={theme.muted}>{error.message}</text>
          {error.retryable ? <text fg={theme.muted}>R to retry</text> : null}
        </box>
      ) : null}

      {details && showing.length === 0 ? (
        <box style={{ flexDirection: "column", padding: 1 }}>
          <text fg={theme.text}>
            {isPrebuilt
              ? "This Sentry Built dashboard is not bundled in this version."
              : "This dashboard has no widgets."}
          </text>
          <text fg={theme.muted}>
            {isPrebuilt
              ? "Its widgets live in Sentry Web rather than the API; open it on sentry.io to view them."
              : "Add one on sentry.io — this client is read-only."}
          </text>
        </box>
      ) : null}

      <scrollbox
        ref={listRef}
        focused={focused}
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
        }}
        style={{ flexGrow: 1, flexBasis: 0, width }}
      >
        {showing.map((widget, index) => (
          <WidgetCard
            key={widgetKey(widget, index)}
            widget={widget}
            kind={widgetRenderKind(widget.displayType)}
            status={data.get(widgetKey(widget, index))}
            width={cardWidth}
            height={heights[index]! - 1}
            selected={focused && index === state.selected}
            placeholder={isPlaceholder}
          />
        ))}
      </scrollbox>

      {showing.length > 0 ? (
        <text fg={theme.subText} attributes={DIM}>
          {fitText(
            ` widget ${Math.min(state.selected + 1, showing.length)} of ${showing.length} · j/k to move · esc to go back`,
            width,
          )}
        </text>
      ) : null}
    </box>
  );
}
