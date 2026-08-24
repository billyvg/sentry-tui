import { useEffect } from "react";

import { Chip } from "~/ui/components/Chip";
import { Dropdown, type DropdownItem } from "~/ui/components/Dropdown";

/** One server-supported order a screen can offer. */
export type SortItem = DropdownItem;

/** The command shared by every screen-specific sort selector. */
export const SORT_COMMAND = "sentry.view.sort";

let mountedSortSelectors = 0;

/** Is a sort chip on screen to answer the global sort hotkey? */
export function isSortSelectorMounted(): boolean {
  return mountedSortSelectors > 0;
}

/** Label for a sort value, falling back to the wire spelling if necessary. */
export function sortLabel(items: readonly SortItem[], value: string): string {
  return items.find((item) => item.value === value)?.label ?? value;
}

/** Descending and ascending choices for each field a tabular query returns. */
export function fieldSortItems(fields: readonly string[]): SortItem[] {
  return fields.flatMap((field) => [
    { value: `-${field}`, label: `${field} (desc)` },
    { value: field, label: `${field} (asc)` },
  ]);
}

export interface SortSelectorProps {
  value: string;
  items: readonly SortItem[];
  open: boolean;
  onOpen: () => void;
}

/**
 * The common sort chip and its single-select dropdown.
 *
 * Screens own the values because their endpoints do. This component owns the
 * affordance and registers its presence so the app-wide `S` route never opens
 * an orphaned dropdown on a screen with no alternative ordering.
 */
export function SortSelector({ value, items, open, onOpen }: SortSelectorProps) {
  useEffect(() => {
    mountedSortSelectors += 1;
    return () => {
      mountedSortSelectors -= 1;
    };
  }, []);

  return (
    <Chip
      command={SORT_COMMAND}
      label={sortLabel(items, value)}
      caret
      active={open}
      onPress={onOpen}
    />
  );
}

/** The overlay half of a sort selector, rendered outside clipped chip rows. */
export function SortDropdown({
  value,
  items,
  anchorLeft,
  anchorTop,
  onChange,
  onClose,
}: {
  value: string;
  items: readonly SortItem[];
  anchorLeft: number;
  anchorTop: number;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Dropdown
      title="Sort By"
      items={items}
      selected={[value]}
      anchorLeft={anchorLeft}
      anchorTop={anchorTop}
      showAll={false}
      onSelect={(values) => {
        const selected = values[0];
        if (selected) onChange(selected);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
