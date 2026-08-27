import { describe, expect, test } from "bun:test";

import { BIG_DIGIT_ROWS, bigDigitLines, bigDigitWidth, splitBigValue } from "~/lib/bigDigits";

describe("bigDigitLines", () => {
  test("always returns the same number of rows, all the same width", () => {
    for (const text of ["0", "1234567890", "-1.5", "", "abc"]) {
      const lines = bigDigitLines(text);
      expect(lines).toHaveLength(BIG_DIGIT_ROWS);
      expect(new Set(lines.map((line) => line.length)).size).toBe(1);
    }
  });

  test("the width can be predicted without building the lines", () => {
    for (const text of ["7", "42", "1.5", "-99", ""]) {
      expect(bigDigitWidth(text)).toBe(bigDigitLines(text)[0]!.length);
    }
  });

  test("every digit has a distinct silhouette, which three rows would not give", () => {
    const shapes = new Set("0123456789".split("").map((digit) => bigDigitLines(digit).join("|")));
    expect(shapes.size).toBe(10);
  });

  test("characters with no glyph are dropped rather than substituted", () => {
    expect(bigDigitLines("1k")).toEqual(bigDigitLines("1"));
    expect(bigDigitLines("—")[0]).toBe("");
  });
});

describe("splitBigValue", () => {
  test("splits a formatted value at its first unprintable character", () => {
    expect(splitBigValue("1.4k")).toEqual({ numeric: "1.4", suffix: "k" });
    expect(splitBigValue("9999")).toEqual({ numeric: "9999", suffix: "" });
    expect(splitBigValue("-2b")).toEqual({ numeric: "-2", suffix: "b" });
  });

  test("a value with nothing drawable comes back for the caller to print small", () => {
    expect(splitBigValue("—")).toEqual({ numeric: "", suffix: "—" });
  });
});
