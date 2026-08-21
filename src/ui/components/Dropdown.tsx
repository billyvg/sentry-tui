import { useCallback, useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { matchesCommand } from "~/core/commands";
import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";
import { HighlightedLabel } from "~/ui/components/HighlightedLabel";
import { PlatformIcon, usePlatformIconWidth } from "~/ui/components/PlatformIcon";
import {
  consumeKey,
  isTypingSafeDown,
  isTypingSafeUp,
  routeKeyOwnership,
} from "~/ui/lib/keyRouting";
import { filterByLabel } from "~/ui/lib/listFilter";
import { listWindowStart } from "~/ui/lib/modalGeometry";

export interface DropdownItem {
  label: string;
  value: string;
  /**
   * Sentry platform string to draw an icon for. Present but nullish still
   * takes a slot (drawn as the generic icon); omitted entirely means the item
   * has none — which is how meta-options like "All" avoid claiming one.
   */
  platform?: string | null;
}

export interface DropdownProps {
  /** Title shown above the list. */
  title: string;
  items: readonly DropdownItem[];
  /** Currently active values (multi-select is "All" when empty). */
  selected: readonly string[];
  /** Position the dropdown relative to its anchor (cols from left). */
  anchorLeft: number;
  /** Position the dropdown relative to its anchor (rows from top). */
  anchorTop: number;
  /** Whether "All" is a valid meta-option at the top. */
  showAll?: boolean;
  /**
   * Give the list a filter box, focused with the search key. Worth it for a
   * list whose length is the org's doing — projects, organizations — and not
   * for a fixed handful of options, where the box costs a row and saves
   * nothing.
   */
  filterable?: boolean;
  /**
   * Cap on how wide the list may grow, for one whose labels are the org's
   * doing. A span has a few hundred attributes and the longest of them is
   * forty cells, which would otherwise set the width of every row.
   */
  maxWidth?: number;
  /**
   * Row to show in place of the list while it has nothing selectable — a
   * pending fetch, a failed one, or a genuinely empty set. Without it an
   * item-less dropdown opens as a bare box, which reads as broken rather than
   * as "still loading".
   */
  placeholder?: string;
  onSelect: (values: string[]) => void;
  onClose: () => void;
}

const DROPDOWN_Z = 50;
/** The `● `/`  ` selection dot that leads every row. */
const PREFIX_WIDTH = 2;
const MAX_VISIBLE = 12;
const MIN_WIDTH = 20;
/** Wide enough that a filter box has somewhere to put the query it takes. */
const MIN_FILTERABLE_WIDTH = 32;

/**
 * A single-column dropdown list anchored at a given terminal position.
 *
 * Consumes nav keys while open so the parent list doesn't scroll. Selecting an
 * item calls `onSelect` with the new value and closes the dropdown. Escape or
 * clicking outside closes without changing the selection.
 *
 * A `filterable` list adds a query box, which the search key focuses. It is
 * behind a key rather than focused on open because the list is navigated far
 * more often than it is searched, and a focused box would spend `j`/`k` on
 * text instead of on the cursor.
 */
/**
 * How many `Dropdown`s are mounted.
 *
 * `App` opens a dropdown by setting state, but only a mounted `Dropdown` can
 * close one — and a screen with no filter row mounts none, so the state can be
 * set with nothing on screen to clear it. The router asks this before rescuing
 * the keyboard, so a real dropdown keeps its own two-stage Escape.
 */
let mountedDropdowns = 0;

/** Is any filter dropdown actually on screen? */
export function isDropdownMounted(): boolean {
  return mountedDropdowns > 0;
}

export function Dropdown({
  title,
  items,
  selected,
  anchorLeft,
  anchorTop,
  showAll = true,
  filterable = false,
  maxWidth,
  placeholder,
  onSelect,
  onClose,
}: DropdownProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const platformIconWidth = usePlatformIconWidth();
  const [query, setQuery] = useState("");
  const [filterFocused, setFilterFocused] = useState(false);

  // Build the full option list: "All" + items.
  const allItems: DropdownItem[] = useMemo(
    () => (showAll ? [{ label: "All", value: "__all__" }, ...items] : [...items]),
    [showAll, items],
  );

  // Matched rows keep the positions the query hit, so the list can show *why*
  // each survivor is there.
  const visibleItems = useMemo(() => filterByLabel(allItems, query), [allItems, query]);

  // Find the cursor start: the first selected item, or "All".
  const initialIndex = useMemo(() => {
    if (selected.length === 0) return 0; // "All"
    const idx = allItems.findIndex((item) => item.value === selected[0]);
    return idx >= 0 ? idx : 0;
  }, [allItems, selected]);

  const [cursor, setCursor] = useState(initialIndex);

  // Reset the cursor when the rows underneath it change — an async load, or a
  // query that reranked everything so the old position means nothing.
  useEffect(() => {
    setCursor(query.trim() ? 0 : initialIndex);
  }, [initialIndex, query]);

  useEffect(() => {
    mountedDropdowns += 1;
    return () => {
      mountedDropdowns -= 1;
    };
  }, []);

  const handleSelect = useCallback(
    (index: number) => {
      const item = visibleItems[index]?.item;
      if (!item) return;
      if (item.value === "__all__") {
        onSelect([]);
      } else {
        onSelect([item.value]);
      }
      onClose();
    },
    [visibleItems, onSelect, onClose],
  );

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        () => {
          // Enter and the arrows drive the list from either side of the filter
          // box, so a match can be taken without leaving it.
          if (matchesCommand("sentry.nav.open", key)) {
            handleSelect(cursor);
            return "mine";
          }
          if (isTypingSafeDown(key)) {
            setCursor((c) => Math.min(c + 1, visibleItems.length - 1));
            return "mine";
          }
          if (isTypingSafeUp(key)) {
            setCursor((c) => Math.max(c - 1, 0));
            return "mine";
          }

          if (filterFocused) {
            // Escape backs out of the filter before it backs out of the list:
            // one key to undo the search, a second to close.
            if (matchesCommand("sentry.nav.back", key)) {
              setQuery("");
              setFilterFocused(false);
              return "mine";
            }
            // Everything else is the query being typed.
            return "focused";
          }

          if (matchesCommand("sentry.nav.back", key)) {
            onClose();
            return "mine";
          }
          if (filterable && matchesCommand("sentry.nav.search", key)) {
            setFilterFocused(true);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setCursor((c) => Math.min(c + 1, visibleItems.length - 1));
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setCursor((c) => Math.max(c - 1, 0));
            return "mine";
          }
          if (matchesCommand("sentry.nav.top", key)) {
            setCursor(0);
            return "mine";
          }
          if (matchesCommand("sentry.nav.bottom", key)) {
            setCursor(visibleItems.length - 1);
            return "mine";
          }
          // Swallow all other keys so the parent list doesn't move.
          return "mine";
        },
      ],
      key,
      consumeKey,
    );
  });

  // An icon column is reserved for the whole list as soon as one item asks for
  // one, so labels stay in a single column instead of stepping in and out.
  const iconSlot = allItems.some((item) => "platform" in item) ? platformIconWidth : 0;

  // With nothing selectable, the list collapses to a single row saying why:
  // the fetch that hasn't landed, the one that failed, or a query that matched
  // nothing.
  const placeholderRow =
    visibleItems.length > 0
      ? undefined
      : allItems.length > 0
        ? `No match for "${query.trim()}"`
        : placeholder;
  const rowCount = placeholderRow ? 1 : visibleItems.length;

  // Geometry: the dropdown drops below the anchor, clamped to the terminal.
  // Each row is border + dot + icon + label + border.
  const rowChrome = PREFIX_WIDTH + iconSlot + 2;
  const filterRows = filterable ? 1 : 0;
  const maxLabelWidth = Math.max(
    filterable ? MIN_FILTERABLE_WIDTH : MIN_WIDTH,
    ...allItems.map((i) => i.label.length + rowChrome),
    placeholderRow ? placeholderRow.length + rowChrome : 0,
  );
  const dropdownWidth = Math.min(maxLabelWidth, maxWidth ?? Infinity, termWidth - 2);
  const visibleRows = Math.max(
    1,
    Math.min(rowCount, MAX_VISIBLE, termHeight - anchorTop - 3 - filterRows),
  );
  const dropdownHeight = visibleRows + filterRows + 2; // +2 for border
  const windowStart = listWindowStart(cursor, visibleItems.length, visibleRows);

  // Clamp horizontal position so it doesn't overflow the terminal.
  const left = Math.max(0, Math.min(anchorLeft, termWidth - dropdownWidth - 1));
  const top = Math.min(anchorTop, termHeight - dropdownHeight - 1);

  return (
    <>
      {/* Scrim to catch clicks outside */}
      <box
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: termWidth,
          height: termHeight,
          zIndex: DROPDOWN_Z - 1,
        }}
        onMouseUp={onClose}
      />

      <box
        title={` ${title} `}
        style={{
          position: "absolute",
          top,
          left,
          width: dropdownWidth,
          height: dropdownHeight,
          zIndex: DROPDOWN_Z,
          border: true,
          borderColor: theme.accent,
          backgroundColor: theme.panel,
          flexDirection: "column",
        }}
        onMouseUp={(event) => event.stopPropagation()}
      >
        {filterable ? (
          <box
            style={{ flexDirection: "row", flexShrink: 0 }}
            onMouseUp={() => setFilterFocused(true)}
          >
            <text fg={theme.subText}>{"("}</text>
            <text fg={theme.hotkey}>{"/"}</text>
            <text fg={theme.subText}>{") "}</text>
            <input
              value={query}
              placeholder="filter…"
              focused={filterFocused}
              onInput={setQuery}
              style={{
                flexGrow: 1,
                textColor: theme.text,
                backgroundColor: theme.panel,
                focusedTextColor: theme.text,
                focusedBackgroundColor: theme.panel,
                placeholderColor: theme.subText,
              }}
            />
          </box>
        ) : null}

        {placeholderRow ? (
          <text fg={theme.muted}>{` ${fitText(placeholderRow, dropdownWidth - 3)}`}</text>
        ) : null}

        {visibleItems
          .slice(windowStart, windowStart + visibleRows)
          .map(({ item, positions }, i) => {
            const realIndex = windowStart + i;
            const isCursor = realIndex === cursor;
            const isActive =
              item.value === "__all__" ? selected.length === 0 : selected.includes(item.value);

            const fg = isCursor ? theme.text : isActive ? theme.accent : theme.muted;
            const labelWidth = dropdownWidth - 2 - iconSlot - PREFIX_WIDTH;

            // The selection dot leads the row, ahead of the icon, so the only gap
            // between an icon and its label is the icon's own trailing space.
            return (
              <box
                key={item.value}
                style={{
                  flexDirection: "row",
                  alignSelf: "flex-start",
                  backgroundColor: isCursor ? theme.selected : undefined,
                }}
              >
                <text fg={fg}>{isActive ? "● " : "  "}</text>
                {iconSlot > 0 ? (
                  "platform" in item ? (
                    <PlatformIcon platform={item.platform} />
                  ) : (
                    <box style={{ width: iconSlot, flexShrink: 0 }} />
                  )
                ) : null}
                <HighlightedLabel
                  text={item.label}
                  positions={positions}
                  width={labelWidth}
                  fg={fg}
                />
              </box>
            );
          })}
      </box>
    </>
  );
}
