import { describe, expect, test } from "bun:test";

import { layoutColumns, type ColumnSpec } from "~/ui/lib/tableLayout";

const GAP = 1;

/** Cells the resolved row actually spends, gaps included. */
function spent(resolved: ReturnType<typeof layoutColumns>): number {
  return (
    resolved.reduce((sum, column) => sum + column.width, 0) + GAP * Math.max(0, resolved.length - 1)
  );
}

const COLUMNS: ColumnSpec[] = [
  { key: "name", width: "flex" },
  { key: "time", width: 12 },
  { key: "project", width: 30, priority: 3 },
  { key: "env", width: 30, priority: 2 },
  { key: "extra", width: 30, priority: 1 },
];

describe("layoutColumns", () => {
  test("fills the available width exactly when a flex column can absorb it", () => {
    const resolved = layoutColumns(COLUMNS, 140);
    expect(resolved.map((r) => r.column.key)).toEqual(["name", "time", "project", "env", "extra"]);
    expect(spent(resolved)).toBe(140);
  });

  test("sheds the lowest priority first, and never the columns without one", () => {
    expect(layoutColumns(COLUMNS, 98).map((r) => r.column.key)).toEqual([
      "name",
      "time",
      "project",
      "env",
    ]);
    expect(layoutColumns(COLUMNS, 78).map((r) => r.column.key)).toEqual([
      "name",
      "time",
      "project",
    ]);
    expect(layoutColumns(COLUMNS, 30).map((r) => r.column.key)).toEqual(["name", "time"]);
  });

  test("offsets follow the widths, so a cell knows where it starts", () => {
    const resolved = layoutColumns(COLUMNS, 140);
    let expected = 0;
    for (const column of resolved) {
      expect(column.offset).toBe(expected);
      expected += column.width + GAP;
    }
  });

  test("never spends more than it has, at any width", () => {
    for (let width = 1; width <= 200; width++) {
      expect(spent(layoutColumns(COLUMNS, width))).toBeLessThanOrEqual(width);
    }
  });

  test("a row of fixed columns too wide to fit is clamped, not overflowed", () => {
    const fixed: ColumnSpec[] = [
      { key: "a", width: 20 },
      { key: "b", width: 20 },
    ];
    const resolved = layoutColumns(fixed, 25);
    expect(spent(resolved)).toBeLessThanOrEqual(25);
    expect(resolved.every((column) => column.width >= 1)).toBe(true);
  });

  test("a tie in priority is broken rightmost-first", () => {
    const tied: ColumnSpec[] = [
      { key: "keep", width: 10 },
      { key: "left", width: 10, priority: 1 },
      { key: "right", width: 10, priority: 1 },
    ];
    expect(layoutColumns(tied, 21).map((r) => r.column.key)).toEqual(["keep", "left"]);
  });
});
