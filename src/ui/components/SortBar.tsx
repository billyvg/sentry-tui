import { CHIP_GAP, CHIP_HEIGHT, chipWidth } from "~/ui/components/Chip";
import {
  SORT_COMMAND,
  SortDropdown,
  SortSelector,
  sortLabel,
  type SortItem,
} from "~/ui/components/SortSelector";
import { measureTextWidth } from "~/lib/text";
import { useTheme } from "~/ui/theme";

export interface SortBarProps {
  value: string;
  items: readonly SortItem[];
  summaryLabel: string;
  open: boolean;
  width: number;
  /** Row where the chip starts, relative to the screen. */
  anchorTop: number;
  onChange: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

/** A sort chip and right-aligned row count for lists without a filter bar. */
export function SortBar({
  value,
  items,
  summaryLabel,
  open,
  width,
  anchorTop,
  onChange,
  onOpen,
  onClose,
}: SortBarProps) {
  const theme = useTheme();
  const label = sortLabel(items, value);
  const controlWidth = chipWidth({ command: SORT_COMMAND, label, caret: true });
  const showSummary =
    summaryLabel.length > 0 && width >= controlWidth + CHIP_GAP + measureTextWidth(summaryLabel);

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
        <SortSelector value={value} items={items} open={open} onOpen={onOpen} />
        <box style={{ flexGrow: 1 }} />
        {showSummary ? <text fg={theme.subText}>{summaryLabel}</text> : null}
      </box>
      {open ? (
        <SortDropdown
          value={value}
          items={items}
          anchorLeft={0}
          anchorTop={anchorTop + CHIP_HEIGHT}
          onChange={onChange}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}
