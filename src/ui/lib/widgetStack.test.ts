import { describe, expect, test } from "bun:test";

import { widgetRenderKind } from "~/api/dashboardWidgets";
import type { DashboardWidget, WidgetDisplayType, WidgetLayout } from "~/api/dashboards";
import {
  barRowCount,
  orderWidgets,
  scrollTopForWidget,
  stackOffsets,
  widgetCardHeight,
} from "~/ui/lib/widgetStack";

function widget(
  title: string,
  layout?: Partial<WidgetLayout>,
  displayType: WidgetDisplayType = "table",
): DashboardWidget {
  return {
    id: title,
    title,
    displayType,
    queries: [],
    layout: layout ? { x: 0, y: 0, w: 2, h: 2, ...layout } : null,
  };
}

const titles = (widgets: readonly DashboardWidget[]) => widgets.map((w) => w.title);

describe("orderWidgets", () => {
  test("reads down the author's layout, then across", () => {
    const ordered = orderWidgets([
      widget("bottom-right", { x: 4, y: 2 }),
      widget("top-right", { x: 4, y: 0 }),
      widget("top-left", { x: 0, y: 0 }),
      widget("middle", { x: 2, y: 1 }),
    ]);
    expect(titles(ordered)).toEqual(["top-left", "top-right", "middle", "bottom-right"]);
  });

  test("widgets sharing a slot keep the order the dashboard stored them in", () => {
    const ordered = orderWidgets([
      widget("second", { x: 0, y: 0 }),
      widget("first", { x: 0, y: 0 }),
    ]);
    expect(titles(ordered)).toEqual(["second", "first"]);
  });

  test("an unplaced widget sorts last, as the web appends it", () => {
    const ordered = orderWidgets([widget("unplaced"), widget("placed", { x: 0, y: 5 })]);
    expect(titles(ordered)).toEqual(["placed", "unplaced"]);
  });

  test("the input is not mutated", () => {
    const input = [widget("b", { y: 1 }), widget("a", { y: 0 })];
    orderWidgets(input);
    expect(titles(input)).toEqual(["b", "a"]);
  });
});

describe("widgetCardHeight", () => {
  const heightOf = (w: DashboardWidget) => widgetCardHeight(w, widgetRenderKind(w.displayType));

  test("depends on the widget's shape, never on its data", () => {
    const table = widget("t", undefined, "table");
    // Same widget, same height, whatever has or hasn't arrived.
    expect(heightOf(table)).toBe(heightOf({ ...table }));
  });

  test("a table reserves a row per row it will request", () => {
    const five = widget("five", undefined, "table");
    const ten = { ...widget("ten", undefined, "table"), limit: 10 };
    expect(heightOf(ten) - heightOf(five)).toBe(5);
  });

  test("every kind fits in a modest terminal", () => {
    for (const displayType of ["big_number", "line", "table", "categorical_bar", "wheel"]) {
      expect(heightOf(widget("w", undefined, displayType))).toBeLessThanOrEqual(20);
    }
  });

  test("a categorical widget draws no more bars than a card can hold", () => {
    expect(barRowCount(widget("w", undefined, "categorical_bar"))).toBe(8);
    expect(barRowCount({ ...widget("w", undefined, "categorical_bar"), limit: 25 })).toBe(8);
    expect(barRowCount({ ...widget("w", undefined, "categorical_bar"), limit: 3 })).toBe(3);
  });
});

describe("stackOffsets", () => {
  test("each card starts where the one above it ended", () => {
    expect(stackOffsets([4, 6, 2])).toEqual([0, 4, 10]);
    expect(stackOffsets([])).toEqual([]);
  });
});

describe("scrollTopForWidget", () => {
  const heights = [10, 10, 10, 10];

  test("a card already on screen doesn't move the viewport", () => {
    expect(scrollTopForWidget({ heights, index: 0, viewportHeight: 20, scrollTop: 0 })).toBe(0);
    expect(scrollTopForWidget({ heights, index: 1, viewportHeight: 20, scrollTop: 0 })).toBe(0);
  });

  test("moving past the bottom pulls the viewport down by the minimum", () => {
    expect(scrollTopForWidget({ heights, index: 2, viewportHeight: 20, scrollTop: 0 })).toBe(10);
  });

  test("moving above the top aligns to the card", () => {
    expect(scrollTopForWidget({ heights, index: 0, viewportHeight: 20, scrollTop: 20 })).toBe(0);
  });

  test("the offset never runs past the end of the content", () => {
    expect(scrollTopForWidget({ heights, index: 3, viewportHeight: 20, scrollTop: 0 })).toBe(20);
    expect(scrollTopForWidget({ heights, index: 3, viewportHeight: 100, scrollTop: 0 })).toBe(0);
  });

  test("a card taller than the viewport shows its top, where its title is", () => {
    expect(scrollTopForWidget({ heights: [30], index: 0, viewportHeight: 10, scrollTop: 5 })).toBe(
      0,
    );
  });

  test("an empty stack has nowhere to scroll", () => {
    expect(scrollTopForWidget({ heights: [], index: 0, viewportHeight: 20, scrollTop: 4 })).toBe(0);
  });

  test("an out-of-range cursor is clamped rather than read past the end", () => {
    expect(scrollTopForWidget({ heights, index: 99, viewportHeight: 20, scrollTop: 0 })).toBe(20);
  });
});
