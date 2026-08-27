import stringWidth from "string-width";

/** Display width of a string in terminal cells (grapheme/east-asian aware). */
export function measureTextWidth(text: string): number {
  return stringWidth(text);
}

/**
 * Escape sequences a value can arrive wrapped in.
 *
 * Sentry stores what the SDK sent, and what the SDK sent is sometimes a jest
 * or pytest failure with its colours still on: an issue title that reads
 * `Error: \u001b[2mexpect(\u001b[22m…`. `string-width` ignores those when it
 * measures, but the terminal does not ignore them when it draws — so a cell
 * padded to its measured width breaks its row, and the colours leak into the
 * theme. OSC first, since its payload can contain anything.
 */
// eslint-disable-next-line no-control-regex -- escape sequences are the point
const OSC_SEQUENCE = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g;
/** Anything that would start a new line, including the Unicode separators. */
const LINE_BREAK = /[\n\r\t\v\f\u0085\u2028\u2029]+/g;
/** Controls other than LF, plus Unicode separators that terminals may treat as line breaks. */
// eslint-disable-next-line no-control-regex
const NON_NEWLINE_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;
/** C0, C1, DEL, and Unicode separators, which draw as nothing or as garbage. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Remove terminal escape sequences without leaving their payload visible. */
function stripEscapeSequences(text: string): string {
  return text.replace(OSC_SEQUENCE, "").replace(ESCAPE_SEQUENCE, "");
}

/** Make multi-line text safe to draw while preserving intentional LF boundaries. */
function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/.test(text)) return text;
  return stripEscapeSequences(text).replace(NON_NEWLINE_CONTROL, "");
}

/**
 * One line of printable text, whatever arrived.
 *
 * A cell is one line by construction, but the *values* are not: an issue title
 * can contain a newline or a colour escape, and a `<text>` holding either
 * breaks its fixed-width box — the newline wraps and grows the row, the escape
 * measures zero cells and repaints the rest of the line. Both are the API's
 * data rather than the app's, so they are normalised at the one place every
 * cell already goes through.
 */
function sanitizeLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text)) return text;
  return stripEscapeSequences(text).replace(LINE_BREAK, " ").replace(CONTROL, "");
}

/**
 * Truncate to `width` cells, appending an ellipsis when it doesn't fit.
 * Width is measured in display cells, not code units, so CJK and emoji behave.
 *
 * The result is always a single line of printable text: see `sanitizeLine`.
 */
export function fitText(input: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  const text = sanitizeLine(input);
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
  for (const paragraph of sanitizeText(text).split("\n")) {
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

/**
 * Trim from the middle, keeping both ends: `checkout-service-worker` at 16
 * cells becomes `checkout…worker`.
 *
 * The end of a value is often what distinguishes it — a URL's path, a query's
 * last clause — so a detector's URL or query is trimmed this way rather than
 * with `fitText`, matching the web's `middleEllipsis`
 * (`utils/string/middleEllipsis.tsx`). That version prefers to drop whole
 * words; this one cuts wherever the budget runs out, which for the
 * forty-cell budget the monitor row uses lands in the same place often
 * enough not to be worth a word-splitting pass.
 */
export function middleEllipsis(input: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  const text = sanitizeLine(input);
  if (measureTextWidth(text) <= width) return text;

  const ellipsisWidth = measureTextWidth(ellipsis);
  if (width <= ellipsisWidth) return ellipsis.slice(0, width);

  const budget = width - ellipsisWidth;
  const headBudget = Math.ceil(budget / 2);
  const tailBudget = budget - headBudget;

  const characters = [...text];
  let head = "";
  let used = 0;
  for (const character of characters) {
    const w = measureTextWidth(character);
    if (used + w > headBudget) break;
    head += character;
    used += w;
  }

  let tail = "";
  used = 0;
  for (let i = characters.length - 1; i >= 0; i--) {
    const character = characters[i]!;
    const w = measureTextWidth(character);
    if (used + w > tailBudget) break;
    tail = character + tail;
    used += w;
  }

  return head + ellipsis + tail;
}
