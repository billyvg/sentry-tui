import { CHIP_HEIGHT, chipWidth } from "~/ui/components/Chip";
import {
  SORT_COMMAND,
  SortDropdown,
  SortSelector,
  sortLabel,
  type SortItem,
} from "~/ui/components/SortSelector";

export interface SortBarProps {
  value: string;
  items: readonly SortItem[];
  open: boolean;
  width: number;
  /** Row where the chip starts, relative to the screen. */
  anchorTop: number;
  onChange: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

/** A right-aligned sort chip for lists without a filter bar. */
export function SortBar({
  value,
  items,
  open,
  width,
  anchorTop,
  onChange,
  onOpen,
  onClose,
}: SortBarProps) {
  const anchorLeft = Math.max(
    0,
    width - chipWidth({ command: SORT_COMMAND, label: sortLabel(items, value), caret: true }),
  );

  return (
    <>
      <box
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          width,
          height: CHIP_HEIGHT,
          overflow: "hidden",
        }}
      >
        <box style={{ flexGrow: 1 }} />
        <SortSelector value={value} items={items} open={open} onOpen={onOpen} />
      </box>
      {open ? (
        <SortDropdown
          value={value}
          items={items}
          anchorLeft={anchorLeft}
          anchorTop={anchorTop + CHIP_HEIGHT}
          availableWidth={width}
          onChange={onChange}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}
