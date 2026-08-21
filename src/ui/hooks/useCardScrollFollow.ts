import { useEffect, type RefObject } from "react";

import type { ScrollBoxRenderable } from "@opentui/core";

import { scrollTopForRowAt } from "~/ui/lib/listScroll";

/**
 * Keep the selected card of a variable-height list inside its scrollbox.
 *
 * `useRowScrollFollow` multiplies an index by a row height, which a card list
 * has no single value for — a release card is as tall as the release has
 * projects, and expanding one changes it again. The caller passes the measured
 * height of every card instead, and the offsets are summed here.
 *
 * The list box must be able to overflow for any of this to bite: give the
 * scrollbox `flexBasis: 0` alongside `flexGrow`, or it sizes to its content and
 * there is nothing to scroll.
 *
 * @param list Ref to the scrollbox holding the cards.
 * @param index Selected card.
 * @param heights Terminal lines each card occupies, in display order.
 * @param layout Values that change the viewport's geometry and so need the
 *   offset recomputed.
 */
export function useCardScrollFollow(
  list: RefObject<ScrollBoxRenderable | null>,
  {
    index,
    heights,
    layout = [],
  }: {
    index: number;
    heights: readonly number[];
    layout?: readonly unknown[];
  },
): void {
  // Summed rather than passed as an array so the effect can compare scalars:
  // callers build `heights` fresh each render, and depending on its identity
  // would re-run the effect forever.
  let rowTop = 0;
  for (let i = 0; i < index && i < heights.length; i++) rowTop += heights[i] ?? 0;
  const rowHeight = heights[index] ?? 0;
  const contentHeight = heights.reduce((total, height) => total + height, 0);

  useEffect(() => {
    const box = list.current;
    if (!box || contentHeight === 0) return;
    // Zero before the first layout pass — nothing to measure against yet.
    const viewportHeight = box.viewport.height;
    if (viewportHeight <= 0) return;

    const next = scrollTopForRowAt({
      rowTop,
      rowHeight,
      contentHeight,
      viewportHeight,
      scrollTop: box.scrollTop,
    });
    if (next !== box.scrollTop) box.scrollTop = next;
    // `layout` is spread, not compared by identity — callers pass a literal
    // array, so a fresh one each render must not re-run the effect.
  }, [list, rowTop, rowHeight, contentHeight, ...layout]);
}
