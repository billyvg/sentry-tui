/**
 * The exit control for a pushed view, sitting in the pane's top border beside
 * the trail — right-aligned, where the trail is left-aligned.
 *
 * A detail view is the only place in the app with no visible way out: the nav
 * rail still points at the screen underneath, so the pane reads as a screen
 * that has stopped answering rather than as somewhere you have descended to.
 *
 * Painted over the border rather than set as a border title, which the renderer
 * draws as one flat string in one color. The key has to be pink to read as a
 * key at all — see `KeyHint` — and that needs real text nodes, which in turn
 * needs an absolutely positioned box. Being an overlay is also what keeps this
 * free: the view below it keeps the pane's full height.
 */

import { formatKey, primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { fitText, measureTextWidth } from "~/lib/text";
import { KeyHint } from "~/ui/components/KeyHint";

/**
 * Above the pane it decorates, below the dropdowns and modals that are meant
 * to cover everything (`Dropdown` opens at 50).
 */
const BORDER_OVERLAY_Z = 10;

/** A space each side, so the control doesn't butt against the border it cuts. */
const OVERLAY_PADDING = 2;

const BACK_COMMAND = "sentry.nav.back";

/** Cells `KeyHint` draws: just the chord, underlined — no other decoration. */
function keyHintWidth(command: string): number {
  const key = primaryKey(command);
  return key ? measureTextWidth(formatKey(key)) : 0;
}

/**
 * The control's label, cut to what it may take of the border.
 *
 * Half the pane at most: the trail owns the other half, and the leaf naming
 * *which* view this is matters more than the destination naming where Escape
 * goes — the trail says that too.
 */
function backLabel(parent: string, paneWidth: number): string {
  // The key's cells come off the label's budget, never out of the key itself:
  // a hint clipped to "esc)" is worse than a destination cut to an ellipsis.
  const budget = Math.floor(paneWidth / 2) - OVERLAY_PADDING - keyHintWidth(BACK_COMMAND);
  return fitText(`back to ${parent} `, Math.max(0, budget));
}

/**
 * Cells the control takes out of the pane's top border, so the trail opposite
 * can be clamped to what is left. Zero when there is no room to draw it.
 */
export function detailBackWidth(parent: string, paneWidth: number): number {
  const label = backLabel(parent, paneWidth);
  return label ? OVERLAY_PADDING + measureTextWidth(label) + keyHintWidth(BACK_COMMAND) : 0;
}

export function DetailBackRow({
  /** Where Escape lands — the view beneath, or the screen the stack sits on. */
  parent,
  /** Terminal row of the pane's top border. */
  top,
  /** Terminal column of the pane's right border, which the control stops before. */
  right,
  /** Cells the pane spans, so the control can't grow wider than its frame. */
  paneWidth,
}: {
  parent: string;
  top: number;
  right: number;
  paneWidth: number;
}) {
  const label = backLabel(parent, paneWidth);
  if (!label) return null;
  const boxWidth = detailBackWidth(parent, paneWidth);

  return (
    <box
      style={{
        position: "absolute",
        top,
        left: Math.max(0, right - boxWidth),
        width: boxWidth,
        height: 1,
        zIndex: BORDER_OVERLAY_Z,
        flexDirection: "row",
        backgroundColor: theme.bg,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={theme.muted}>{label}</text>
      <KeyHint command={BACK_COMMAND} />
    </box>
  );
}
