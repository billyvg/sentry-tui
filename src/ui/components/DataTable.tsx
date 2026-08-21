/**
 * A column-spec-driven table: header, rows, skeleton, empty, and error states.
 *
 * Every list screen in the app is the same object — a header rule, fixed-width
 * cells, a cursor that scrolls its viewport, and four states to be in. Screens
 * describe their columns; this decides which of them fit, pads each cell to
 * exactly its width, and holds the geometry steady while the data is in
 * flight so nothing shifts when it lands.
 *
 * The cursor is *rendered* here and *moved* by `App`'s key router: cursor keys
 * never reach a focused scrollbox (it would page instead), so the app owns
 * them centrally and the table follows `selectedIndex`.
 */

import type { ReactNode } from "react";
import { useRef, type RefObject } from "react";

import type { ScrollBoxRenderable } from "@opentui/core";

import type { AsyncError } from "~/core/async";
import { theme } from "~/core/theme";
import { padText } from "~/lib/text";
import { useRowScrollFollow } from "~/ui/hooks/useRowScrollFollow";
import { layoutColumns, type ColumnSpec } from "~/ui/lib/tableLayout";

/**
 * Column the scrollbox's vertical scrollbar takes out of its own viewport,
 * plus the cell of padding that keeps rows off it. Rows are laid out that much
 * narrower so the bar lands in a gutter of its own rather than on top of the
 * last column.
 */
const DEFAULT_GUTTER = 2;

/** Rows of skeleton drawn while the first page is in flight. */
const DEFAULT_SKELETON_ROWS = 20;

export interface Column<T> extends ColumnSpec {
  /** Stable identity for the cell, and the React key. */
  key: string;
  /** Header label. Padded and truncated to the resolved width like any cell. */
  label: string;
  /** Fixed width in cells, or `"flex"` to share what the fixed columns leave. */
  width: number | "flex";
  align?: "left" | "right";
  /**
   * Draw the cell. It must occupy exactly `width` cells — use
   * `padText(value, width, align)` — or the columns below it will not line up.
   */
  render: (row: T, selected: boolean, width: number) => ReactNode;
  /**
   * Shed order when the terminal is too narrow: the lowest priority goes
   * first. Columns without one are never shed.
   */
  priority?: number;
}

export interface DataTableProps<T> {
  /** The rows to draw, or `undefined` when none have arrived yet. */
  rows: readonly T[] | undefined;
  columns: readonly Column<T>[];
  /** Width of the table, scrollbar gutter included. */
  width: number;
  /** Index of the cursor row. */
  selectedIndex: number;
  /** The content pane holds focus — the cursor is only painted when it does. */
  focused: boolean;
  rowKey: (row: T, index: number) => string;
  /** Nothing has arrived yet and a request is in flight: draw the skeleton. */
  loading?: boolean;
  error?: AsyncError;
  /** A row was clicked. What that means is the screen's call. */
  onRowClick?: (index: number, row: T) => void;
  /**
   * Second line of the row — the composite detail line that replay and monitor
   * rows need. Its presence makes every row, skeleton included, two lines tall.
   */
  renderDetail?: (row: T, selected: boolean, width: number) => ReactNode;
  /** Draw a rule under each row, as the issue stream does. */
  separator?: boolean;
  skeletonRows?: number;
  /** Copy for the empty state. Say what is missing in the caller's own words. */
  empty?: { title: string; lines?: ReadonlyArray<string | undefined> };
  /** Headline for the error state, e.g. `"Failed to load logs"`. */
  errorTitle?: string;
  /** Cells between two columns. */
  gap?: number;
  /**
   * Width the flex column will not shrink below before a column is shed.
   *
   * Raise it when the flex column is the one the table is *for* — a function
   * name or a message — so a pane too narrow for everything gives up a fixed
   * column rather than squeezing the headline down to an ellipsis.
   */
  minFlex?: number;
  /** Cells reserved on the right for the scrollbar. */
  gutter?: number;
  /**
   * Values that change the viewport's height (a chart appearing, a detail
   * panel opening) and so need the scroll offset recomputed.
   */
  layout?: readonly unknown[];
}

