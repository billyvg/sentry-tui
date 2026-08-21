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

import { theme } from "~/core/theme";
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
}

/**
 * Colours for a cron row, from `tickStyle`
 * (`views/insights/crons/utils.tsx:50-76`) mapped onto this palette: the web's
 * `dataviz.semantic` good / bad / meh become success / danger / warning, and
 * its two greys become `muted` and `subText`.
 */
export const CRON_STATUS_COLORS: Readonly<Record<CronCheckInStatus, string>> = {
  ok: theme.success,
  missed: theme.muted,
  timeout: theme.warning,
  error: theme.danger,
  in_progress: theme.accent,
  unknown: theme.subText,
};

/** Colours for an uptime row — `views/insights/uptime/timelineConfig.tsx:48-66`. */
export const UPTIME_STATUS_COLORS: Readonly<Record<UptimeCheckStatus, string>> = {
  success: theme.success,
  failure: theme.danger,
  failure_incident: theme.danger,
  missed_window: theme.subText,
};

/**
 * The unlit track a window with no check-ins draws.
 *
 * `border` rather than a dimmed text colour on purpose: this is the same ink
 * every rule in the app is drawn with, so a run of it reads as the row's
 * groove rather than as content too faint to make out.
 */
export const TIMELINE_TRACK_COLOR = theme.border;

export const CRON_TIMELINE_STYLE: TimelineStyle<CronCheckInStatus> = {
  config: CRON_TIMELINE,
  colors: CRON_STATUS_COLORS,
};

export const UPTIME_TIMELINE_STYLE: TimelineStyle<UptimeCheckStatus> = {
  config: UPTIME_TIMELINE,
  colors: UPTIME_STATUS_COLORS,
};
