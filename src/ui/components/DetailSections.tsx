/**
 * The chrome a detail view is made of: numbered foldable sections, key/value
 * rows, and the fold keys that drive them.
 *
 * Grown out of `IssueDetail`, which had all of it inline and was the only
 * detail view in the app. A monitor's detail is the second, and it is the same
 * object — a stack of sections over a scrollbox, each one foldable by the
 * digit printed in its own header — so this is that object, extracted rather
 * than reimplemented. Anything that reads as issue-specific (the level bar,
 * the triage chips, the stack trace) stays in `IssueDetail`.
 *
 * The numbering is the discoverability mechanism: `sentry.view.toggleSection`
 * binds the digits 1-6 and each header prints its own, so nothing has to be
 * memorised. `z` folds everything at once.
 */

import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { useKeyboard } from "@opentui/react";

import { matchesCommand } from "~/core/commands";
import { useTheme } from "~/ui/theme";
import { fitText, measureTextWidth, padText } from "~/lib/text";
import { BOLD } from "~/ui/lib/attributes";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";

/**
 * Where every section body starts, empty states included.
 *
 * A view that indents some bodies and not others leaves the fold markers as
 * the only thing holding the page together — and they sit in the same column
 * as half the content.
 */
export const BODY_INDENT = "  ";

/** Key column in the two-column bodies (tags, contexts, a monitor's config). */
export const KEY_COLUMN = 18;

/** The ` · ` that separates metadata items, dimmer than what it separates. */
export function Divider() {
  const theme = useTheme();
  return <text fg={theme.subText}>{" · "}</text>;
}

/** An indented "there is nothing here" line, in the one place that decides how. */
export function Empty({ children }: { children: string }) {
  const theme = useTheme();
  return <text fg={theme.subText}>{`${BODY_INDENT}${children}`}</text>;
}

/**
 * A key padded into its column, always leaving a gutter before the value.
 *
 * Padding a key that already fills the column produces `Sec-WebSocket-Ver…13`,
 * where the ellipsis and the value collide and the row stops parsing as two
 * fields — so the key is fitted one cell short of the column it pads into.
 */
export function keyCell(name: string): string {
  return padText(fitText(name, KEY_COLUMN - 1), KEY_COLUMN);
}

/**
 * An indented `key   value` row.
 *
 * Splitting the color is what makes a block of sixteen fields scannable: the
 * eye follows the bright column and treats the dim one as a ruler.
 */
export function Field({ name, value, width }: { name: string; value: string; width: number }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: "row", width }}>
      <text fg={theme.muted}>{`${BODY_INDENT}${keyCell(name)}`}</text>
      <text fg={theme.text}>
        {fitText(value, Math.max(0, width - KEY_COLUMN - BODY_INDENT.length))}
      </text>
    </box>
  );
}

export function Section({
  index,
  title,
  count,
  collapsed,
  width,
  onToggle,
  children,
}: {
  /** The digit that folds this section, printed so the binding is discoverable. */
  index: number;
  title: string;
  /** A total, or an honest qualified count such as `20 of 47` or `20+`. */
  count?: number | string;
  collapsed: boolean;
  width: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const label = count === undefined ? title : `${title} (${count})`;
  const prefix = `${collapsed ? "▸" : "▾"} ${index} `;
  // The rule runs the header out to the full width, which is what separates one
  // section from the next now that the bodies share an indent.
  const rule = Math.max(0, width - measureTextWidth(prefix) - measureTextWidth(label) - 1);

  return (
    <box style={{ flexDirection: "column", width, paddingTop: 1 }}>
      <box style={{ flexDirection: "row", width }} onMouseDown={onToggle}>
        <text fg={theme.accent}>{prefix}</text>
        <text fg={theme.text} attributes={BOLD}>
          {label}
        </text>
        <text fg={theme.border}>{` ${"─".repeat(rule)}`}</text>
      </box>
      {collapsed ? null : children}
    </box>
  );
}

export interface SectionFolds<K extends string> {
  /** Sections currently folded shut. */
  collapsed: ReadonlySet<K>;
  /** Fold or unfold one section — wire to a header's `onToggle`. */
  toggle: (key: K) => void;
}

/**
 * Fold state for a detail view's sections, and the keys that drive it.
 *
 * The scrollbox owns `j`/`k` and the page keys in a detail view, so folding is
 * bound to the digits printed in each section header rather than to a cursor
 * of its own. `order` is what maps digit *n* to a section, so it must be the
 * same order the sections are drawn in.
 *
 * @param order The sections, in the order their headers appear.
 * @param focused Whether the pane holds the keyboard. An unfocused view must
 *   not answer a digit the nav rail is using.
 */
export function useSectionFolds<K extends string>(
  order: readonly K[],
  focused: boolean,
): SectionFolds<K> {
  const [collapsed, setCollapsed] = useState<ReadonlySet<K>>(() => new Set());

  const toggle = useCallback((key: K) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Folds everything unless everything is already folded. Keying off "any
  // section is open" instead would make the same keystroke expand or collapse
  // depending on state the user can't see all of at once.
  const toggleAll = useCallback(() => {
    setCollapsed((current) => (current.size === order.length ? new Set() : new Set(order)));
  }, [order]);

  useKeyboard((key) => {
    if (!focused) return;
    routeKeyOwnership(
      [
        () => {
          if (matchesCommand("sentry.view.toggleAllSections", key)) {
            toggleAll();
            return "mine";
          }
          if (matchesCommand("sentry.view.toggleSection", key)) {
            const target = order[Number(key.name) - 1];
            if (!target) return "notMine";
            toggle(target);
            return "mine";
          }
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  return { collapsed, toggle };
}
