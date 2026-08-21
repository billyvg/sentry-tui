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