/** Terminal lines one row occupies, separators and detail lines included. */
export function rowHeightOf(options: { renderDetail?: unknown; separator?: boolean }): number {
  return 1 + (options.renderDetail ? 1 : 0) + (options.separator ? 1 : 0);
}

export function DataTable<T>({
  rows,
  columns,
  width,
  selectedIndex,
  focused,
  rowKey,
  loading = false,
  error,
  onRowClick,
  renderDetail,
  separator = false,
  skeletonRows = DEFAULT_SKELETON_ROWS,
  empty,
  errorTitle = "Failed to load",
  gap = 1,
  minFlex,
  gutter = DEFAULT_GUTTER,
  layout = [],
}: DataTableProps<T>) {
  const listRef = useRef<ScrollBoxRenderable>(null);
  const rowWidth = Math.max(1, width - gutter);
  const resolved = layoutColumns(columns, rowWidth, { gap, minFlex });
  const rowHeight = rowHeightOf({ renderDetail, separator });

  useRowScrollFollow(listRef, {
    index: selectedIndex,
    rowCount: rows?.length ?? 0,
    rowHeight,
    layout,
  });

  const showSkeleton = rows === undefined && loading;
  const showEmpty = rows !== undefined && rows.length === 0 && !loading;

  return (
    <>
      <TableHeader resolved={resolved} width={rowWidth} gap={gap} />

      {/*
       * `flexBasis: 0` is what makes this box scroll at all: on `auto` the
       * scrollbox takes its content's height as its base size, grows past the
       * pane, and ends up with a viewport as tall as the list — nothing
       * overflows, so there is nothing to scroll.
       */}
      <scrollbox
        ref={listRef as RefObject<ScrollBoxRenderable>}
        focused={focused}
        // A continuously drawn track keeps the gutter reading as a scroll rail
        // rather than as a gap the rows fail to reach.
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
        }}
        style={{ flexGrow: 1, flexBasis: 0, width }}
      >
        {showSkeleton
          ? Array.from({ length: skeletonRows }, (_, i) => (
              <SkeletonRow
                key={i}
                resolved={resolved}
                width={rowWidth}
                gap={gap}
                seed={i}
                detail={Boolean(renderDetail)}
                separator={separator}
              />
            ))
          : null}

        {showEmpty && empty ? <TableEmpty {...empty} /> : null}

        {rows?.map((row, index) => (
          <Row
            key={rowKey(row, index)}
            row={row}
            index={index}
            resolved={resolved}
            width={rowWidth}
            gap={gap}
            selected={focused && index === selectedIndex}
            renderDetail={renderDetail}
            separator={separator}
            onRowClick={onRowClick}
          />
        ))}

        {error && rows === undefined ? <TableError title={errorTitle} error={error} /> : null}
      </scrollbox>
    </>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface Resolved<T> {
  column: Column<T>;
  width: number;
}

