/**
 * Scroll offset that keeps a fixed-height row inside a scrollbox viewport.
 *
 * Cursor keys move the selection, not the scrollbox, so the viewport has to be
 * pulled along by hand. The move is minimal — a row already on screen leaves
 * the offset untouched, so paging up and down doesn't re-center the list under
 * the cursor.
 *
 * @param index Selected row.
 * @param rowCount Rows in the list, used to clamp against the content height.
 * @param rowHeight Terminal lines per row, separators included.
 * @param viewportHeight Visible lines inside the scrollbox.
 * @param scrollTop Current offset.
 * @returns The offset to apply; equal to `scrollTop` when nothing must move.
 */
export function scrollTopForRow({
  index,
  rowCount,
  rowHeight,
  viewportHeight,
  scrollTop,
}: {
  index: number;
  rowCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
}): number {
  const maxScrollTop = Math.max(0, rowCount * rowHeight - viewportHeight);
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;

  // A row taller than the viewport can't fit either way; align its top so the
  // first line — the one carrying the cursor — is the line that stays visible.
  const next =
    rowTop < scrollTop || rowHeight > viewportHeight
      ? rowTop
      : rowBottom > scrollTop + viewportHeight
        ? rowBottom - viewportHeight
        : scrollTop;

  return Math.min(Math.max(next, 0), maxScrollTop);
}
