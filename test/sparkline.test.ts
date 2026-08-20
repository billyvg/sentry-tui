import { describe, expect, test } from "bun:test";

import { countLabel, sparkline, sparklineBlock } from "~/lib/sparkline";

/** `[unixSeconds, count]` pairs, as `group.stats` returns them. */
function series(...counts: number[]): Array<[number, number]> {
  return counts.map((count, i) => [i, count]);
}

describe("countLabel", () => {
  test("agrees in number with its noun", () => {
    expect(countLabel(1, "event")).toBe("1 event");
    expect(countLabel("1", "event")).toBe("1 event");
    expect(countLabel(2, "event")).toBe("2 events");
    expect(countLabel(0, "user")).toBe("0 users");
  });

  test("treats a count that hasn't arrived as the neutral plural", () => {
    expect(countLabel(undefined, "event")).toBe("·· events");
  });

  test("keeps the compact formatting of the count itself", () => {
    expect(countLabel(1428, "event")).toBe("1.4k events");
  });
});

describe("sparkline floor", () => {
  test("leaves empty buckets blank by default, so a stream column stays legible", () => {
    expect(sparkline(series(0, 5, 0), 3)).toBe(" █ ");
  });

  test("draws a baseline under empty buckets when asked, so it reads as a chart", () => {
    expect(sparkline(series(0, 5, 0), 3, { floor: true })).toBe("▁█▁");
  });

  test("an all-zero window is a flat floor either way — it is data, not absence", () => {
    expect(sparkline(series(0, 0, 0), 3)).toBe("▁▁▁");
    expect(sparkline(series(0, 0, 0), 3, { floor: true })).toBe("▁▁▁");
  });
});

describe("sparklineBlock", () => {
  test("returns exactly the requested rows, topmost first", () => {
    const rows = sparklineBlock(series(1, 2, 3), 3, 3);
    expect(rows).toHaveLength(3);
    // The tallest column is full in every row; the shortest reaches only the
    // bottom one.
    expect(rows[0]).toBe("  █");
    expect(rows[2]![2]).toBe("█");
  });

  test("every row is the same width, so the rows stack into a chart", () => {
    // A series whose tall columns sit on one side is the case that exposes a
    // row measured by its glyphs instead of its full width.
    const rows = sparklineBlock(series(0, 0, 0, 9, 9, 9), 6, 3, { floor: true });
    const widths = new Set(rows.map((row) => row.length));
    expect(widths).toEqual(new Set([6]));
  });

  test("resolves detail a single row flattens away", () => {
    // These buckets are further apart than 1/24 of the maximum but closer than
    // 1/8, which is exactly the band one row of glyphs cannot separate and
    // three rows can.
    const shallow = series(100, 106, 112, 118);
    expect(new Set(sparkline(shallow, 4)).size).toBe(2);
    expect(new Set(sparklineBlock(shallow, 4, 3)[0]!).size).toBe(4);
  });

  test("an all-zero window keeps its floor even without the floor option", () => {
    const rows = sparklineBlock(series(0, 0), 2, 3);
    expect(rows[0]).toBe("  ");
    expect(rows[1]).toBe("  ");
    expect(rows[2]).toBe("▁▁");
  });

  test("a series still in flight fills every row with the pending glyph", () => {
    expect(sparklineBlock(undefined, 3, 2)).toEqual(["╌╌╌", "╌╌╌"]);
  });
});
