/**
 * Laying a dashboard's widgets out in a terminal.
 *
 * The web draws a 6-column responsive react-grid-layout. Reproducing that at
 * eighty columns gives you widgets thirteen cells wide, which is not a widget —
 * so the honest equivalent is to keep the author's reading order and stack the
 * widgets one per row, full width. `y` then `x` is exactly that order.
 *
 * Card heights come from the widget's *shape*, never from its data, which is
 * what lets the grid hold its geometry while every widget is still in flight.
 */

import { MAX_CATEGORICAL_BARS, tableRowLimit, type WidgetRenderKind } from "~/api/dashboardWidgets";
import type { DashboardWidget } from "~/api/dashboards";
import { BIG_DIGIT_ROWS } from "~/lib/bigDigits";

/** Top and bottom border of a card. */
const CARD_BORDER_ROWS = 2;
/** The card's title line. */
const CARD_TITLE_ROWS = 1;
/** Blank line between two cards, so the stack doesn't read as one long box. */
export const CARD_GAP_ROWS = 1;

/** Chart rows in a series card, plus the row of time labels under them. */
export const SERIES_CHART_ROWS = 8;
const SERIES_AXIS_ROWS = 1;

/** The big value plus the aggregate it is of. */
const NUMBER_BODY_ROWS = BIG_DIGIT_ROWS + 1;

/** Headline plus one line of explanation. */
const UNSUPPORTED_BODY_ROWS = 2;

/** A table card's header row; the data rows are counted from the widget. */
const TABLE_HEADER_ROWS = 1;

/**
 * Body lines a widget's card needs, before its border and title.
 *
 * Derived from the widget alone — a table asks for as many rows as it will
 * request, drawn as skeleton until they land — so nothing below a widget moves
 * when its data arrives.
 */
export function widgetBodyLines(widget: DashboardWidget, kind: WidgetRenderKind): number {
  switch (kind) {
    case "number":
      return NUMBER_BODY_ROWS;
    case "series":
      return SERIES_CHART_ROWS + SERIES_AXIS_ROWS;
    case "table":
      return TABLE_HEADER_ROWS + tableRowLimit(widget);
    case "bars":
      return barRowCount(widget);
    case "unsupported":
      return UNSUPPORTED_BODY_ROWS;
  }
}

/** Terminal lines a widget's card occupies, its trailing gap included. */
export function widgetCardHeight(widget: DashboardWidget, kind: WidgetRenderKind): number {
  return CARD_BORDER_ROWS + CARD_TITLE_ROWS + widgetBodyLines(widget, kind) + CARD_GAP_ROWS;
}

/**
 * Bars a categorical widget draws.
 *
 * The row count has to be fixed before the data lands, so it is the number the
 * request asks for rather than the number that comes back — a short answer
 * leaves blank rows instead of shifting every widget below it.
 */
export function barRowCount(widget: DashboardWidget): number {
  const limit = widget.limit ?? MAX_CATEGORICAL_BARS;
  return Math.max(1, Math.min(limit, MAX_CATEGORICAL_BARS));
}

/**
 * The widgets in the order a terminal reads them: down the author's layout,
 * then across. Widgets with no layout keep their stored order, behind the ones
 * that have one — an unplaced widget is one the web appends too.
 */
export function orderWidgets(widgets: readonly DashboardWidget[]): DashboardWidget[] {
  return [...widgets]
    .map((widget, index) => ({ widget, index }))
    .sort((a, b) => {
      const layoutA = a.widget.layout;
      const layoutB = b.widget.layout;
      if (!layoutA && !layoutB) return a.index - b.index;
      if (!layoutA) return 1;
      if (!layoutB) return -1;
      return layoutA.y - layoutB.y || layoutA.x - layoutB.x || a.index - b.index;
    })
    .map(({ widget }) => widget);
}

/** Line each card starts on, given the heights above it. */
export function stackOffsets(heights: readonly number[]): number[] {
  const tops: number[] = [];
  let top = 0;
  for (const height of heights) {
    tops.push(top);
    top += height;
  }
  return tops;
}

/**
 * Scroll offset that keeps the selected card inside the viewport.
 *
 * `listScroll.ts` does this for rows of one height; widget cards are all
 * different heights, so the same minimal-move rule is applied against the
 * actual offsets. A card taller than the viewport aligns to its top, since the
 * top is where its title and its cursor marker are.
 */
export function scrollTopForWidget({
  heights,
  index,
  viewportHeight,
  scrollTop,
}: {
  heights: readonly number[];
  index: number;
  viewportHeight: number;
  scrollTop: number;
}): number {
  if (heights.length === 0 || viewportHeight <= 0) return 0;

  const clamped = Math.max(0, Math.min(index, heights.length - 1));
  const tops = stackOffsets(heights);
  const contentHeight = tops[heights.length - 1]! + heights[heights.length - 1]!;
  const maxScrollTop = Math.max(0, contentHeight - viewportHeight);

  const top = tops[clamped]!;
  const bottom = top + heights[clamped]!;

  const next =
    top < scrollTop || heights[clamped]! > viewportHeight
      ? top
      : bottom > scrollTop + viewportHeight
        ? bottom - viewportHeight
        : scrollTop;

  return Math.min(Math.max(next, 0), maxScrollTop);
}
