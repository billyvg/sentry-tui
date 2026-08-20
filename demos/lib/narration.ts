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
}

const HEADING = /^###\s+(B\d+)\s*[·.\-–]?\s*(.*)$/;

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

  let current: { id: string; title: string; quote: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.quote.join(" ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error(`Beat ${current.id} has no narration blockquote`);
    beats.push({
      id: current.id,
      title: current.title.replace(/\s*`?\[CUT\]`?\s*$/, "").trim(),
      text,
      optional: /\[CUT\]/.test(current.title),
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
