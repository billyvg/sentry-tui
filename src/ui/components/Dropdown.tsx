import { useCallback, useEffect, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { matchesCommand } from "~/core/commands";
import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";
import { PlatformIcon, usePlatformIconWidth } from "~/ui/components/PlatformIcon";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";
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

/**
 * A single-column dropdown list anchored at a given terminal position.
 *
 * Consumes nav keys while open so the parent list doesn't scroll. Selecting an
 * item calls `onSelect` with the new value and closes the dropdown. Escape or
 * clicking outside closes without changing the selection.
 */
export function Dropdown({
  title,
  items,
  selected,
  anchorLeft,
  anchorTop,
  showAll = true,
  placeholder,
  onSelect,
  onClose,
}: DropdownProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const platformIconWidth = usePlatformIconWidth();

  // Build the full option list: "All" + items.
  const allItems: DropdownItem[] = showAll
    ? [{ label: "All", value: "__all__" }, ...items]
    : [...items];

  // Find the cursor start: the first selected item, or "All".
  const initialIndex = (() => {
    if (selected.length === 0) return 0; // "All"
    const idx = allItems.findIndex((item) => item.value === selected[0]);
    return idx >= 0 ? idx : 0;
  })();

  const [cursor, setCursor] = useState(initialIndex);

  // Reset cursor when items change (e.g. async load).
  useEffect(() => {
    setCursor(initialIndex);
  }, [initialIndex]);

  const handleSelect = useCallback(
    (index: number) => {
      const item = allItems[index];
      if (!item) return;
      if (item.value === "__all__") {
        onSelect([]);
      } else {
        onSelect([item.value]);
      }
      onClose();
    },
    [allItems, onSelect, onClose],
  );

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        () => {
          if (matchesCommand("sentry.nav.back", key)) {
            onClose();
            return "mine";
          }
          if (matchesCommand("sentry.nav.open", key)) {
            handleSelect(cursor);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setCursor((c) => Math.min(c + 1, allItems.length - 1));
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
            setCursor(allItems.length - 1);
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

  // With nothing selectable, the list collapses to the placeholder row — the
  // dropdown still has to occupy a row so it can say why it is empty.
  const placeholderRow = allItems.length === 0 ? placeholder : undefined;
  const rowCount = placeholderRow ? 1 : allItems.length;

  // Geometry: the dropdown drops below the anchor, clamped to the terminal.
  // Each row is border + dot + icon + label + border.
  const rowChrome = PREFIX_WIDTH + iconSlot + 2;
  const maxLabelWidth = Math.max(
    MIN_WIDTH,
    ...allItems.map((i) => i.label.length + rowChrome),
    placeholderRow ? placeholderRow.length + rowChrome : 0,
  );
  const dropdownWidth = Math.min(maxLabelWidth, termWidth - 2);
  const visibleRows = Math.min(rowCount, MAX_VISIBLE, termHeight - anchorTop - 3);
  const dropdownHeight = visibleRows + 2; // +2 for border
  const windowStart = listWindowStart(cursor, allItems.length, visibleRows);

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
        {placeholderRow ? (
          <text fg={theme.muted}>{` ${fitText(placeholderRow, dropdownWidth - 3)}`}</text>
        ) : null}

        {allItems.slice(windowStart, windowStart + visibleRows).map((item, i) => {
          const realIndex = windowStart + i;
          const isCursor = realIndex === cursor;
          const isActive =
            item.value === "__all__" ? selected.length === 0 : selected.includes(item.value);

          const fg = isCursor ? theme.text : isActive ? theme.accent : theme.muted;
          const label = fitText(item.label, dropdownWidth - 2 - iconSlot - PREFIX_WIDTH);

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
              <text fg={fg}>{label}</text>
            </box>
          );
        })}
      </box>
    </>
  );
}
