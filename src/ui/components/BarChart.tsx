/**
 * A terminal bar chart, inspired by the Sentry web Explore > Logs chart.
 *
 * Renders vertical bars using Unicode block characters, with a Y-axis on the
 * left and time labels along the bottom. The chart downsamples the input
 * buckets to fit the available width and scales bar heights to the max value.
 */

import type { TimeseriesBucket } from "~/api/discover";
import { useTheme } from "~/ui/theme";
import { formatCount, stretch } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { DIM } from "~/ui/lib/attributes";

// The block characters from 1/8 to full block — used for sub-cell precision
// on the top of each bar.
const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Rows a chart occupies in a screen's column, border included. */
export const CHART_ROWS = 10;

/**
 * Rows the chrome around a chart needs before any of the list shows: the
 * search box, the filter row, and the table's header and rule.
 */
const CHROME_ROWS = 8;

/** Table rows worth keeping — below this the list stops being a list. */
const MIN_LIST_ROWS = 5;

/**
 * Whether a pane of `height` rows can afford a chart above its table.
 *
 * A short terminal has to choose, and the rows are what the screen is for: a
 * chart with no list under it is a chart nobody asked for.
 *
 * @param extraChrome Rows this screen spends above its table that the count
 *   above doesn't cover — Explore's query builder row, say.
 */
export function fitsChart(height: number, extraChrome = 0): boolean {
  return height >= CHART_ROWS + CHROME_ROWS + extraChrome + MIN_LIST_ROWS;
}

/** Y-axis label gutter width (e.g. "100K "). */
const Y_LABEL_WIDTH = 7;
/** Bottom row reserved for time labels. */
const BOTTOM_ROWS = 1;
/** Chart title row. */
const TITLE_ROWS = 1;

export interface BarChartProps {
  /** Raw timeseries buckets from the events-stats API. */
  buckets: readonly TimeseriesBucket[];
  /** Available width in terminal columns. */
  width: number;
  /** Available height in terminal rows (including title + axis labels). */
  height: number;
  /** The aggregate being plotted, drawn top left, e.g. `count(logs)`. */
  title: string;
  /**
   * What a bucket counts, for the total drawn top right: `1.2m logs`.
   *
   * Omit it for an aggregate that doesn't add up across buckets — the sum of
   * twelve `p95`s is not a p95 of anything, and a number nobody can use is
   * worse than the space it takes.
   */
  noun?: string;
}

/**
 * Downsample `values` into `targetLen` buckets by summing neighbouring cells.
 */
function downsample(values: number[], targetLen: number): number[] {
  if (values.length <= targetLen) return values;
  const bucketSize = values.length / targetLen;
  const out: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(values.length, Math.floor((i + 1) * bucketSize));
    let sum = 0;
    for (let j = start; j < end; j++) sum += values[j]!;
    out.push(sum);
  }
  return out;
}

/**
 * Build a set of Y-axis tick labels (top, mid, zero).
 */
function yAxisLabels(max: number): { top: string; mid: string; zero: string } {
  return {
    top: padText(formatCount(max), Y_LABEL_WIDTH - 1, "right") + " ",
    mid: padText(formatCount(Math.round(max / 2)), Y_LABEL_WIDTH - 1, "right") + " ",
    zero: padText("0", Y_LABEL_WIDTH - 1, "right") + " ",
  };
}

/**
 * Format a unix timestamp as a short time label (HH:MM or "Mon DD").
 */
function timeLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Build time labels for the X-axis, evenly distributed.
 */
function buildTimeLabels(
  buckets: readonly TimeseriesBucket[],
  barCount: number,
  chartWidth: number,
): string {
  if (buckets.length === 0 || chartWidth < 10) return "";

  // We want ~4-6 labels spread across the chart width.
  const labelWidth = 6; // "HH:MM" + padding
  const maxLabels = Math.max(2, Math.floor(chartWidth / (labelWidth + 2)));
  const step = Math.max(1, Math.floor(buckets.length / maxLabels));

  // Build a character buffer for the label row.
  const buf = Array.from({ length: chartWidth }, () => " ");

  for (let i = 0; i < buckets.length; i += step) {
    const bucket = buckets[i]!;
    const label = timeLabel(bucket[0]);
    // Map bucket index to a character position in the chart area.
    const pos = Math.round((i / Math.max(1, buckets.length - 1)) * (chartWidth - label.length));
    const clampedPos = Math.max(0, Math.min(chartWidth - label.length, pos));
    for (let c = 0; c < label.length; c++) {
      buf[clampedPos + c] = label[c]!;
    }
  }

  return buf.join("");
}

