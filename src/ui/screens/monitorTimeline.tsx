/**
 * The check-in timeline as a Monitors table column.
 *
 * This is the half of #82 that meets #81: `monitorColumns` takes an optional
 * visualization and, given one, drops Last Issue, Assignee and Alerts to make
 * room — the same trade the web makes ("when there is a visualization,
 * prioritize showing it over the other columns"). What that visualization *is*
 * lives here.
 *
 * Only two of the seven Monitors screens have one. The web mounts a
 * `VisualizationCell` in `views/detectors/list/cron.tsx` and
 * `views/detectors/list/uptime.tsx` and nowhere else: an error or metric
 * detector has no check-in history to draw, so those screens keep the wider
 * column set.
 */

import { DETECTOR_TYPE, type Detector, type DetectorType } from "~/api/detectors";
import { timelineStylesFor, timelineWindowLabel } from "~/core/checkInTimeline";
import { cronMonitor } from "~/core/detectors";
import type { Theme } from "~/core/theme";
import { padText } from "~/lib/text";
import type { Column } from "~/ui/components/DataTable";
import { CheckInTimeline } from "~/ui/components/CheckInTimeline";
import { cronBuckets, uptimeBuckets, type CheckInStats } from "~/ui/hooks/useCheckInStats";

/** Detector types that have a check-in history worth drawing. */
export type TimelineKind = "cron" | "uptime";

/**
 * Which screens draw a timeline, keyed by the detector type their view
 * filters to. Everything else gets the standard five columns.
 */
export function timelineKindFor(detectorType: DetectorType | undefined): TimelineKind | undefined {
  if (detectorType === DETECTOR_TYPE.cron) return "cron";
  if (detectorType === DETECTOR_TYPE.uptime) return "uptime";
  return undefined;
}

/** The kind of timeline one row draws, which need not be its screen's. */
function rowKind(detector: Detector): TimelineKind | undefined {
  return timelineKindFor(detector.type);
}

/**
 * Narrowest a timeline is worth drawing.
 *
 * Below this the row says less than the three columns it displaced, so the
 * column is dropped and the standard set comes back.
 */
export const TIMELINE_MIN_WIDTH = 16;

/**
 * Widest it grows.
 *
 * A day across 120 cells is twelve-minute buckets, which is finer than any
 * monitor in Sentry checks in — past this the extra cells buy resolution
 * nothing reports, at the cost of the name column that identifies the row.
 */
export const TIMELINE_MAX_WIDTH = 72;

/** Share of the content pane the timeline asks for before the clamps apply. */
const TIMELINE_PANE_SHARE = 0.45;

/** Most cells an environment label may take from its timeline. */
const ENVIRONMENT_LABEL_MAX_WIDTH = 16;

/** A labelled timeline keeps enough cells to show a useful history shape. */
const ENVIRONMENT_TRACK_MIN_WIDTH = 8;

/**
 * Cells to give the timeline in a pane this wide.
 *
 * Deliberately a *fixed* column width rather than `"flex"`, which is what the
 * seam suggested: the number of buckets to request has to be known at the
 * screen, before any column is resolved, and a width the screen chose is a
 * number it already has. Guessing low would ask for fewer buckets than there
 * are cells and draw a comb where a bar belongs; `foldCheckIns` would still
 * produce a row of the right width, but a sparser one than the data allows.
 *
 * Name keeps `"flex"` and absorbs whatever is left, floored by
 * `MONITOR_MIN_FLEX` — so on a pane too narrow for both, `layoutColumns` drops
 * this column and the name survives, which is the right way round.
 */
export function timelineColumnWidth(paneWidth: number): number {
  const share = Math.floor(Math.max(0, paneWidth) * TIMELINE_PANE_SHARE);
  return Math.max(TIMELINE_MIN_WIDTH, Math.min(TIMELINE_MAX_WIDTH, share));
}

/**
 * Width of the actual check-in track inside a visualization column.
 *
 * Cron rows reserve a leading label for the environment; uptime rows use the
 * whole column. Stats resolution follows the cells that will really be drawn,
 * rather than requesting finer buckets for the label's cells too.
 */
export function timelineDataWidth(kind: TimelineKind, columnWidth: number): number {
  return kind === "cron" ? environmentTimelineWidths(columnWidth).track : columnWidth;
}

/** Lines the column area needs for one detector's environment tracks. */
export function timelineRowContentHeight(detector: Detector): number {
  if (rowKind(detector) !== "cron") return 1;
  return Math.max(1, cronEnvironmentNames(detector).length);
}

export interface TimelineColumnContext {
  /** Palette active for the table that owns this column. */
  theme: Theme;
  /** Fetched stats for every row on the page, or `undefined` while in flight. */
  stats: CheckInStats | undefined;
  /**
   * The stats request failed and there is nothing to fall back on. Rows draw
   * the unlit track rather than the pending rail — a row that says "loading"
   * for the rest of the session is worse than one that says "no data".
   */
  failed: boolean;
  /** Cells the column occupies — `timelineColumnWidth(paneWidth)`. */
  width: number;
  /** Selected window, used for the label before the first request settles. */
  windowSeconds: number;
}

