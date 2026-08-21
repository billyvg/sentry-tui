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
