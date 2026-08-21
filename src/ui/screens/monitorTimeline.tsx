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

import type { Detector } from "~/api/detectors";
import {
  CRON_TIMELINE_STYLE,
  timelineWindowLabel,
  UPTIME_TIMELINE_STYLE,
} from "~/core/checkInTimeline";
import { cronMonitor } from "~/core/detectors";
import { theme } from "~/core/theme";
import { padText } from "~/lib/text";
import type { Column } from "~/ui/components/DataTable";
import { CheckInTimeline } from "~/ui/components/CheckInTimeline";
import { cronBuckets, uptimeBuckets, type CheckInStats } from "~/ui/hooks/useCheckInStats";

/** Detector types that have a check-in history worth drawing. */
export type TimelineKind = "cron" | "uptime";

/** Detector type strings, as `core/monitors.ts` and the API spell them. */
const CRON_TYPE = "monitor_check_in_failure";
const UPTIME_TYPE = "uptime_domain_failure";

/**
 * Which screens draw a timeline, keyed by the detector type their view
 * filters to. Everything else gets the standard five columns.
 */
export function timelineKindFor(detectorType: string | undefined): TimelineKind | undefined {
  if (detectorType === CRON_TYPE) return "cron";
  if (detectorType === UPTIME_TYPE) return "uptime";
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

export interface TimelineColumnContext {
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
}

/**
 * The visualization column to hand `monitorColumns`.
 *
 * Typed per row rather than per screen: the screen's query fixes the type, but
 * a user can type `type:…` into the search box and land other kinds of monitor
 * on a Cron screen. A row with no check-in history leaves the cell blank
 * rather than drawing an empty timeline it never had.
 */
export function timelineColumn({ stats, failed, width }: TimelineColumnContext): Column<Detector> {
  return {
    key: "check-ins",
    // There is no axis under the row, so the header is where the window is
    // stated. It is the only place a reader can learn what the cells span, and
    // it comes from the window itself so the two cannot disagree.
    label: timelineWindowLabel(),
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
            style={UPTIME_TIMELINE_STYLE}
            width={cellWidth}
            since={since}
            until={until}
          />
        );
      }

      // A cron detector with no monitor behind it can never have stats, so it
      // draws the track rather than waiting forever on a request nothing sent.
      const monitorId = cronMonitor(detector)?.id;
      return (
        <CheckInTimeline
          buckets={failed || !monitorId ? [] : cronBuckets(stats, monitorId)}
          style={CRON_TIMELINE_STYLE}
          width={cellWidth}
          since={since}
          until={until}
        />
      );
    },
  };
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