/**
 * The visualization column to hand `monitorColumns`.
 *
 * Typed per row rather than per screen: the screen's query fixes the type, but
 * a user can type `type:…` into the search box and land other kinds of monitor
 * on a Cron screen. A row with no check-in history leaves the cell blank
 * rather than drawing an empty timeline it never had.
 */
export function timelineColumn({
  stats,
  failed,
  width,
  windowSeconds,
  theme,
}: TimelineColumnContext): Column<Detector> {
  const timelineStyles = timelineStylesFor(theme);
  const displayedWindowSeconds = stats ? stats.window.until - stats.window.since : windowSeconds;
  return {
    key: "check-ins",
    // There is no axis under the row, so the header is where the window is
    // stated. It is the only place a reader can learn what the cells span, and
    // it comes from the window itself so the two cannot disagree.
    label: timelineWindowLabel(displayedWindowSeconds),
    width,
    render: (detector, _selected, cellWidth) => {
      const kind = rowKind(detector);
      if (!kind) return <text fg={theme.subText}>{padText("", cellWidth)}</text>;

      const since = stats?.window.since ?? 0;
      const until = stats?.window.until ?? 0;

      if (kind === "uptime") {
        return (
          <CheckInTimeline
            buckets={failed ? [] : uptimeBuckets(stats, detector.id)}
            style={timelineStyles.uptime}
            width={cellWidth}
            since={since}
            until={until}
          />
        );
      }

      // A cron detector with no monitor behind it can never have stats, so it
      // draws the track rather than waiting forever on a request nothing sent.
      const monitor = cronMonitor(detector);
      const monitorId = monitor?.id;
      const environments = cronEnvironmentNames(detector);

      // Old or partial detector payloads can omit the environment list. Keep
      // the previous unscoped track for that shape: there is no honest label
      // to print, but any stats that did arrive remain useful.
      if (environments.length === 0) {
        return (
          <CheckInTimeline
            buckets={failed || !monitorId ? [] : cronBuckets(stats, monitorId)}
            style={timelineStyles.cron}
            width={cellWidth}
            since={since}
            until={until}
          />
        );
      }

      const environmentWidths = environmentTimelineWidths(cellWidth);
      return (
        <box style={{ flexDirection: "column", width: cellWidth }}>
          {environments.map((environment) => (
            <box key={environment} style={{ flexDirection: "row", width: cellWidth }}>
              {environmentWidths.label > 0 ? (
                <>
                  <text fg={theme.subText}>{padText(environment, environmentWidths.label)}</text>
                  <text>{" ".repeat(environmentWidths.gap)}</text>
                </>
              ) : null}
              <CheckInTimeline
                buckets={failed || !monitorId ? [] : cronBuckets(stats, monitorId, environment)}
                style={timelineStyles.cron}
                width={environmentWidths.track}
                since={since}
                until={until}
              />
            </box>
          ))}
        </box>
      );
    },
  };
}

/** Environment names in the same display order as the detector payload. */
function cronEnvironmentNames(detector: Detector): string[] {
  const names = (cronMonitor(detector)?.environments ?? [])
    .map((environment) => environment.name)
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}

/** Split a cron visualization column between its label and its track. */
function environmentTimelineWidths(width: number): { label: number; gap: number; track: number } {
  const available = Math.max(0, Math.floor(width));
  if (available <= ENVIRONMENT_TRACK_MIN_WIDTH + 1) {
    return { label: 0, gap: 0, track: available };
  }

  const gap = 1;
  const label = Math.min(
    ENVIRONMENT_LABEL_MAX_WIDTH,
    available - ENVIRONMENT_TRACK_MIN_WIDTH - gap,
  );
  return { label, gap, track: available - label - gap };
}

/**
 * The ids to ask each stats endpoint for, gathered from the rows on screen.
 *
 * Cron stats are keyed by the *monitor* behind the detector
 * (`cronMonitor(detector).id`); uptime stats are keyed by the detector's own
 * id, which the endpoint maps to a subscription server-side
 * (`organization_uptime_stats.py:53`). Both lists are gathered here so one
 * request per endpoint covers the whole page.
 */
export function timelineStatsIds(detectors: readonly Detector[] | undefined): {
  monitorIds: string[];
  uptimeDetectorIds: string[];
} {
  const monitorIds: string[] = [];
  const uptimeDetectorIds: string[] = [];

  for (const detector of detectors ?? []) {
    const kind = rowKind(detector);
    if (kind === "uptime") {
      uptimeDetectorIds.push(detector.id);
    } else if (kind === "cron") {
      const monitorId = cronMonitor(detector)?.id;
      if (monitorId) monitorIds.push(monitorId);
    }
  }

  return { monitorIds, uptimeDetectorIds };
}