export function BarChart({ buckets, width, height, title, noun }: BarChartProps) {
  const theme = useTheme();
  if (width < 20 || height < 4) return null;

  // Border takes 2 cols (left + right), padding takes 1 col.
  const chartWidth = width - Y_LABEL_WIDTH - 3;
  const chartHeight = Math.max(1, height - BOTTOM_ROWS - TITLE_ROWS - 2); // -2 for top/bottom border

  // Extract counts from the raw bucket format.
  const rawCounts = buckets.map(([, agg]) => agg[0]?.count ?? 0);
  // Fit the series to the chart in whichever direction it needs: a long window
  // has more buckets than cells, a short one fewer. Without the stretch a
  // six-bucket series draws six bars against the left edge of a seventy-cell
  // box, which reads as an empty chart rather than a small one.
  const values = stretch(downsample(rawCounts, chartWidth), chartWidth);
  const max = Math.max(1, ...values);
  const total = rawCounts.reduce((a, b) => a + b, 0);

  const labels = yAxisLabels(max);

  // Build the chart rows bottom-up: each row represents a horizontal slice
  // of the bar area. A bar of normalised height h occupies rows 0..h-1 from
  // the bottom. The topmost cell uses sub-block characters for precision.
  const rows: string[] = [];
  for (let row = chartHeight - 1; row >= 0; row--) {
    let line = "";
    for (let col = 0; col < values.length; col++) {
      const v = values[col]!;
      // Normalised height in sub-cells (chartHeight * 8 sub-cells total).
      const subCells = max === 0 ? 0 : Math.round((v / max) * chartHeight * 8);
      // How many full rows this bar fills.
      const fullRows = Math.floor(subCells / 8);
      const remainder = subCells % 8;

      if (row < fullRows) {
        line += "█";
      } else if (row === fullRows && remainder > 0) {
        line += BLOCKS[remainder]!;
      } else {
        line += " ";
      }
    }
    rows.push(line);
  }

  const timeLabelsRow = buildTimeLabels(buckets, values.length, chartWidth);

  // Account for the border (1 cell each side) and padding (1 cell left).
  const innerWidth = width - 2 - 1;
  const totalLabel = noun === undefined ? "" : `${formatCount(total)} ${noun}`;

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        height,
        flexShrink: 0,
        border: ["top", "bottom", "left", "right"],
        borderColor: theme.border,
        backgroundColor: theme.panel,
        paddingLeft: 1,
      }}
    >
      {/* Title row. The aggregate is trimmed rather than allowed to wrap: a
          two-line header would push the bars out of the box it is drawn in. */}
      <box style={{ flexDirection: "row", width: innerWidth, flexShrink: 0 }}>
        <text fg={theme.text}>
          {fitText(title, Math.max(0, innerWidth - totalLabel.length - 1))}
        </text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted} attributes={DIM}>
          {totalLabel}
        </text>
      </box>

      {/* Chart body */}
      {rows.map((line, i) => {
        // Y-axis label on the left: top row, mid row, bottom row.
        let yLabel: string;
        if (i === 0) {
          yLabel = labels.top;
        } else if (i === Math.floor(rows.length / 2)) {
          yLabel = labels.mid;
        } else if (i === rows.length - 1) {
          yLabel = labels.zero;
        } else {
          yLabel = " ".repeat(Y_LABEL_WIDTH);
        }
        return (
          <box key={i} style={{ flexDirection: "row", flexShrink: 0 }}>
            <text fg={theme.muted} attributes={DIM}>
              {yLabel}
            </text>
            <text fg={theme.accent}>{line}</text>
          </box>
        );
      })}

      {/* Time labels */}
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text fg={theme.muted}>{" ".repeat(Y_LABEL_WIDTH)}</text>
        <text fg={theme.muted} attributes={DIM}>
          {timeLabelsRow}
        </text>
      </box>
    </box>
  );
}
