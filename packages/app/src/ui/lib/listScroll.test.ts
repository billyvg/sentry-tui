import { expect, test } from "bun:test";

import { scrollTopForRow, scrollTopForRowAt } from "./listScroll";

/** A 20-line viewport over 4-line rows — five rows on screen at a time. */
const list = (index: number, scrollTop: number, rowCount = 20) =>
  scrollTopForRow({ index, rowCount, rowHeight: 4, viewportHeight: 20, scrollTop });

test("leaves the offset alone while the row is already on screen", () => {
  expect(list(0, 0)).toBe(0);
  expect(list(4, 0)).toBe(0); // last fully visible row
  expect(list(5, 4)).toBe(4);
});

test("scrolls down by just enough to reveal the row below the fold", () => {
  expect(list(5, 0)).toBe(4); // one row of travel, not a jump to centre
  expect(list(6, 0)).toBe(8);
});

test("scrolls up to the row's top edge when it is above the fold", () => {
  expect(list(3, 20)).toBe(12);
  expect(list(0, 20)).toBe(0);
});

test("clamps to the ends of the content", () => {
  expect(list(19, 0)).toBe(60); // 20 rows × 4 − 20 viewport
  expect(list(0, 60)).toBe(0);
});

test("never scrolls a list shorter than its viewport", () => {
  expect(list(2, 0, 3)).toBe(0);
});

test("aligns a row taller than the viewport to its top line", () => {
  // The cursor lives on the row's first line, so that is the line to keep.
  expect(
    scrollTopForRow({ index: 2, rowCount: 10, rowHeight: 4, viewportHeight: 3, scrollTop: 0 }),
  ).toBe(8);
});

// ---------------------------------------------------------------------------
// Variable-height rows — the release cards
// ---------------------------------------------------------------------------

/** Cards of 6, 5, 9 and 6 lines: 26 lines of content in a 12-line viewport. */
const CARDS = [6, 5, 9, 6];

const cards = (index: number, scrollTop: number, heights: readonly number[] = CARDS) => {
  let rowTop = 0;
  for (let i = 0; i < index; i++) rowTop += heights[i]!;
  return scrollTopForRowAt({
    rowTop,
    rowHeight: heights[index]!,
    contentHeight: heights.reduce((total, height) => total + height, 0),
    viewportHeight: 12,
    scrollTop: 0 + scrollTop,
  });
};

test("a variable-height row already on screen leaves the offset alone", () => {
  expect(cards(0, 0)).toBe(0);
  expect(cards(1, 0)).toBe(0); // 6 + 5 = 11 lines, still inside 12
});

test("a variable-height row is pulled up by its own overhang, not a row height", () => {
  // The third card ends at line 20; showing all of it needs an offset of 8.
  expect(cards(2, 0)).toBe(8);
  // The fourth ends at 26, so 14 — clamped to the content's own end.
  expect(cards(3, 0)).toBe(14);
});

test("a card taller than the viewport aligns to its first line", () => {
  expect(cards(1, 0, [4, 20, 4])).toBe(4);
});

test("scrolls back up to a card above the fold", () => {
  expect(cards(0, 10)).toBe(0);
});
