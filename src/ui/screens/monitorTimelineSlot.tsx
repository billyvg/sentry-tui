/**
 * The check-in timeline on a monitor's detail pane.
 *
 * The row's version (`monitorTimeline.tsx`) draws the same history in a
 * shed-able column of at most 72 cells; this draws it across the pane, which
 * is the whole reason the detail view has a section for it. Everything below
 * the width is shared: one renderer (`ui/components/CheckInTimeline`), one
 * fetch (`ui/hooks/useCheckInStats`), one status palette
 * (`core/checkInTimeline`), one window.
 *
 * Two things this has to get right, both of which look exactly like a monitor
 * that has never checked in when they are got wrong:
 *
 * - A *failed* stats request draws `[]`, never `undefined`. `undefined` is the
 *   pending rail, and a pane that starts drawing it on an error never stops.
 * - It says so out loud in the status bar, for the same reason: the rest of
 *   the pane is fine, so nothing else on screen would give the failure away.
 */

import { useEffect, useMemo, useRef } from "react";

import type { SentryClient } from "~/api/client";
import type { Detector } from "~/api/detectors";
import { errorOf, valueOf } from "~/core/async";
import { timelineStylesFor, timelineWindowLabel, type TimelineStyle } from "~/core/checkInTimeline";
import { cronMonitor } from "~/core/detectors";
import type { Theme } from "~/core/theme";
import { useTheme } from "~/ui/theme";
import { foldCheckIns, summariseTimeline, type StatsBucket } from "~/lib/checkInTimeline";
import { CheckInTimeline } from "~/ui/components/CheckInTimeline";
import { BODY_INDENT, Empty } from "~/ui/components/DetailSections";
import type { Notice } from "~/ui/components/StatusBar";
import { cronBuckets, uptimeBuckets, useCheckInStats } from "~/ui/hooks/useCheckInStats";
import { timelineKindFor } from "~/ui/screens/monitorTimeline";

/** What the section is given, matching the other sections' props. */
export interface DetectorTimelineProps {
  detector: Detector;
  /** The pane's interior width — the whole point of the detail-pane timeline. */
  width: number;
  client: SentryClient | null;
  org: string;
  reloadToken: number;
  /** The status bar, for saying that the history could not be loaded. */
  notify: (notice: Notice) => void;
}

/**
 * Whether this detector has a check-in timeline to show.
 *
 * Cron and uptime — the two types that check in on a schedule, and the same
 * test the list makes before trading its middle columns for a track. Kept
 * separate from the component so the *section list* can be built without
 * rendering anything: sections are numbered by position, so which ones exist
 * has to be known before any of them draws.
 */
export function hasDetectorTimeline(detector: Detector): boolean {
  return timelineKindFor(detector.type) !== undefined;
}

/**
 * The timeline section's body: the window it covers, the track, and a tally.
 *
 * A component rather than a render function because it fetches — one detector
 * through the same batched hook the list uses for a page of them, rather than
 * a second fetch path that would drift from it. That hook is also what applies
 * the uptime endpoint's resolution ladder: this pane is wider than a row cell
 * and so asks for a finer bucket than the list did, and a raw width-derived
 * resolution is a 400 that renders as an empty track.
 */
