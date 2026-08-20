/**
 * `[unixSeconds, count]`. Declared structurally rather than imported from
 * `~/api/types` so this stays a dependency-free leaf module.
 */
export type SeriesPoint = readonly [number, number];

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
/** Shown while stats are still in flight, so the column doesn't reflow. */
export const SPARKLINE_PENDING = "╌";

export interface SparklineOptions {
  /**
   * Draw empty buckets as the floor glyph rather than a blank cell.
   *
   * A stream row is scanned as a column of many sparklines, where blanks keep
   * the busy periods legible. Shown on its own — as the issue header does — the
   * same series reads as stray marks floating in whitespace, so a continuous
   * baseline is what makes it look like a chart.
   */
  floor?: boolean;
}

/**
 * Render a series as block glyphs, scaled to its own maximum.
 *
 * Downsamples by averaging buckets so the shape survives a narrow column, and
 * pads on the left so a short series stays right-aligned with its neighbours.
 */
export function sparkline(
  series: readonly SeriesPoint[] | undefined,
  width: number,
  { floor = false }: SparklineOptions = {},
): string {
  if (width <= 0) return "";
  if (!series || series.length === 0) return SPARKLINE_PENDING.repeat(width);

  const counts = series.map(([, count]) => count);
  const buckets = downsample(counts, width);
  const max = Math.max(...buckets);
  const empty = floor ? BLOCKS[0]! : " ";

  // An all-zero window is real data, not missing data — draw a flat floor.
  if (max === 0) return BLOCKS[0]!.repeat(buckets.length).padStart(width);

  const glyphs = buckets
    .map((value) => {
      if (value === 0) return empty;
      const scaled = Math.ceil((value / max) * BLOCKS.length) - 1;
      return BLOCKS[Math.max(0, Math.min(BLOCKS.length - 1, scaled))]!;
    })
    .join("");

  return glyphs.padStart(width);
}

function downsample(values: number[], width: number): number[] {
  if (values.length <= width) return values;

  const bucketSize = values.length / width;
  const out: number[] = [];
  for (let i = 0; i < width; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(values.length, Math.floor((i + 1) * bucketSize));
    let sum = 0;
    for (let j = start; j < end; j++) sum += values[j]!;
    out.push(end > start ? sum / (end - start) : 0);
  }
  return out;
}

/** Compact counts the way Sentry's `<Count>` does: 1.4k, 12k, 1.2m. */
export function formatCount(value: number | string | undefined): string {
  // An absent count is pending phase two, not zero — say so rather than
  // asserting a number we don't have yet.
  if (value === undefined) return "··";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/**
 * A formatted count and its noun, agreeing in number: `1 event`, `92 users`.
 *
 * An absent count renders as `··`, which is neither singular nor plural — the
 * plural is the neutral form there, as it is for zero.
 */
export function countLabel(value: number | string | undefined, noun: string): string {
  const n = typeof value === "string" ? Number(value) : value;
  return `${formatCount(value)} ${n === 1 ? noun : `${noun}s`}`;
}

/** Short relative time, as the issue stream shows it: 5s, 12m, 3h, 2d, 4w. */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}