function TableHeader<T>({
  resolved,
  width,
  gap,
}: {
  resolved: ReadonlyArray<Resolved<T>>;
  width: number;
  gap: number;
}) {
  return (
    <box
      style={{
        flexDirection: "row",
        width,
        border: ["bottom"],
        borderColor: theme.border,
        flexShrink: 0,
      }}
    >
      {resolved.map(({ column, width: cellWidth }, i) => (
        <Cell key={column.key} width={cellWidth} gap={i > 0 ? gap : 0}>
          <text fg={theme.muted}>{padText(column.label, cellWidth, column.align ?? "left")}</text>
        </Cell>
      ))}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A cell of fixed width.
 *
 * The box is what makes the guarantee: a `render` that returns something wider
 * than its column is clipped here rather than pushing the columns to its right
 * off the pane, or wrapping the row onto a second line.
 */
function Cell({ width, gap, children }: { width: number; gap: number; children: ReactNode }) {
  return (
    <>
      {gap > 0 ? <text>{" ".repeat(gap)}</text> : null}
      <box
        style={{
          width,
          flexShrink: 0,
          flexDirection: "row",
          overflow: "hidden",
        }}
      >
        {children}
      </box>
    </>
  );
}

function Row<T>({
  row,
  index,
  resolved,
  width,
  gap,
  selected,
  renderDetail,
  separator,
  onRowClick,
}: {
  row: T;
  index: number;
  resolved: ReadonlyArray<Resolved<T>>;
  width: number;
  gap: number;
  selected: boolean;
  renderDetail?: (row: T, selected: boolean, width: number) => ReactNode;
  separator: boolean;
  onRowClick?: (index: number, row: T) => void;
}) {
  return (
    // The handler sits on the outer box so every cell of the row answers to a
    // click — a row with dead columns in it reads as an unreliable target.
    <box
      style={{
        flexDirection: "column",
        width,
        backgroundColor: selected ? theme.selected : undefined,
        flexShrink: 0,
      }}
      onMouseDown={onRowClick ? () => onRowClick(index, row) : undefined}
    >
      <box style={{ flexDirection: "row" }}>
        {resolved.map(({ column, width: cellWidth }, i) => (
          <Cell key={column.key} width={cellWidth} gap={i > 0 ? gap : 0}>
            {column.render(row, selected, cellWidth)}
          </Cell>
        ))}
      </box>
      {renderDetail ? (
        <box style={{ flexDirection: "row", width }}>{renderDetail(row, selected, width)}</box>
      ) : null}
      {separator ? <text fg={theme.border}>{"─".repeat(Math.max(0, width))}</text> : null}
    </box>
  );
}

/**
 * A row-shaped placeholder at the exact geometry of a real row, so content
 * never jumps when the data lands: same columns, same widths, same number of
 * lines. Bar lengths vary with the row index so the list reads as pending
 * content rather than a progress bar, and vary *deterministically* so frames
 * are stable across renders.
 */
function SkeletonRow<T>({
  resolved,
  width,
  gap,
  seed,
  detail,
  separator,
}: {
  resolved: ReadonlyArray<Resolved<T>>;
  width: number;
  gap: number;
  seed: number;
  detail: boolean;
  separator: boolean;
}) {
  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      <box style={{ flexDirection: "row" }}>
        {resolved.map(({ column, width: cellWidth }, i) => (
          <Cell key={column.key} width={cellWidth} gap={i > 0 ? gap : 0}>
            <text fg={theme.panelAlt}>
              {padText(bar(cellWidth, seed + i), cellWidth, column.align ?? "left")}
            </text>
          </Cell>
        ))}
      </box>
      {detail ? (
        <box style={{ flexDirection: "row", width }}>
          <text fg={theme.panelAlt}>{padText(bar(width, seed + 7), width)}</text>
        </box>
      ) : null}
      {separator ? <text fg={theme.border}>{"─".repeat(Math.max(0, width))}</text> : null}
    </box>
  );
}

/** A dash bar of a deterministic fraction of the cell, never wider than it. */
function bar(width: number, seed: number): string {
  if (width <= 0) return "";
  const fraction = 0.4 + ((seed * 17) % 45) / 100;
  return "─".repeat(Math.max(1, Math.min(width, Math.floor(width * fraction))));
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function TableEmpty({
  title,
  lines = [],
}: {
  title: string;
  lines?: ReadonlyArray<string | undefined>;
}) {
  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text fg={theme.text}>{title}</text>
      {lines.filter(Boolean).map((line, i) => (
        <text key={i} fg={theme.muted}>
          {line}
        </text>
      ))}
    </box>
  );
}

function TableError({ title, error }: { title: string; error: AsyncError }) {
  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text fg={theme.danger}>{title}</text>
      <text fg={theme.muted}>{error.message}</text>
      {error.retryable ? <text fg={theme.muted}>R to retry</text> : null}
    </box>
  );
}
