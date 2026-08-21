/**
 * One dashboard widget, as a full-width card.
 *
 * The card's height is fixed by `widgetStack.ts` from the widget's shape, and
 * every body below draws exactly that many lines whether its data has arrived,
 * failed, or is still in flight — so a dashboard's layout is settled on the
 * first frame and nothing under a widget moves when it lands.
 *
 * Read-only: nothing here edits a widget or its query.
 */

import type { ReactNode } from "react";

import {
  formatWidgetValue,
  unsupportedReason,
  type WidgetData,
  type WidgetRenderKind,
} from "~/api/dashboardWidgets";
import type { DashboardWidget } from "~/api/dashboards";
import type { DiscoverRow } from "~/api/discover";
import { errorOf, isLoading, valueOf, type AsyncStatus } from "~/core/async";
import { theme } from "~/core/theme";
import { bigDigitLines, splitBigValue } from "~/lib/bigDigits";
import { formatCount, sparklineBlock, type SeriesPoint } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { BOLD, DIM } from "~/ui/lib/attributes";
import { layoutColumns } from "~/ui/lib/tableLayout";
import { barRowCount, CARD_GAP_ROWS, SERIES_CHART_ROWS } from "~/ui/lib/widgetStack";

/** Border on both sides plus a cell of padding inside each. */
const CARD_CHROME_WIDTH = 4;

/** Y-axis label gutter in a series card, matching `BarChart`'s proportions. */
const AXIS_LABEL_WIDTH = 6;

/** Narrowest a bar chart's label column is allowed to get. */
const BAR_LABEL_MIN = 8;
/** Widest, so the bars themselves keep most of the card. */
const BAR_LABEL_MAX = 24;
/** Cells reserved for a bar's value, right-aligned after it. */
const BAR_VALUE_WIDTH = 8;

/** Narrowest a table widget's column may be before the card sheds it. */
const TABLE_MIN_COLUMN = 8;

export interface WidgetCardProps {
  widget: DashboardWidget;
  kind: WidgetRenderKind;
  /** The widget's data; `null` once settled means there was none to fetch. */
  status: AsyncStatus<WidgetData | null> | undefined;
  /** Full width of the card, borders included. */
  width: number;
  /** Full height of the card, borders included and the trailing gap excluded. */
  height: number;
  /** The widget cursor is on this card and the pane has focus. */
  selected: boolean;
  /**
   * The dashboard itself hasn't arrived yet and this card is standing in for a
   * widget the list row said would be here — same shape, no title, no data.
   */
  placeholder?: boolean;
}

export function WidgetCard({
  widget,
  kind,
  status,
  width,
  height,
  selected,
  placeholder = false,
}: WidgetCardProps) {
  const inner = Math.max(4, width - CARD_CHROME_WIDTH);
  const bodyLines = Math.max(0, height - 3);

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        height,
        flexShrink: 0,
        marginBottom: CARD_GAP_ROWS,
        border: true,
        borderColor: selected ? theme.accent : theme.border,
        backgroundColor: selected ? theme.panel : undefined,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <CardTitle widget={widget} width={inner} selected={selected} placeholder={placeholder} />
      <CardBody
        widget={widget}
        kind={kind}
        status={placeholder ? undefined : status}
        width={inner}
        lines={bodyLines}
      />
    </box>
  );
}

/** Title on the left, the widget's display type on the right as a dim tag. */
function CardTitle({
  widget,
  width,
  selected,
  placeholder,
}: {
  widget: DashboardWidget;
  width: number;
  selected: boolean;
  placeholder: boolean;
}) {
  const tag = widget.displayType;
  const titleWidth = Math.max(1, width - tag.length - 1);
  return (
    <box style={{ flexDirection: "row", width, flexShrink: 0 }}>
      <text
        fg={placeholder ? theme.panelAlt : selected ? theme.accent : theme.text}
        attributes={placeholder ? 0 : BOLD}
      >
        {padText(
          placeholder ? skeletonBar(titleWidth, 3) : widget.title || "Untitled widget",
          titleWidth,
        )}
      </text>
      <text fg={theme.subText} attributes={DIM}>
        {padText(tag, tag.length + 1, "right")}
      </text>
    </box>
  );
}

