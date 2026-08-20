import { formatKey, primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { measureTextWidth } from "~/lib/text";
import { KeyHint } from "~/ui/components/KeyHint";

/**
 * The app's one interactive control.
 *
 * A terminal has no cursor change and no hover state, so "you can act on this"
 * has to be carried by the cell itself. Brackets around a label don't do it —
 * `[all projects]` reads as punctuation, and the same brackets appear in log
 * lines and stack frames. A filled pill does: `panelAlt` is the only background
 * in the app that isn't a row highlight, so anything wearing it is something you
 * can press. The key that presses it is printed inside, which makes the
 * affordance and its shortcut the same object.
 *
 * The shape is closed with half-block caps rather than a drawn border, because
 * a border costs two extra rows per chip row and this app puts chips on two
 * different screens.
 */
export interface ChipSpec {
  /** Command id, so the printed key follows a rebind. */
  command: string;
  label: string;
  /** Marks a chip that opens a menu rather than acting immediately. */
  caret?: boolean;
}

/** Cells between two chips in a row. */
export const CHIP_GAP = 1;

/**
 * Rows a chip occupies.
 *
 * A drawn border would cost three, and a screen with two chip rows on it then
 * spends six rows on chrome. The caps below buy the same closed shape for one.
 * Callers that place something *under* a chip — the dropdown a filter chip
 * opens — need this to clear its bottom edge.
 */
export const CHIP_HEIGHT = 1;

/**
 * The pill's end caps.
 *
 * A half block painted in the fill color against the page background fills half
 * its cell, so the pill appears to begin and end mid-cell — a rounded end at no
 * vertical cost. `▐` fills the right half, opening the shape; `▌` fills the
 * left, closing it.
 */
const CAP_LEFT = "▐";
const CAP_RIGHT = "▌";
/** One cap cell at each end. */
const CHIP_CAPS = 2;

/**
 * Width of a rendered chip, for laying out a row and anchoring the overlay a
 * chip opens. Kept beside the renderer so the two cannot disagree.
 */
export function chipWidth({ command, label, caret = false }: ChipSpec): number {
  const key = formatKey(primaryKey(command));
  // "▐ (k) label ▾ ▌"
  const keyPart = key ? measureTextWidth(key) + 3 : 0;
  return CHIP_CAPS + 1 + keyPart + measureTextWidth(label) + (caret ? 2 : 0) + 1;
}

/** Left edge of each chip in a row, relative to the row's own left edge. */
export function chipOffsets(chips: readonly ChipSpec[]): number[] {
  const offsets: number[] = [];
  let left = 0;
  for (const chip of chips) {
    offsets.push(left);
    left += chipWidth(chip) + CHIP_GAP;
  }
  return offsets;
}

export function Chip({
  command,
  label,
  caret = false,
  active = false,
  onPress,
}: ChipSpec & {
  /** The chip's menu is open, or its state is the one currently applied. */
  active?: boolean;
  onPress?: () => void;
}) {
  const key = formatKey(primaryKey(command));
  // An unbound command has no key to print, but the chip is still pressable by
  // mouse — so it keeps its surface and simply loses the key group.
  const labelFg = active ? theme.accent : theme.text;

  return (
    // The caps sit outside the filled box so their empty half falls through to
    // the page background — inside it they would be painted over by the fill
    // and the pill would go back to being a rectangle.
    <box style={{ flexDirection: "row", flexShrink: 0 }} onMouseDown={onPress}>
      <text fg={theme.panelAlt}>{CAP_LEFT}</text>
      <box style={{ flexDirection: "row", backgroundColor: theme.panelAlt }}>
        <text> </text>
        {key ? (
          <>
            <KeyHint command={command} emphasised />
            <text> </text>
          </>
        ) : null}
        <text fg={labelFg}>{label}</text>
        {caret ? <text fg={active ? theme.accent : theme.muted}>{" ▾"}</text> : null}
        <text> </text>
      </box>
      <text fg={theme.panelAlt}>{CAP_RIGHT}</text>
    </box>
  );
}

/** A left-to-right run of chips, evenly gapped. */
export function ChipRow({
  chips,
  activeIndex,
  onPress,
}: {
  chips: readonly ChipSpec[];
  /** Index of the chip that is open or applied, if any. */
  activeIndex?: number;
  onPress?: (chip: ChipSpec, index: number) => void;
}) {
  return (
    <box style={{ flexDirection: "row", flexShrink: 0 }}>
      {chips.map((chip, i) => (
        <box key={chip.command} style={{ flexDirection: "row" }}>
          {i > 0 ? <text>{" ".repeat(CHIP_GAP)}</text> : null}
          <Chip {...chip} active={i === activeIndex} onPress={() => onPress?.(chip, i)} />
        </box>
      ))}
    </box>
  );
}
