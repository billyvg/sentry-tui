import { formatKey, primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { BOLD, NONE } from "~/ui/lib/attributes";

/**
 * A command's key, printed the one way the app prints keys: `(r)`.
 *
 * Shared by the status bar and by `Chip` so the two can't drift into different
 * punctuation — the parens are the app's grammar for "this is a keystroke", and
 * they only work as a signal while nothing else wears them.
 */
export function KeyHint({
  command,
  fg = theme.text,
  /** Bold, for a key sitting on a control surface where it reads as a button. */
  emphasised = false,
}: {
  command: string;
  fg?: string;
  emphasised?: boolean;
}) {
  const key = primaryKey(command);
  if (!key) return null;

  return (
    <>
      <text fg={theme.subText}>{"("}</text>
      <text fg={fg} attributes={emphasised ? BOLD : NONE}>
        {formatKey(key)}
      </text>
      <text fg={theme.subText}>{")"}</text>
    </>
  );
}
