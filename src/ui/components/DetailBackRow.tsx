/**
 * The exit control over every pushed view, hard against the pane's right edge.
 *
 * A detail view is the only place in the app with no visible way out — the nav
 * rail still points at the screen underneath, so the pane reads as a screen
 * that has stopped answering rather than as somewhere you have descended to.
 * This is that missing control, drawn once here rather than by each of the five
 * views that would otherwise each invent their own.
 *
 * It sits under the trail in the pane's border rather than beside it: the
 * renderer draws a border title as one flat string in one color, and the key
 * has to wear the app's pink to read as a key at all (see `KeyHint`).
 */

import { formatKey, primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { fitText, measureTextWidth } from "~/lib/text";
import { KeyHint } from "~/ui/components/KeyHint";

/** Rows this component occupies. Callers subtract it from the pane's height. */
export const DETAIL_BACK_ROW_HEIGHT = 1;

/** One cell of padding at each end of the row. */
const ROW_PADDING = 2;

/** Cells `KeyHint` draws: the chord plus the parentheses around it. */
function keyHintWidth(command: string): number {
  const key = primaryKey(command);
  return key ? measureTextWidth(formatKey(key)) + 2 : 0;
}

export function DetailBackRow({
  /** Where Escape lands — the view beneath, or the screen the stack sits on. */
  parent,
  width,
}: {
  parent: string;
  width: number;
}) {
  // The key's cells come off the label's budget, not out of the key: a hint
  // clipped to "esc)" is worse than a destination trimmed to an ellipsis.
  const labelWidth = Math.max(0, width - ROW_PADDING - keyHintWidth("sentry.nav.back"));

  return (
    <box
      style={{
        flexDirection: "row",
        width,
        height: DETAIL_BACK_ROW_HEIGHT,
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.muted}>{fitText(`back to ${parent} `, labelWidth)}</text>
      <KeyHint command="sentry.nav.back" />
    </box>
  );
}