function CardBody({
  widget,
  kind,
  status,
  width,
  lines,
}: {
  widget: DashboardWidget;
  kind: WidgetRenderKind;
  status: AsyncStatus<WidgetData | null> | undefined;
  width: number;
  lines: number;
}) {
  if (kind === "unsupported") {
    return <NotRenderable reason={unsupportedReason(widget)} width={width} lines={lines} />;
  }

  const error = errorOf(status);
  if (error) return <CardError message={error.message} width={width} lines={lines} />;

  const data = valueOf(status) ?? null;
  // Settled with nothing to fetch — an issue or release widget, whose datasets
  // this client doesn't read.
  if (data === null && status?.state === "ready") {
    return <NotRenderable reason={unsupportedReason(widget)} width={width} lines={lines} />;
  }

  const pending = data === null || isLoading(status) || status === undefined;

  switch (kind) {
    case "number":
      return (
        <NumberBody
          data={data?.kind === "number" ? data : undefined}
          pending={pending}
          width={width}
        />
      );
    case "series":
      return (
        <SeriesBody
          data={data?.kind === "series" ? data : undefined}
          pending={pending}
          width={width}
        />
      );
    case "table":
      return (
        <TableBody data={data?.kind === "table" ? data : undefined} width={width} lines={lines} />
      );
    case "bars":
      return (
        <BarsBody
          data={data?.kind === "bars" ? data : undefined}
          rows={barRowCount(widget)}
          width={width}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// big_number
// ---------------------------------------------------------------------------

/**
 * One value, as large as block glyphs go, centred over the aggregate it is of.
 *
 * The suffix a formatted value can carry (`k`, `m`) has no large glyph, so it
 * sits at normal size on the value's bottom row — which is where the web puts
 * its unit too.
 */
function NumberBody({
  data,
  pending,
  width,
}: {
  data?: Extract<WidgetData, { kind: "number" }>;
  pending: boolean;
  width: number;
}) {
  const { numeric, suffix } = splitBigValue(data?.formatted ?? "");
  // A placeholder of the same shape, so the card doesn't resize or jump when
  // the real number lands.
  const glyphs = bigDigitLines(pending || numeric.length === 0 ? "000" : numeric);
  const dim = pending || numeric.length === 0;
  const lastRow = glyphs.length - 1;
  // The suffix sits on the bottom row, but every row is padded for it — centred
  // per-row, a longer last line would shift the whole numeral half a cell left.
  const tail = suffix ? ` ${suffix}` : "";
  const blockWidth = (glyphs[0]?.length ?? 0) + tail.length;

  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      {glyphs.map((line, row) => (
        <box key={row} style={{ flexDirection: "row", width, flexShrink: 0 }}>
          <text fg={dim ? theme.panelAlt : theme.text}>
            {padText(padText(row === lastRow ? line + tail : line, blockWidth), width, "center")}
          </text>
        </box>
      ))}
      <text fg={theme.muted}>{padText(data?.label ?? "", width, "center")}</text>
    </box>
  );
}

// ---------------------------------------------------------------------------
// bar / area / line
// ---------------------------------------------------------------------------

/**
 * A block-glyph chart with a value gutter and a time axis.
 *
 * All three time-series display types land here: a terminal can draw the shape
 * of a series honestly and cannot draw the difference between a bar, an area
 * and a line, so pretending otherwise would be decoration.
 */
function SeriesBody({
  data,
  pending,
  width,
}: {
  data?: Extract<WidgetData, { kind: "series" }>;
  pending: boolean;
  width: number;
}) {
  const chartWidth = Math.max(4, width - AXIS_LABEL_WIDTH - 1);
  const raw: SeriesPoint[] | undefined = data?.buckets.map(([at, series]) => [
    at,
    series[0]?.count ?? 0,
  ]);
  // `sparklineBlock` downsamples but never stretches, so a twelve-bucket series
  // would sit in the right twelve cells of a seventy-cell card. Widening the
  // buckets first is what makes a short series fill its chart.
  const points = raw ? stretch(raw, chartWidth) : undefined;
  // `sparklineBlock` draws its own pending glyphs for an absent series, which
  // is exactly the skeleton this card wants.
  const rows = sparklineBlock(pending ? undefined : points, chartWidth, SERIES_CHART_ROWS, {
    floor: true,
  });
  const max = raw && raw.length > 0 ? Math.max(...raw.map(([, count]) => count)) : 0;

  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      {rows.map((line, row) => (
        <box key={row} style={{ flexDirection: "row", width, flexShrink: 0 }}>
          <text fg={theme.muted} attributes={DIM}>
            {`${padText(axisLabel(row, rows.length, max, Boolean(raw)), AXIS_LABEL_WIDTH, "right")} `}
          </text>
          <text fg={pending ? theme.panelAlt : theme.accent}>{line}</text>
        </box>
      ))}
      <box style={{ flexDirection: "row", width, flexShrink: 0 }}>
        <text fg={theme.muted} attributes={DIM}>
          {" ".repeat(AXIS_LABEL_WIDTH + 1)}
        </text>
        <text fg={theme.subText} attributes={DIM}>
          {timeAxis(raw, data?.label ?? "", chartWidth)}
        </text>
      </box>
    </box>
  );
}

/**
 * Repeat each bucket until the series fills the chart.
 *
 * Nearest-neighbour rather than interpolated: the buckets are what the endpoint
 * measured, and drawing a value between two of them would be inventing one.
 */
function stretch(points: readonly SeriesPoint[], width: number): SeriesPoint[] {
  if (points.length === 0 || points.length >= width) return [...points];
  return Array.from(
    { length: width },
    (_, cell) => points[Math.min(points.length - 1, Math.floor((cell * points.length) / width))]!,
  );
}

/** Top row carries the maximum, bottom row the zero; the rest stay blank. */
function axisLabel(row: number, rows: number, max: number, settled: boolean): string {
  if (!settled) return "";
  if (row === 0) return formatWidgetValue(max);
  if (row === rows - 1) return "0";
  return "";
}

/** First bucket, the aggregate being plotted, and the last bucket. */
function timeAxis(
  points: readonly SeriesPoint[] | undefined,
  label: string,
  width: number,
): string {
  if (!points || points.length === 0 || width < 12) return " ".repeat(Math.max(0, width));
  const first = clock(points[0]![0]);
  const last = clock(points[points.length - 1]![0]);
  const middle = Math.max(1, width - first.length - last.length);
  // Two cells of air on each side so a long aggregate never abuts a time.
  return `${first}${padText(fitText(label, Math.max(0, middle - 4)), middle, "center")}${last}`.slice(
    0,
    width,
  );
}

function clock(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// table / top_n
// ---------------------------------------------------------------------------

/**
 * The widget's own rows, laid out with the same column engine the list screens
 * use — but drawn inline rather than through `DataTable`, whose scrollbox
 * cannot be nested inside the grid's own without the two fighting over the
 * wheel. A widget table is at most ten rows and never scrolls on its own.
 */
function TableBody({
  data,
  width,
  lines,
}: {
  data?: Extract<WidgetData, { kind: "table" }>;
  width: number;
  lines: number;
}) {
  const headers = data?.headers ?? [];
  const fields = data?.fields ?? [];
  // One flex column per field. The rightmost sheds first, as it does
  // everywhere else in the app: a widget's leading columns are its group-bys,
  // and a table grouped by nothing recognisable is not worth the aggregate.
  const specs = (headers.length > 0 ? headers : [""]).map((header, index) => ({
    key: String(index),
    width: "flex" as const,
    priority: headers.length - index,
    header,
    field: fields[index] ?? "",
  }));
  const resolved = layoutColumns(specs, width, { gap: 1, minFlex: TABLE_MIN_COLUMN });
  const rowLines = Math.max(0, lines - 1);

  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      <text fg={theme.muted}>
        {resolved.map(({ column, width: cell }) => padText(column.header, cell)).join(" ")}
      </text>
      {Array.from({ length: rowLines }, (_, row) => {
        const values = data?.rows[row];
        return (
          <text key={row} fg={values ? theme.text : theme.panelAlt}>
            {resolved
              .map(({ column, width: cell }) =>
                padText(
                  values
                    ? cellText(values, column.field)
                    : // A row the answer simply didn't have stays blank; only a
                      // row still in flight gets a bar.
                      data
                      ? ""
                      : skeletonBar(cell, row),
                  cell,
                ),
              )
              .join(" ")}
          </text>
        );
      })}
    </box>
  );
}

/** A cell's value as text. Absent is `—`, not the string `undefined`. */
function cellText(row: DiscoverRow, field: string): string {
  const value = row[field];
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

/** A deterministic dash bar, so pending rows read as content rather than noise. */
function skeletonBar(width: number, seed: number): string {
  if (width <= 0) return "";
  const fraction = 0.4 + ((seed * 17) % 45) / 100;
  return "─".repeat(Math.max(1, Math.min(width, Math.floor(width * fraction))));
}

// ---------------------------------------------------------------------------
// categorical_bar
// ---------------------------------------------------------------------------

/** Horizontal bars: label, bar, value — one row per group. */
function BarsBody({
  data,
  rows,
  width,
}: {
  data?: Extract<WidgetData, { kind: "bars" }>;
  rows: number;
  width: number;
}) {
  const labelWidth = Math.max(BAR_LABEL_MIN, Math.min(BAR_LABEL_MAX, Math.floor(width * 0.35)));
  const barWidth = Math.max(1, width - labelWidth - BAR_VALUE_WIDTH - 2);
  const entries = data?.entries ?? [];
  const max = Math.max(1, ...entries.map((entry) => entry.value));

  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      {Array.from({ length: rows }, (_, row) => {
        const entry = entries[row];
        const filled = entry ? Math.max(1, Math.round((entry.value / max) * barWidth)) : 0;
        // A slot the answer didn't fill draws nothing at all; the row is still
        // there, holding the height the card reserved before the data landed.
        const track = entry || !data ? Math.max(0, barWidth - filled) : 0;
        return (
          <box key={row} style={{ flexDirection: "row", width, flexShrink: 0 }}>
            <text fg={entry ? theme.subText : theme.panelAlt}>
              {`${padText(entry?.label ?? (data ? "" : skeletonBar(labelWidth, row)), labelWidth)} `}
            </text>
            {filled > 0 ? <text fg={theme.accent}>{"█".repeat(filled)}</text> : null}
            {/* Rendered only when it has cells to draw: an empty `<text>` still
                takes one, which would push the value column out of line on the
                row whose bar is full. */}
            {track > 0 ? <text fg={theme.panelAlt}>{"░".repeat(track)}</text> : null}
            <text fg={entry ? theme.text : theme.panelAlt}>
              {padText(entry ? formatCount(entry.value) : "", BAR_VALUE_WIDTH, "right")}
            </text>
          </box>
        );
      })}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

/**
 * The honest fallback: say what the widget is and why it isn't drawn, rather
 * than leaving a card that looks broken.
 */
function NotRenderable({ reason, width, lines }: { reason: string; width: number; lines: number }) {
  return (
    <FixedLines width={width} lines={lines}>
      <text fg={theme.muted}>{fitText(reason, width)}</text>
      <text fg={theme.subText} attributes={DIM}>
        {fitText("Open it on sentry.io to see this one.", width)}
      </text>
    </FixedLines>
  );
}

function CardError({ message, width, lines }: { message: string; width: number; lines: number }) {
  return (
    <FixedLines width={width} lines={lines}>
      <text fg={theme.danger}>{fitText("Failed to load this widget", width)}</text>
      <text fg={theme.muted}>{fitText(message, width)}</text>
    </FixedLines>
  );
}

/**
 * Draw `children` and pad the card out to the height its shape reserved, so a
 * two-line message inside a nine-line card doesn't pull the stack up under it.
 */
function FixedLines({
  width,
  lines,
  children,
}: {
  width: number;
  lines: number;
  children: ReactNode;
}) {
  return (
    <box style={{ flexDirection: "column", width, height: lines, flexShrink: 0 }}>{children}</box>
  );
}
