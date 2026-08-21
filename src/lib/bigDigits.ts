/**
 * Block-glyph numerals, for the one widget a terminal draws better than a
 * browser: a single number, big, in the middle of a card.
 *
 * Five rows rather than three — at three, `6`, `8` and `0` collapse onto the
 * same silhouette, and a metric you have to squint at is worse than a small
 * one you can read. Only the characters a formatted Sentry value can contain
 * are drawn large; anything else (a `k` suffix, a unit, a `%`) is the caller's
 * to print at normal size beside them, which is how the web sets them too.
 */

/** Terminal rows one glyph occupies. */
export const BIG_DIGIT_ROWS = 5;

/** Blank column between two glyphs. */
const GLYPH_GAP = " ";

/**
 * Five-row glyphs, top row first. Every glyph is rectangular — same width on
 * every row — so a line can be assembled by concatenation without measuring.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "0": ["███", "█ █", "█ █", "█ █", "███"],
  "1": [" ██", "  █", "  █", "  █", "  █"],
  "2": ["███", "  █", "███", "█  ", "███"],
  "3": ["███", "  █", "███", "  █", "███"],
  "4": ["█ █", "█ █", "███", "  █", "  █"],
  "5": ["███", "█  ", "███", "  █", "███"],
  "6": ["███", "█  ", "███", "█ █", "███"],
  "7": ["███", "  █", "  █", "  █", "  █"],
  "8": ["███", "█ █", "███", "█ █", "███"],
  "9": ["███", "█ █", "███", "  █", "███"],
  "-": ["   ", "   ", "███", "   ", "   "],
  ".": [" ", " ", " ", " ", "█"],
  ",": [" ", " ", " ", " ", "█"],
  " ": [" ", " ", " ", " ", " "],
};

/** Whether a character has a large glyph. */
export function hasBigGlyph(char: string): boolean {
  return char in GLYPHS;
}

/**
 * Split a formatted value into the part that can be drawn large and the
 * trailing part that can't: `"1.4k"` → `{ numeric: "1.4", suffix: "k" }`.
 *
 * The split is at the first character without a glyph, so a leading `—` or a
 * value that is all letters comes back with an empty numeric part and the
 * caller can fall back to printing it at normal size.
 */
export function splitBigValue(formatted: string): { numeric: string; suffix: string } {
  let end = 0;
  while (end < formatted.length && hasBigGlyph(formatted[end]!)) end++;
  return { numeric: formatted.slice(0, end), suffix: formatted.slice(end) };
}

/**
 * Render text as `BIG_DIGIT_ROWS` lines of block glyphs, topmost first.
 *
 * Characters with no glyph are skipped rather than substituted — the caller
 * decides what to do with them via `splitBigValue`. Always returns exactly
 * `BIG_DIGIT_ROWS` strings, all of the same width, so a card can lay them out
 * without measuring each one.
 */
export function bigDigitLines(text: string): string[] {
  const glyphs = [...text].map((char) => GLYPHS[char]).filter((glyph) => glyph !== undefined);
  if (glyphs.length === 0) return Array.from({ length: BIG_DIGIT_ROWS }, () => "");

  return Array.from({ length: BIG_DIGIT_ROWS }, (_, row) =>
    glyphs.map((glyph) => glyph[row]!).join(GLYPH_GAP),
  );
}

/** Cells `bigDigitLines(text)` will occupy, without building them. */
export function bigDigitWidth(text: string): number {
  const glyphs = [...text].map((char) => GLYPHS[char]).filter((glyph) => glyph !== undefined);
  if (glyphs.length === 0) return 0;
  return (
    glyphs.reduce((sum, glyph) => sum + glyph[0]!.length, 0) +
    GLYPH_GAP.length * (glyphs.length - 1)
  );
}
