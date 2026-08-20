import { formatKey, primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { BOLD, NONE } from "~/ui/lib/attributes";

/**
 * A command's key, printed the one way the app prints keys: `(r)`.
 *
 * Shared by the status bar and by `Chip` so the two can't drift into different
 * punctuation — the parens are the app's grammar for "this is a keystroke", and
 * they only work as a signal while nothing else wears them.
 *
 * The key itself is always pink, never the color of whatever it labels. A key
 * that inherited its surroundings would be readable but not *findable*: the
 * point of the hint is that you can sweep the screen for the thing to press
 * without reading any of the words, and that only works while one color means
 * "keystroke" and nothing else uses it for prose.
 */
export function KeyHint({
  command,
  /** Bold, for a key sitting on a control surface where it reads as a button. */
  emphasised = false,
}: {
  command: string;
  emphasised?: boolean;
}) {
  const key = primaryKey(command);
  if (!key) return null;

  return (
    <>
      <text fg={theme.subText}>{"("}</text>
      <text fg={theme.hotkey} attributes={emphasised ? BOLD : NONE}>
        {formatKey(key)}
      </text>
      <text fg={theme.subText}>{")"}</text>
    </>
  );
}
