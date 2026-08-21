/**
 * The header bar over every pushed view: where you are, and the way out.
 *
 * A detail view is the only place in the app with no visible exit — the nav
 * rail still points at the screen underneath, so the pane reads as a screen
 * that has stopped answering rather than as somewhere you have descended to.
 * The trail answers "how deep am I?" and the control on the right answers "and
 * how do I leave?", drawn once here rather than by each of the five views that
 * would otherwise each invent their own.
 *
 * A row rather than the pane's border title, which the renderer draws as one
 * flat string in one color: the key has to wear the app's pink, and the two
 * halves have to sit at opposite ends of the same line.
 */

import { formatKey, primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { breadcrumbTrail } from "~/lib/breadcrumb";
import { fitText, measureTextWidth } from "~/lib/text";
import { KeyHint } from "~/ui/components/KeyHint";

/** Rows this component occupies. Callers subtract it from the pane's height. */
export const BREADCRUMB_BAR_HEIGHT = 1;

/** One cell of padding at each end of the bar. */
const BAR_PADDING = 2;

/** Blank cells kept between the trail and the control, so they never touch. */
const MIN_GAP = 2;

/**
 * Cells the trail will not go below before the control starts giving up its
 * own. Past this the trail is down to a truncated leaf, and shrinking it
 * further costs the one thing on the bar that says *which* view this is.
 */
const MIN_TRAIL_WIDTH = 12;

/** Cells `KeyHint` draws: the chord plus the parentheses around it. */
function keyHintWidth(command: string): number {
  const key = primaryKey(command);
  return key ? measureTextWidth(formatKey(key)) + 2 : 0;
}

export function BreadcrumbBar({
  /** Root to leaf: the nav group, its item, then every view on the stack. */
  segments,
  /** Where Escape lands — the view beneath, or the screen the stack sits on. */
  parent,
  width,
}: {
  segments: readonly (string | undefined)[];
  parent: string;
  width: number;
}) {
  const inner = Math.max(0, width - BAR_PADDING);
  const keyWidth = keyHintWidth("sentry.nav.back");

  // The control keeps its destination while the trail can still say something;
  // on a pane too narrow for both it falls back to a bare "back", which the
  // trail beside it already gives a destination to.
  const full = `back to ${parent} `;
  const named = inner - measureTextWidth(full) - keyWidth - MIN_GAP >= MIN_TRAIL_WIDTH;
  const label = named ? full : "back ";

  const trailWidth = Math.max(0, inner - measureTextWidth(label) - keyWidth - MIN_GAP);

  return (
    <box
      style={{
        flexDirection: "row",
        width,
        height: BREADCRUMB_BAR_HEIGHT,
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={theme.accent}>{breadcrumbTrail(segments, trailWidth)}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.muted}>{fitText(label, inner)}</text>
      <KeyHint command="sentry.nav.back" />
    </box>
  );
}
