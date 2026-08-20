import { expect, test } from "bun:test";

import { scrollTopForRow } from "./listScroll";

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
