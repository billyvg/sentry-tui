/**
 * The trail printed in the content pane's border while a detail view is open.
 *
 * Its job is to answer "where am I, and how deep?" — a pushed view otherwise
 * looks like a screen the nav rail simply doesn't highlight, which is what
 * makes Escape feel like the app's undocumented secret.
 */

import { fitText, measureTextWidth } from "~/lib/text";

/** Between segments. The app's breadcrumb separator everywhere it writes one. */
const SEPARATOR = " › ";

/** Stands in for the segments dropped off the front of a trail that won't fit. */
const ELISION = "…";

/**
 * Join a trail and clamp it to `width`, sacrificing the *front* first.
 *
 * `fitText` alone would be wrong here: it trims the tail, and the tail is the
 * leaf — the one segment that says which issue or which query you are looking
 * at. The ancestors are the recoverable part, so they go first, and only a leaf
 * too long for the pane on its own is trimmed.
 *
 * @param segments Root to leaf, e.g. `["Issues", "Feed", "PUMP-STATION-1"]`.
 *   Blank entries are dropped, so a view with no label costs nothing.
 * @param width Cells available. Zero or less yields an empty string.
 */
export function breadcrumbTrail(segments: readonly (string | undefined)[], width: number): string {
  const parts = segments.filter((part): part is string => Boolean(part && part.trim()));
  if (parts.length === 0 || width <= 0) return "";

  const full = parts.join(SEPARATOR);
  if (measureTextWidth(full) <= width) return full;

  // Drop ancestors one at a time, nearest the root first, until what's left
  // fits behind the elision marker.
  for (let first = 1; first < parts.length; first++) {
    const candidate = [ELISION, ...parts.slice(first)].join(SEPARATOR);
    if (measureTextWidth(candidate) <= width) return candidate;
  }

  return fitText(parts[parts.length - 1]!, width);
}
