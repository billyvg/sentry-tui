import type { ReactNode } from "react";

import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";

export interface HighlightedLabelProps {
  text: string;
  /** Code-unit indices into `text` that matched the query. */
  positions: readonly number[];
  /** Columns the label may occupy; the overflow is replaced by an ellipsis. */
  width: number;
  /** Colour for the characters the query did not match. */
  fg: string;
}

/**
 * Draw a label with its matched characters picked out in the accent colour.
 *
 * Positions are code-unit indices from `fuzzyMatch`, and truncation only ever
 * cuts a suffix, so indices still line up with the fitted string; anything the
 * ellipsis swallowed simply stops being highlighted.
 */
export function HighlightedLabel({ text, positions, width, fg }: HighlightedLabelProps) {
  const fitted = fitText(text, width);
  const visible = fitted === text ? fitted.length : Math.max(0, fitted.length - 1);
  const matched = new Set(positions);

  const spans: ReactNode[] = [];
  let buffer = "";
  let bufferMatched = false;
  const flush = () => {
    if (!buffer) return;
    spans.push(
      <span key={spans.length} fg={bufferMatched ? theme.accent : fg}>
        {buffer}
      </span>,
    );
    buffer = "";
  };

  for (let i = 0; i < fitted.length; i++) {
    const isMatch = i < visible && matched.has(i);
    if (isMatch !== bufferMatched) {
      flush();
      bufferMatched = isMatch;
    }
    buffer += fitted[i];
  }
  flush();

  return <text>{spans}</text>;
}
