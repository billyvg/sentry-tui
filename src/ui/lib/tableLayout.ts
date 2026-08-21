/**
 * Column widths for a `DataTable`, resolved against the available width.
 *
 * A terminal is narrower than every container breakpoint the web defines, so
 * shedding columns is the normal case rather than the exception. One rule
 * here replaces per-screen width math in a dozen files, and keeping it pure
 * means the arithmetic can be asserted without rendering anything.
 */

/** Spec for one column of a table. `T` is the row type it reads. */
export interface ColumnSpec {
  key: string;
  /** Fixed cell width in terminal cells, or `"flex"` to take what's left. */
  width: number | "flex";
  /**
   * How hard the column fights to stay on screen: the lowest-priority column
   * is shed first, then the next, until the row fits. A column with no
   * priority is never shed — it is part of what makes the row legible.
   */
  priority?: number;
}

export interface ResolvedColumn<C extends ColumnSpec> {
  column: C;
  /** Cells this column occupies, gaps excluded. */
  width: number;
  /** Cell offset of the column's first character within the row. */
  offset: number;
}

export interface LayoutOptions {
  /** Blank cells between two columns. */
  gap?: number;
  /** Width a flex column will not shrink below before columns are shed. */
  minFlex?: number;
}

const DEFAULT_GAP = 1;
const DEFAULT_MIN_FLEX = 8;

/**
 * Resolve which columns are drawn and how wide each one is.
 *
 * The returned widths always fit: `sum(width) + gaps <= available`, so a row
 * built by concatenating cells of exactly these widths can neither overflow
 * the pane nor wrap onto a second line.
 *
 * @param columns Column specs, in display order.
 * @param available Cells the row has to spend, gaps included.
 * @returns The visible columns with their widths and offsets, in display order.
 */
export function layoutColumns<C extends ColumnSpec>(
  columns: readonly C[],
  available: number,
  { gap = DEFAULT_GAP, minFlex = DEFAULT_MIN_FLEX }: LayoutOptions = {},
): Array<ResolvedColumn<C>> {
  const width = Math.max(0, Math.floor(available));
  const visible = [...columns];

  const minWidth = (cols: readonly C[]) =>
    cols.reduce((sum, col) => sum + (col.width === "flex" ? minFlex : col.width), 0) +
    gap * Math.max(0, cols.length - 1);

  // Shed by priority: lowest first, and on a tie the rightmost — a tie means
  // the two columns are equally dispensable, and the eye reads left to right.
  while (visible.length > 0 && minWidth(visible) > width) {
    const victim = lowestPriority(visible);
    if (victim < 0) break;
    visible.splice(victim, 1);
  }

  // Still too narrow even with every optional column gone: drop unsheddable
  // columns from the right rather than paint outside the pane.
  while (visible.length > 1 && minWidth(visible) > width) visible.pop();

  if (visible.length === 0) return [];

  const gaps = gap * (visible.length - 1);
  const fixedTotal = visible.reduce((sum, col) => sum + (col.width === "flex" ? 0 : col.width), 0);
  const flexCount = visible.filter((col) => col.width === "flex").length;

  const widths = visible.map((col) => (col.width === "flex" ? 0 : col.width));

  if (flexCount > 0) {
    const slack = Math.max(0, width - gaps - fixedTotal);
    const base = Math.floor(slack / flexCount);
    // The leftover cell goes to the first flex column: a one-cell difference
    // has to land somewhere, and the leading column is the one whose content
    // is longest.
    let remainder = slack - base * flexCount;
    visible.forEach((col, i) => {
      if (col.width !== "flex") return;
      widths[i] = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    });
  }

  // Last resort for a row of fixed columns wider than the pane: take cells off
  // the right-hand columns until it fits.
  let total = widths.reduce((sum, w) => sum + w, 0) + gaps;
  for (let i = widths.length - 1; i >= 0 && total > width; i--) {
    const take = Math.min(widths[i]! - 1, total - width);
    if (take <= 0) continue;
    widths[i] = widths[i]! - take;
    total -= take;
  }

  const resolved: Array<ResolvedColumn<C>> = [];
  let offset = 0;
  visible.forEach((column, i) => {
    const w = Math.max(0, widths[i]!);
    resolved.push({ column, width: w, offset });
    offset += w + gap;
  });
  return resolved;
}

/** Index of the column shed next, or -1 when every remaining one is required. */
function lowestPriority<C extends ColumnSpec>(columns: readonly C[]): number {
  let best = -1;
  let bestPriority = Infinity;
  columns.forEach((column, i) => {
    if (column.priority === undefined) return;
    // `<=` rather than `<` so ties resolve to the rightmost column.
    if (column.priority <= bestPriority) {
      best = i;
      bestPriority = column.priority;
    }
  });
  return best;
}
