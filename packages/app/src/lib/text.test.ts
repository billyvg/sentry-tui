import { describe, expect, test } from "bun:test";

import { fitText, measureTextWidth, middleEllipsis, padText, wrapText } from "~/lib/text";

describe("middleEllipsis", () => {
  test("leaves a value that already fits alone", () => {
    expect(middleEllipsis("https://example.com", 40)).toBe("https://example.com");
  });

  test("keeps both ends of a value that doesn't", () => {
    const trimmed = middleEllipsis("https://example.com/pricing?utm_source=terminal", 30);
    expect(measureTextWidth(trimmed)).toBe(30);
    expect(trimmed.startsWith("https://")).toBe(true);
    expect(trimmed.endsWith("terminal")).toBe(true);
    expect(trimmed).toContain("…");
  });

  test("measures in display cells, so wide characters can't overflow", () => {
    // Two-cell characters cannot always land on the budget exactly; what
    // matters is that they never exceed it.
    expect(measureTextWidth(middleEllipsis("日本語のクエリ文字列です", 10))).toBeLessThanOrEqual(
      10,
    );
    expect(measureTextWidth(middleEllipsis("日本語のクエリ文字列です", 10))).toBeGreaterThan(7);
  });

  test("degrades rather than throwing at widths too small to trim", () => {
    expect(middleEllipsis("anything", 1)).toBe("…");
    expect(middleEllipsis("anything", 0)).toBe("");
  });
});

describe("single-line cells", () => {
  // A newline in a table cell wraps inside its fixed-width box, which grows
  // the row and pushes every row under it out of alignment — and it measures
  // zero cells, so the padding computed around it is wrong too.
  test("a newline in a value becomes a space rather than a second line", () => {
    expect(fitText("Error: expect(\n  received", 40)).toBe("Error: expect(   received");
    expect(padText("first\nsecond", 20)).toBe("first second        ");
    expect(padText("first\nsecond", 20)).not.toContain("\n");
  });

  test("tabs and carriage returns go the same way", () => {
    expect(fitText("a\tb\r\nc", 10)).toBe("a b c");
  });

  // A jest or pytest failure reaches Sentry with its colours still on. The
  // terminal would act on those escapes: repaint the row, and lose the
  // alignment `string-width` computed while ignoring them.
  test("colour escapes are stripped, not drawn", () => {
    const coloured = "Error: \u001b[2mexpect(\u001b[22m\u001b[31mjest.fn()\u001b[39m";
    expect(fitText(coloured, 40)).toBe("Error: expect(jest.fn()");
    expect(padText(coloured, 30)).toBe("Error: expect(jest.fn()       ");
    expect(middleEllipsis(coloured, 12)).not.toContain("\u001b");
  });
});

describe("multiline text", () => {
  test("preserves newlines while stripping ANSI escapes and other controls", () => {
    const text = "\u001b[31malpha beta\u001b[0m\nx\r y";

    expect(wrapText(text, 6)).toEqual(["alpha", "beta", "x y"]);
  });

  test("wraps sanitized wide text to its measured display width", () => {
    const lines = wrapText("\u001b[32m日本語 abc\u001b[0m\n🙂🙂🙂", 5);

    expect(lines).toEqual(["日本", "語", "abc", "🙂🙂", "🙂"]);
    expect(lines.map(measureTextWidth)).toEqual([4, 2, 3, 4, 2]);
  });
});
