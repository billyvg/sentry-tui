/**
 * Bucket width for a chart's time window — the `interval` param on
 * `events-stats/`.
 *
 * Without it the endpoint picks its own, and its default is the *coarse* one:
 * `get_interval_from_range(date_range, high_fidelity=False)` in
 * `sentry/utils/dates.py:152` answers `15m` for a window of an hour or less.
 * Four buckets is a chart with four bars in it, which is what an hour of
 * Explore looks like today.
 *
 * The web asks for something much finer. Explore's chart reads its interval
 * from `useChartInterval`, whose default strategy is `USE_SMALLEST`
 * (`app/utils/useChartInterval.tsx:41`) — the finest bucket the range allows.
 * That bound is `MINIMUM_INTERVAL` (`useChartInterval.tsx:176`), chosen so a
 * series never exceeds ~1000 points, and it is what `CHART_LADDER` below is.
 */

/** `[minimumWindowInMinutes, interval]`, as the web's `GranularityStep` is. */
type GranularityStep = readonly [minutes: number, interval: string];

// The web's minute constants, `app/components/charts/utils.tsx:27-39`.
const THIRTY_DAYS = 43_200;
const TWO_WEEKS = 20_160;
const FOUR_DAYS = 5_760;
const FORTY_EIGHT_HOURS = 2_880;
const TWELVE_HOURS = 720;
const SIX_HOURS = 360;

/**
 * `MINIMUM_INTERVAL` from `app/utils/useChartInterval.tsx:176`, the finest
 * bucket each window allows. Ordered coarsest-first, so the first step whose
 * threshold the window reaches is the answer — the web sorts its ladder into
 * this order at construction (`GranularityLadder`, `charts/utils.tsx:103`).
 *
 * Every entry yields between 60 and 720 buckets for the periods the filter bar
 * offers, so a chart is never short of bars regardless of the window chosen.
 */
const CHART_LADDER: readonly GranularityStep[] = [
  [THIRTY_DAYS, "3h"],
  [TWO_WEEKS, "1h"],
  [FOUR_DAYS, "30m"],
  [FORTY_EIGHT_HOURS, "10m"],
  [TWELVE_HOURS, "5m"],
  [SIX_HOURS, "1m"],
  [0, "1m"],
];

/** A dashboard card is too small for more buckets than this to add information. */
export const DASHBOARD_MAX_BIN_COUNT = 66;

/**
 * Bucket widths accepted by events-stats, finest first.
 *
 * Dashboard intervals use this to preserve an author's saved width until it
 * would put more than 66 bins in a card, then choose the smallest coarser width
 * that fits. The tail covers the longest period offered by the filter bar.
 */
const DASHBOARD_INTERVALS = [
  "1m",
  "2m",
  "5m",
  "10m",
  "15m",
  "20m",
  "30m",
  "1h",
  "2h",
  "3h",
  "4h",
  "6h",
  "12h",
  "1d",
  "2d",
  "1w",
] as const;

const UNIT_MINUTES: Record<string, number> = {
  s: 1 / 60,
  m: 1,
  h: 60,
  d: 60 * 24,
  w: 60 * 24 * 7,
};

/**
 * A stats period such as `24h` as a count of minutes.
 *
 * Mirrors `parse_stats_period` (`sentry/utils/dates.py:131`), including its
 * bare-number-means-seconds case.
 *
 * @returns The window in minutes, or `undefined` when the string isn't one —
 *   an absolute `start`/`end` range, say, which has no period to read.
 */
export function statsPeriodMinutes(period: string | undefined): number | undefined {
  if (!period) return undefined;
  const match = /^(\d+)([smhdw]?)$/.exec(period.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return value * UNIT_MINUTES[match[2] || "s"]!;
}

/**
 * The `interval` to plot `statsPeriod` at.
 *
 * @returns The bucket width, or `undefined` for a period this can't read, so a
 *   caller can leave the param off and let the endpoint choose as it does now.
 */
export function chartInterval(statsPeriod: string | undefined): string | undefined {
  const minutes = statsPeriodMinutes(statsPeriod);
  if (minutes === undefined || minutes < 0) return undefined;
  return CHART_LADDER.find(([threshold]) => minutes >= threshold)![1];
}

/**
 * Resolve a dashboard widget's saved bucket width for its small card.
 *
 * Bar widgets are daily totals, matching Sentry Web. Other series retain the
 * saved interval whenever it fits and fall back to Explore's interval when the
 * widget predates saved intervals. A finer interval is coarsened just enough
 * to keep the card at or below {@link DASHBOARD_MAX_BIN_COUNT} buckets.
 */
export function dashboardChartInterval(
  statsPeriod: string | undefined,
  savedInterval: string | undefined,
  bar: boolean,
): string | undefined {
  if (bar) return "1d";

  const savedMinutes = statsPeriodMinutes(savedInterval);
  const fallback = chartInterval(statsPeriod);
  const desired = savedMinutes === undefined || savedMinutes <= 0 ? fallback : savedInterval;
  const desiredMinutes = statsPeriodMinutes(desired);
  const rangeMinutes = statsPeriodMinutes(statsPeriod);
  if (desiredMinutes === undefined || rangeMinutes === undefined) return desired;

  const minimumMinutes = rangeMinutes / DASHBOARD_MAX_BIN_COUNT;
  if (desiredMinutes >= minimumMinutes) return desired;

  return (
    DASHBOARD_INTERVALS.find((interval) => statsPeriodMinutes(interval)! >= minimumMinutes) ??
    DASHBOARD_INTERVALS.at(-1)
  );
}
