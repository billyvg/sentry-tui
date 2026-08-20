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

/**
 * Break text into lines that each fit `width` cells, preserving existing
 * newlines.
 *
 * Wrapping happens at spaces; a single word longer than `width` (a URL, a
 * stack frame path) is hard-split rather than allowed to overflow the pane.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];

  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (measureTextWidth(candidate) <= width) {
        current = candidate;
        continue;
      }
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      // A word that can't fit on a line of its own gets hard-split.
      let rest = word;
      while (measureTextWidth(rest) > width) {
        let chunk = "";
        let used = 0;
        for (const char of rest) {
          const w = measureTextWidth(char);
          if (used + w > width) break;
          chunk += char;
          used += w;
        }
        lines.push(chunk);
        rest = rest.slice(chunk.length);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

/** Pad to exactly `width` cells (truncating if too long). */
export function padText(
  text: string,
  width: number,
  align: "left" | "right" | "center" = "left",
): string {
  const fitted = fitText(text, width);
  const slack = Math.max(0, width - measureTextWidth(fitted));
  if (align === "center") {
    // Odd slack leans left, so a label sits against the leading edge of its
    // cell rather than drifting right of centre.
    const left = Math.floor(slack / 2);
    return " ".repeat(left) + fitted + " ".repeat(slack - left);
  }
  const pad = " ".repeat(slack);
  return align === "left" ? fitted + pad : pad + fitted;
}
