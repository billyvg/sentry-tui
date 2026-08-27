import { formatKey, primaryKey } from "~/core/commands";
import { useTheme } from "~/ui/theme";
import { measureTextWidth } from "~/lib/text";
import { KeyHint } from "~/ui/components/KeyHint";

/**
 * The app's one interactive control.
 *
 * A terminal has no cursor change and no hover state, so "you can act on this"
 * has to be carried by the cell itself. Brackets around a label don't do it —
 * `[all projects]` reads as punctuation, and the same brackets appear in log
 * lines and stack frames. A filled pill does: `theme.chip.surface` is the only
 * background in the app that isn't a panel or a row highlight, so anything
 * wearing it is something you can press. The key that presses it is printed
 * inside, which makes the affordance and its shortcut the same object.
 *
 * The fill alone reads as a highlighted word, though, so the pill is framed:
 * a lighter rim on the top edge and both caps, a dimmer one underneath. Same
 * light source as everything else — from above — which is what makes the
 * shape read as a surface standing off the page rather than as a colored run
 * of text.
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
 * Three, but only one of them is a full row of ink: the outer two carry a
 * one-eighth block each (see `CHIP_EDGE_*`), so the pill stands a sliver
 * taller than its text without spending a line of padding on either side.
 * Those two rows read as the blank gap a chip row wanted anyway, which is why
 * both call sites drop their own margin rather than adding to this.
 *
 * A drawn border would cost the same three rows and look like a table cell.
 * Callers that place something *under* a chip — the dropdown a filter chip
 * opens — need this to clear its bottom edge.
 */
export const CHIP_HEIGHT = 3;

/**
 * The pill's end caps.
 *
 * A half block painted against the page background fills half its cell, so the
 * pill appears to begin and end mid-cell — a rounded end at no vertical cost.
 * `▐` fills the right half, opening the shape; `▌` fills the left, closing it.
 *
 * They wear the rim rather than the fill, which is what turns the caps from a
 * seam into the frame's two sides.
 */
const CAP_LEFT = "▐";
const CAP_RIGHT = "▌";
/** One cap cell at each end. */
const CHIP_CAPS = 2;

/**
 * The pill's top and bottom edges.
 *
 * The ask a filled label eventually makes is for a little height — the text
 * sits tight against the fill, top and bottom, and reads as a highlight rather
 * than as something with a surface. A row of padding is the obvious answer and
 * the wrong one: it triples the chip and makes it a button in a form.
 *
 * A cell is the smallest thing a terminal can paint, but it is not the
 * smallest thing it can paint *in*. `▁` inks the bottom eighth of its cell and
 * `▔` the top eighth, so a row of `▁` above the pill and a row of `▔` below it
 * extend the pill by a couple of pixels at each end — the padding, without the
 * line. Both rows are otherwise empty, so they double as the chip row's
 * breathing room.
 *
 * They carry the rim colors, not the fill: at a sliver of a cell the top edge
 * is too small to read as anything but a highlight, and painting it in the
 * fill would waste the one place the frame's light lands.
 */
const CHIP_EDGE_TOP = "▁";
const CHIP_EDGE_BOTTOM = "▔";

/**
 * Width of a rendered chip, for laying out a row and anchoring the overlay a
 * chip opens. Kept beside the renderer so the two cannot disagree.
 */
export function chipWidth({ command, label, caret = false }: ChipSpec): number {
  const key = formatKey(primaryKey(command));
  // "▐ k label ▾ ▌"
  const keyPart = key ? measureTextWidth(key) + 1 : 0;
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
  const theme = useTheme();
  const key = formatKey(primaryKey(command));
  // An unbound command has no key to print, but the chip is still pressable by
  // mouse — so it keeps its surface and simply loses the key group.
  const labelFg = active ? theme.accent : theme.text;

  // The edges span the filled box only, not the caps: a cap is half a cell of
  // ink, and running the sliver out to meet it would square off the very
  // corners the caps are there to round.
  const edgeWidth = chipWidth({ command, label, caret }) - CHIP_CAPS;

  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }} onMouseDown={onPress}>
      <ChipEdge glyph={CHIP_EDGE_TOP} width={edgeWidth} color={theme.chip.rim} />
      {/*
       * The caps sit outside the filled box so their empty half falls through
       * to the page background — inside it they would be painted over by the
       * fill and the pill would go back to being a rectangle.
       */}
      <box style={{ flexDirection: "row" }}>
        <text fg={theme.chip.rim}>{CAP_LEFT}</text>
        <box style={{ flexDirection: "row", backgroundColor: theme.chip.surface }}>
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
        <text fg={theme.chip.rim}>{CAP_RIGHT}</text>
      </box>
      <ChipEdge glyph={CHIP_EDGE_BOTTOM} width={edgeWidth} color={theme.chip.rimShadow} />
    </box>
  );
}

/** One sliver row of rim, inset by a cap cell at each end. */
function ChipEdge({ glyph, width, color }: { glyph: string; width: number; color: string }) {
  return <text fg={color}>{` ${glyph.repeat(Math.max(0, width))} `}</text>;
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
