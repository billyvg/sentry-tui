import { theme } from "~/core/theme";
import type { Hotkey } from "~/lib/hotkeys";
import { BOLD, NONE } from "~/ui/lib/attributes";

/**
 * A nav label, with its goto key printed inside it: `(i)ssues`.
 *
 * The key replaces its own character rather than sitting beside the label, so
 * the row keeps its shape and the eye can find the letter it already knows.
 * It is printed in the case it must be *typed* in — `Issues` offers `(i)`, not
 * `(I)` — because the parens are an instruction, not a spelling.
 *
 * A label with no character left to give (every one already claimed by another
 * destination) gets its key appended instead, in the same parens. Without a
 * hotkey at all, this renders exactly the plain `<text>` it replaces.
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

  return (
    <text attributes={attributes}>
      {before ? <span fg={fg}>{before}</span> : null}
      {/* Same punctuation and pink as `KeyHint`: one grammar for "press this". */}
      <span fg={theme.subText}>{"("}</span>
      <span fg={theme.hotkey}>{hotkey.key}</span>
      <span fg={theme.subText}>{")"}</span>
      {after ? <span fg={fg}>{after}</span> : null}
    </text>
  );
}
