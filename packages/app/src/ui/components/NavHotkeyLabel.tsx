import { useTheme } from "~/ui/theme";
import type { Hotkey } from "~/lib/hotkeys";
import { BOLD, NONE, UNDERLINE } from "~/ui/lib/attributes";

/**
 * A nav label, with its goto key underlined inside it: `issues` with the `i`
 * underlined and pink.
 *
 * The key replaces its own character rather than sitting beside the label, so
 * the row keeps its shape and the eye can find the letter it already knows.
 * It is printed in the case it must be *typed* in — `Issues` offers `i`, not
 * `I` — because upper and lower case are separate bindings elsewhere in this
 * app (see the filter chips' shift-chords), and showing the label's own
 * capital would misrepresent which physical key lands on this destination.
 * Pink plus the underline is what marks the substitution as a keystroke
 * rather than a typo.
 *
 * A label with no character left to give (every one already claimed by another
 * destination) gets its key appended instead, same styling. Without a hotkey
 * at all, this renders exactly the plain `<text>` it replaces.
 */
export function NavHotkeyLabel({
  label,
  hotkey,
  fg,
  bold = false,
}: {
  label: string;
  /** Absent outside goto mode, when the label is just a label. */
  hotkey?: Hotkey;
  fg: string;
  bold?: boolean;
}) {
  const theme = useTheme();
  const attributes = bold ? BOLD : NONE;

  if (!hotkey) {
    return (
      <text fg={fg} attributes={attributes}>
        {label}
      </text>
    );
  }

  const chars = [...label];
  const inline = hotkey.index >= 0;
  const before = inline ? chars.slice(0, hotkey.index).join("") : `${label} `;
  const after = inline ? chars.slice(hotkey.index + 1).join("") : "";
  const keyAttributes = bold ? BOLD | UNDERLINE : UNDERLINE;

  return (
    <text attributes={attributes}>
      {before ? <span fg={fg}>{before}</span> : null}
      <span fg={theme.hotkey} attributes={keyAttributes}>
        {hotkey.key}
      </span>
      {after ? <span fg={fg}>{after}</span> : null}
    </text>
  );
}
