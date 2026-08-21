/**
 * The slot the check-in timeline drops into on a monitor's detail pane.
 *
 * The timeline itself belongs to #82, which is building it for the *list row*
 * — a squeezed strip in a shed-able column. The detail pane is where the same
 * renderer gets the full width of the pane, so this file is deliberately two
 * small functions and no drawing code: there must be exactly one timeline
 * implementation in the app, and it is not this one.
 *
 * ## Filling it in
 *
 * `feat/monitors-timeline` brings:
 *
 * - `src/lib/checkInTimeline.ts` — the pure renderer (buckets → glyph row)
 * - `src/ui/components/CheckInTimeline.tsx` — the component around it
 * - `src/ui/hooks/useCheckInStats.ts` — the batched `monitors-stats/` and
 *   `uptime-stats/` fetch
 *
 * With those on the branch, this becomes:
 *
 * 1. `hasDetectorTimeline` returns true for `monitor_check_in_failure` and
 *    `uptime_domain_failure` — the two types that check in on a schedule.
 * 2. `DetectorTimelineSection` calls `useCheckInStats` for this one detector
 *    and renders `<CheckInTimeline>` at the `width` it is handed, which is the
 *    pane's interior rather than a cell.
 *
 * Nothing else in `MonitorDetail` changes: the section appears in the list,
 * numbered and foldable, as soon as `hasDetectorTimeline` says it exists. Its
 * cron monitor and environments are reachable through `cronMonitor(detector)`
 * in `core/detectors.ts`, which is what `monitors-stats/` is keyed by.
 *
 * Until then the section is absent rather than empty: a detail pane with a
 * "Check-ins" heading over a "not built yet" line is worse than one that does
 * not mention check-ins at all.
 */

import type { ReactNode } from "react";

import type { Detector } from "~/api/detectors";
import type { SentryClient } from "~/api/client";

/** What the section is given, matching the other sections' props. */
export interface DetectorTimelineProps {
  detector: Detector;
  /** The pane's interior width — the whole point of the detail-pane timeline. */
  width: number;
  client: SentryClient | null;
  org: string;
  reloadToken: number;
}

/**
 * Whether this detector has a check-in timeline to show.
 *
 * False for every type until #82 lands; then true for cron and uptime. Kept
 * separate from the component so the *section list* can be built without
 * rendering anything — the section is numbered by its position, so it has to
 * be known before the fold state is resolved.
 */
export function hasDetectorTimeline(_detector: Detector): boolean {
  return false;
}

/**
 * The timeline section's body.
 *
 * A component rather than a render function so that filling it in can use
 * hooks — `useCheckInStats` is one — without changing anything here.
 */
export function DetectorTimelineSection(_props: DetectorTimelineProps): ReactNode {
  return null;
}