export function DetectorTimelineSection({
  detector,
  width,
  client,
  org,
  reloadToken,
  notify,
}: DetectorTimelineProps) {
  const theme = useTheme();
  const timelineStyles = timelineStylesFor(theme);
  const kind = timelineKindFor(detector.type);
  // Cron stats are keyed by the monitor behind the detector; uptime stats by
  // the detector itself, which the endpoint maps to a subscription.
  const monitorId = kind === "cron" ? cronMonitor(detector)?.id : undefined;

  const monitorIds = useMemo(() => (monitorId ? [monitorId] : []), [monitorId]);
  const uptimeDetectorIds = useMemo(
    () => (kind === "uptime" ? [detector.id] : []),
    [kind, detector.id],
  );

  // The track is indented with every other section body, so it asks for the
  // cells it will actually occupy.
  const trackWidth = Math.max(0, width - BODY_INDENT.length);

  const status = useCheckInStats(client, {
    org,
    monitorIds,
    uptimeDetectorIds,
    width: trackWidth,
    reloadToken,
  });

  const stats = valueOf(status);
  const failed = status.state === "error" && stats === undefined;

  /**
   * Say so when the history is missing because the request failed.
   *
   * One notice per failure; the ref is what stops it firing on every render
   * while the error state persists. The same warning the list raises, in the
   * same words — it is the same failure.
   */
  const notified = useRef<string | undefined>(undefined);
  const error = errorOf(status)?.message;
  useEffect(() => {
    if (error && notified.current !== error) {
      notify({ kind: "warning", text: "check-in history unavailable" });
    }
    notified.current = error;
  }, [error, notify]);

  if (!kind) return null;
  if (kind === "cron" && !monitorId) {
    // No cron monitor behind the detector, so no request was made and none can
    // be: an empty track would be a claim rather than a placeholder.
    return <Empty>This monitor has no check-in source.</Empty>;
  }

  const since = stats?.window.since ?? 0;
  const until = stats?.window.until ?? 0;

  return (
    <box style={{ flexDirection: "column", width }}>
      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.muted}>{`${BODY_INDENT}${timelineWindowLabel()}`}</text>
        {environmentNote(detector, theme)}
      </box>

      {kind === "uptime" ? (
        <Track
          buckets={failed ? [] : uptimeBuckets(stats, detector.id)}
          style={timelineStyles.uptime}
          width={trackWidth}
          since={since}
          until={until}
        />
      ) : (
        <Track
          buckets={failed ? [] : cronBuckets(stats, monitorId)}
          style={timelineStyles.cron}
          width={trackWidth}
          since={since}
          until={until}
        />
      )}
    </box>
  );
}

/** The track itself, and the tally under it. Generic so both kinds share it. */
function Track<S extends string>({
  buckets,
  style,
  width,
  since,
  until,
}: {
  buckets: readonly StatsBucket<S>[] | undefined;
  style: TimelineStyle<S>;
  width: number;
  since: number;
  until: number;
}) {
  return (
    <>
      <box style={{ flexDirection: "row", width: width + BODY_INDENT.length }}>
        <text>{BODY_INDENT}</text>
        <CheckInTimeline
          buckets={buckets}
          style={style}
          width={width}
          since={since}
          until={until}
        />
      </box>
      <Tally buckets={buckets} style={style} width={width} since={since} until={until} />
    </>
  );
}

/**
 * `142 okay · 3 failed`, under the track.
 *
 * The row has no room for this; the pane does, and a track without it makes
 * you count cells. It folds the buckets a second time rather than reaching
 * into the component's fold: `foldCheckIns` is pure and this is a few dozen
 * cells, where sharing one fold would mean `CheckInTimeline` returning data as
 * well as drawing it.
 */
function Tally<S extends string>({
  buckets,
  style,
  width,
  since,
  until,
}: {
  buckets: readonly StatsBucket<S>[] | undefined;
  style: TimelineStyle<S>;
  width: number;
  since: number;
  until: number;
}) {
  if (!buckets || buckets.length === 0) return null;

  const cells = foldCheckIns(buckets, { width, since, until, config: style.config });
  const totals = summariseTimeline(cells, style.config);
  if (totals.length === 0) return null;

  return (
    <box style={{ flexDirection: "row", width: width + BODY_INDENT.length }}>
      <text>{BODY_INDENT}</text>
      {totals.map((entry, index) => (
        <text key={entry.status} fg={style.colors[entry.status]}>
          {`${index > 0 ? " · " : ""}${entry.count} ${entry.label}`}
        </text>
      ))}
    </box>
  );
}

/**
 * Which environments the track covers.
 *
 * A cron monitor checks in from one environment per source and the web draws a
 * track for each; this sums them into one, so it says so whenever there is
 * more than one being summed.
 */
function environmentNote(detector: Detector, theme: Theme) {
  const environments = cronMonitor(detector)?.environments ?? [];
  if (environments.length < 2) return null;
  return <text fg={theme.subText}>{`  (all ${environments.length} environments)`}</text>;
}
