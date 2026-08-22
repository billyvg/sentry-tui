/**
 * Wall-clock formatting for table columns.
 *
 * Relative time (`timeAgo`) lives next to the sparkline helpers that grew up
 * with it; this is the absolute form the Explore tables need, where two rows a
 * second apart have to be distinguishable.
 */

/** Placeholder holding the column's width when there is no timestamp. */
export const NO_CLOCK = "--:--:--";

/**
 * `HH:MM:SS` from an ISO-8601 timestamp.
 *
 * Read out of the string rather than parsed into a `Date`: the API answers in
 * UTC, and a local-time conversion would make two people reading the same row
 * see different numbers.
 */
export function clockTime(iso: string | undefined): string {
  if (!iso) return NO_CLOCK;
  const match = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return match?.[1] ?? (iso.slice(11, 19) || NO_CLOCK);
}

/**
 * A duration in seconds as one compact unit: `45s`, `5m`, `2h`, `3d`.
 *
 * The counterpart to `timeAgo` for a *configured* interval rather than an
 * elapsed one — an uptime monitor's `Every 60s`. Rounded down to the largest
 * whole unit that fits, like the web's `getDuration`, but abbreviated: a
 * detector's detail line is competing for the same row as its project and its
 * URL.
 */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Placeholder holding a date column's width when there is no timestamp. */
export const NO_DATE = "------ --:--";

/**
 * `YYYY-MM-DD HH:MM` from an ISO-8601 timestamp, in UTC.
 *
 * Read out of the string rather than parsed into a `Date`, for the reason
 * `clockTime` gives: the API answers in UTC, and converting to local time
 * would make two people reading the same open period see different numbers.
 */
export function dateTimeText(iso: string | undefined | null): string {
  if (!iso) return NO_DATE;
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : NO_DATE;
}

/**
 * How long two timestamps are apart, as one compact unit.
 *
 * The open-periods endpoint sends `start` and `end` and no duration, so the
 * detail view computes it. An absent `end` means the period is still open and
 * the span is measured to `now`.
 */
export function elapsedText(start: string, end?: string | null, now = Date.now()): string {
  const from = Date.parse(start);
  if (Number.isNaN(from)) return "";
  const to = end ? Date.parse(end) : now;
  if (Number.isNaN(to)) return "";
  return durationText(Math.max(0, (to - from) / 1000));
}
