import { useEffect, type RefObject } from "react";

import type { ScrollBoxRenderable } from "@opentui/core";

import { scrollTopForRow, scrollTopForRowAt } from "~/ui/lib/listScroll";

/**
 * Keep the selected row of a fixed- or variable-height list inside its
 * scrollbox.
 *
 * Cursor keys are claimed by the App's key router, so the scrollbox never sees
 * them and would leave the selection off screen. This pulls the offset along
 * by the minimum needed — a row already visible doesn't move the viewport.
 *
 * The list box must be able to overflow for any of this to bite: give the
 * scrollbox `flexBasis: 0` alongside `flexGrow`, or it sizes to its content
 * and there is nothing to scroll.
 *
 * @param list Ref to the scrollbox holding the rows.
 * @param index Selected row.
 * @param rowCount Rows in the list.
 * @param rowHeight Terminal lines per row, separators included. Pass one
 *   number for a uniform list, or the height of every row in display order.
 * @param layout Values that change the viewport's geometry (pane height, a
 *   detail panel opening) and so need the offset recomputed.
 */
export function useRowScrollFollow(
  list: RefObject<ScrollBoxRenderable | null>,
  {
    index,
    rowCount,
    rowHeight,
    layout = [],
  }: {
    index: number;
    rowCount: number;
    rowHeight: number | readonly number[];
    layout?: readonly unknown[];
  },
): void {
  let rowTop: number | undefined;
  let selectedHeight: number;
  let contentHeight: number;

  if (typeof rowHeight === "number") {
    selectedHeight = rowHeight;
    contentHeight = rowCount * rowHeight;
  } else {
    rowTop = 0;
    for (let i = 0; i < index && i < rowHeight.length; i++) rowTop += rowHeight[i] ?? 0;
    selectedHeight = rowHeight[index] ?? 0;
    contentHeight = rowHeight.reduce((total, height) => total + height, 0);
  }

  useEffect(() => {
    const box = list.current;
    if (!box || rowCount === 0) return;
    // Zero before the first layout pass — nothing to measure against yet.
    const viewportHeight = box.viewport.height;
    if (viewportHeight <= 0) return;

    const next =
      rowTop === undefined
        ? scrollTopForRow({
            index,
            rowCount,
            rowHeight: selectedHeight,
            viewportHeight,
            scrollTop: box.scrollTop,
          })
        : scrollTopForRowAt({
            rowTop,
            rowHeight: selectedHeight,
            contentHeight,
            viewportHeight,
            scrollTop: box.scrollTop,
          });
    if (next !== box.scrollTop) box.scrollTop = next;
    // `layout` is spread, not compared by identity — callers pass a literal
    // array, so a fresh one each render must not re-run the effect.
  }, [list, index, rowCount, rowTop, selectedHeight, contentHeight, ...layout]);
}
