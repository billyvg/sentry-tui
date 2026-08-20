import stringWidth from "string-width";

/** Display width of a string in terminal cells (grapheme/east-asian aware). */
export function measureTextWidth(text: string): number {
  return stringWidth(text);
}

/**
 * Truncate to `width` cells, appending an ellipsis when it doesn't fit.
 * Width is measured in display cells, not code units, so CJK and emoji behave.
 */
export function fitText(text: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (measureTextWidth(text) <= width) return text;

  const ellipsisWidth = measureTextWidth(ellipsis);
  if (width <= ellipsisWidth) return ellipsis.slice(0, width);

  const budget = width - ellipsisWidth;
  let out = "";
  let used = 0;
  for (const char of text) {
    const w = measureTextWidth(char);
    if (used + w > budget) break;
    out += char;
    used += w;
  }
  return out + ellipsis;
}

/** Pad to exactly `width` cells (truncating if too long). */
export function padText(
  text: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  const fitted = fitText(text, width);
  const pad = " ".repeat(Math.max(0, width - measureTextWidth(fitted)));
  return align === "left" ? fitted + pad : pad + fitted;
}
