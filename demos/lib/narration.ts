/**
 * Reading beats out of `narration.md`.
 *
 * The script is prose first — it gets edited, read aloud and argued about far
 * more than it gets parsed — so the format is just Markdown: an `### BNN · …`
 * heading opens a beat, and the blockquote under it is what gets spoken. Stage
 * directions are ordinary paragraphs, which keeps them out of the audio without
 * needing a syntax of their own.
 */

export interface Beat {
  /** `B07`. */
  id: string;
  /** The heading text after the id, for logs and progress output. */
  title: string;
  /** What the voice says, newlines collapsed to spaces. */
  text: string;
  /** Beats tagged `[CUT]` are optional — the first things to drop for length. */
  optional: boolean;
  /**
   * A deliberate departure from the script's uniform pace, from an
   * `**Emphasis:** 0.9` line: 0.9 reads this beat 10% slower than every other
   * one, 1.1 pushes it 10% faster.
   *
   * Pace itself is not set here. `lib/pace.ts` measures what the synthesizer
   * actually produced and corrects every beat onto one rate, because asking for
   * a rate does not get you one — the same `speed` yields a raced short line
   * and a draggy list. This is the knob for when a line should genuinely sit
   * apart from the rest, and it is relative to that corrected rate, so using it
   * on one beat leaves the others where they were.
   */
  emphasis?: number;
}

const HEADING = /^###\s+(B\d+)\s*[·.\-–]?\s*(.*)$/;
/**
 * `**Emphasis:** 0.9` — a stage direction, so it is never spoken.
 *
 * Matches the label loosely and validates the value, so a typo is an error
 * rather than a line that looks like it set something and didn't.
 */
const EMPHASIS = /^\*\*Emphasis:\*\*\s*(.*)$/;

/**
 * Parse every beat in a narration document, in document order.
 *
 * A beat with no blockquote is a parse error rather than a silent skip: a beat
 * the tape waits on but the voice never fills would show up as a mysterious
 * three-second pause in the finished cut.
 */
export function parseNarration(source: string): Beat[] {
  const beats: Beat[] = [];
  const lines = source.split("\n");

  let current: { id: string; title: string; quote: string[]; emphasis?: number } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.quote.join(" ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error(`Beat ${current.id} has no narration blockquote`);
    beats.push({
      id: current.id,
      title: current.title.replace(/\s*`?\[CUT\]`?\s*$/, "").trim(),
      text,
      optional: /\[CUT\]/.test(current.title),
      ...(current.emphasis === undefined ? {} : { emphasis: current.emphasis }),
    });
    current = null;
  };

  for (const line of lines) {
    const heading = HEADING.exec(line.trim());
    if (heading) {
      flush();
      current = { id: heading[1] ?? "", title: heading[2] ?? "", quote: [] };
      continue;
    }
    // Any other heading ends the beat — notably the appendices at the end of
    // the document, which contain blockquotes that are not narration.
    if (line.startsWith("#")) {
      flush();
      continue;
    }
    const emphasis = current && EMPHASIS.exec(line.trim());
    if (emphasis) {
      const value = Number(emphasis[1]);
      if (!(value > 0)) {
        throw new Error(`Beat ${current!.id} has an unusable Emphasis: "${emphasis[1]}"`);
      }
      current!.emphasis = value;
      continue;
    }
    if (current && line.trimStart().startsWith(">")) {
      current.quote.push(line.trimStart().replace(/^>\s?/, ""));
    }
  }
  flush();

  return beats;
}

/** Beats keyed by id, for the pipeline stages that look them up. */
export function beatsById(beats: Beat[]): Map<string, Beat> {
  return new Map(beats.map((beat) => [beat.id, beat]));
}
