/**
 * A terminal bar chart, inspired by the Sentry web Explore > Logs chart.
 *
 * Renders vertical bars using Unicode block characters, with a Y-axis on the
 * left and time labels along the bottom. The chart downsamples the input
 * buckets to fit the available width and scales bar heights to the max value.
 */

import type { LogTimeseriesBucket } from "~/api/logs";
import { theme } from "~/core/theme";
import { formatCount } from "~/lib/sparkline";
import { padText } from "~/lib/text";
import { DIM } from "~/ui/lib/attributes";

// The block characters from 1/8 to full block — used for sub-cell precision
// on the top of each bar.
const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Y-axis label gutter width (e.g. "100K "). */
const Y_LABEL_WIDTH = 7;
/** Bottom row reserved for time labels. */
const BOTTOM_ROWS = 1;
/** Chart title row. */
const TITLE_ROWS = 1;

export interface BarChartProps {
  /** Raw timeseries buckets from the events-stats API. */
  buckets: LogTimeseriesBucket[];
  /** Available width in terminal columns. */
  width: number;
  /** Available height in terminal rows (including title + axis labels). */
  height: number;
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
  buckets: LogTimeseriesBucket[],
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

export function BarChart({ buckets, width, height }: BarChartProps) {
  if (width < 20 || height < 4) return null;

  const chartWidth = width - Y_LABEL_WIDTH;
  const chartHeight = Math.max(1, height - BOTTOM_ROWS - TITLE_ROWS);

  // Extract counts from the raw bucket format.
  const rawCounts = buckets.map(([, agg]) => agg[0]?.count ?? 0);
  const values = downsample(rawCounts, chartWidth);
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

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        height,
        flexShrink: 0,
        border: ["bottom"],
        borderColor: theme.border,
      }}
    >
      {/* Title row */}
      <box style={{ flexDirection: "row", width, flexShrink: 0 }}>
        <text fg={theme.text}>{`count(logs)`}</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted} attributes={DIM}>
          {`${formatCount(total)} logs`}
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
