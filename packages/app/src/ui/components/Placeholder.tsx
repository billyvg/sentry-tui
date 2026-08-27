import { useTheme } from "~/ui/theme";
import { padText } from "~/lib/text";
import { ITALIC, NONE } from "~/ui/lib/attributes";

/**
 * Text that falls back to a dimmed, italicised label when empty.
 *
 * An issue can legitimately have no exception value — a `captureMessage` with
 * an empty string, or an event whose metadata never resolved — and a blank
 * line there reads as a rendering bug rather than as absent data. Saying so
 * explicitly, in a weight that recedes, keeps the row honest without letting
 * the placeholder compete with real content.
 *
 * Distinct from the `··` that `formatCount` renders: that means *not yet
 * fetched*, this means *fetched, and genuinely empty*.
 */
export function Placeholder({
  text,
  fallback,
  width,
  fg,
  attributes = NONE,
}: {
  text: string | null | undefined;
  /** Shown when `text` is empty. Parenthesised by convention: "(no title)". */
  fallback: string;
  /** Pads to exactly this many cells, keeping columns aligned. */
  width: number;
  fg?: string;
  attributes?: number;
}) {
  const theme = useTheme();
  const empty = !text || text.trim().length === 0;
  return (
    <text
      fg={empty ? theme.subText : (fg ?? theme.text)}
      attributes={empty ? ITALIC : attributes}
      style={{ flexShrink: 0 }}
    >
      {padText(empty ? fallback : text, width)}
    </text>
  );
}
