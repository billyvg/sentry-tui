/**
 * Theme colours for the check-in timeline.
 *
 * The glyphs live in `src/lib/checkInTimeline.ts`, which is dependency-free
 * and so cannot see the palette; this is the other half. Kept in `core/`
 * rather than in the component because `scripts/check-theme-contrast.test.ts`
 * has to read it, and a contrast check should not have to mount a renderer.
 *
 * Every value is an existing token. The timeline introduces no new colours —
 * what it introduces is the requirement that these six be told apart *from
 * each other* at one character wide, which is what the contrast test now
 * asserts alongside their readability.
 */

import { DEFAULT_TIMELINE_WINDOW_SECONDS } from "~/api/monitorStats";
import type { Theme } from "~/core/theme";
import {
  CRON_TIMELINE,
  UPTIME_TIMELINE,
  type CronCheckInStatus,
  type TimelineStatusConfig,
  type UptimeCheckStatus,
} from "~/lib/checkInTimeline";

/** Everything needed to draw one kind of monitor's timeline. */
export interface TimelineStyle<S extends string> {
  config: TimelineStatusConfig<S>;
  colors: Readonly<Record<S, string>>;
  trackColor: string;
}

/** Derive both timeline styles from the palette active for this render. */
export function timelineStylesFor(selectedTheme: Theme): {
  cron: TimelineStyle<CronCheckInStatus>;
  uptime: TimelineStyle<UptimeCheckStatus>;
} {
  const trackColor = selectedTheme.border;
  return {
    cron: {
      config: CRON_TIMELINE,
      colors: {
        ok: selectedTheme.success,
        missed: selectedTheme.muted,
        timeout: selectedTheme.warning,
        error: selectedTheme.danger,
        in_progress: selectedTheme.accent,
        unknown: selectedTheme.subText,
      },
      trackColor,
    },
    uptime: {
      config: UPTIME_TIMELINE,
      colors: {
        success: selectedTheme.success,
        failure: selectedTheme.danger,
        failure_incident: selectedTheme.danger,
        missed_window: selectedTheme.subText,
      },
      trackColor,
    },
  };
}

/**
 * What to call the span a timeline covers.
 *
 * There is no axis under a track — not in a table cell, and not on the detail
 * pane either — so this string is the only place a reader learns what the
 * cells add up to. Callers pass the window they fetched, so a selected date
 * range changes the caption without restating its label. The one-day default
 * remains for surfaces without a range control. The adjacent test holds both
 * forms to the same formatter.
 */
export function timelineWindowLabel(seconds: number = DEFAULT_TIMELINE_WINDOW_SECONDS): string {
  const hours = Math.round(seconds / 3600);
  if (hours <= 0) return "Last hour";
  if (hours === 1) return "Last hour";
  if (hours % 24 !== 0) return `Last ${hours} hours`;
  const days = hours / 24;
  // A day reads as "24 hours" the way Sentry's own range picker says it.
  return days === 1 ? "Last 24 hours" : `Last ${days} days`;
}
