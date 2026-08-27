/**
 * Fuzzy filtering for the picker lists — the dropdowns' equivalent of the
 * command palette's query.
 *
 * The palette scores its own catalog because it matches over keywords and
 * sections a dropdown row does not have; what both share is "rank labels
 * against a query and remember which characters matched", which is what lives
 * here.
 */

import { fuzzyMatch } from "~/lib/fuzzy";

/** The one field a row has to expose to be filterable. */
export interface LabeledItem {
  label: string;
}

export interface FilteredItem<T> {
  item: T;
  /** Indices into `item.label` that matched, for highlighting. */
  positions: readonly number[];
}

/**
 * Rank `items` against `query`, dropping the ones that don't match.
 *
 * An empty query keeps every item in its original order, so an unfiltered
 * list is the same code path as a filtered one.
 */
export function filterByLabel<T extends LabeledItem>(
  items: readonly T[],
  query: string,
): FilteredItem<T>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.map((item) => ({ item, positions: [] }));

  const scored: Array<FilteredItem<T> & { score: number }> = [];
  for (const item of items) {
    const match = fuzzyMatch(item.label, needle);
    if (!match) continue;
    scored.push({ item, positions: match.positions, score: match.score });
  }

  // Sort is stable in every engine this runs on, so equally-scored rows keep
  // the order the API returned them in rather than shuffling as you type.
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ item, positions }) => ({ item, positions }));
}

/**
 * Mark where `query` hit each label, keeping every item and its order.
 *
 * For a list somebody else has already narrowed — a picker whose rows came
 * back from a server search. The rows are all matches by definition, so
 * dropping the ones this fuzzy pass disagrees with would throw away the very
 * results the search went out for; a row the server matched on a field the
 * label doesn't show simply highlights nothing.
 */
export function highlightByLabel<T extends LabeledItem>(
  items: readonly T[],
  query: string,
): FilteredItem<T>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.map((item) => ({ item, positions: [] }));

  return items.map((item) => ({
    item,
    positions: fuzzyMatch(item.label, needle)?.positions ?? [],
  }));
}
