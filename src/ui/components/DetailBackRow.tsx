/**
 * The one-row exit sign above every pushed view.
 *
 * A detail view is the only place in the app with no visible way out — the nav
 * rail still points at the screen underneath, so the pane reads as a screen
 * that has stopped answering rather than as somewhere you have descended to.
 * This is that missing control, drawn once here rather than by each of the five
 * views that would otherwise each invent their own.
 *
 * The key wears the app's parentheses and the app's pink, from `KeyHint` — the
 * reason this is a row and not part of the pane's border title, which the
 * renderer draws as a single string in a single color.
 */

import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";
import { KeyHint } from "~/ui/components/KeyHint";

/** Rows this component occupies. Callers subtract it from the pane's height. */
export const DETAIL_BACK_ROW_HEIGHT = 1;

/** Cells the key hint and its surrounding punctuation take before the label. */
const LABEL_INDENT = 12;

export function DetailBackRow({
  /** Where Escape lands — the parent view's name, or the screen's nav item. */
  parent,
  width,
}: {
  parent: string;
  width: number;
}) {
  return (
    <box
      style={{
        flexDirection: "row",
        width,
        height: DETAIL_BACK_ROW_HEIGHT,
        flexShrink: 0,
        paddingLeft: 1,
      }}
    >
      <KeyHint command="sentry.nav.back" />
      <text fg={theme.muted}>
        {fitText(` ‹ back to ${parent}`, Math.max(0, width - LABEL_INDENT))}
      </text>
    </box>
  );
}
