import { getNavGroup, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";
import type { Hotkey } from "~/lib/hotkeys";
import { fitText, measureTextWidth } from "~/lib/text";
import { NavHotkeyLabel } from "~/ui/components/NavHotkeyLabel";
import { DIM } from "~/ui/lib/attributes";
import {
  navSectionsFor,
  NO_NAV_EXTRAS,
  type NavItemSpec,
  type SecondaryNavExtras,
} from "~/ui/lib/navSections";

export const SECONDARY_NAV_WIDTH = 22;

/** Usable content width: total minus borders (left+right) and horizontal padding. */
const CONTENT_WIDTH = SECONDARY_NAV_WIDTH - 4;

/** Sentry's 190px secondary sidebar: section header + grouped links. */
export function SecondaryNav({
  group,
  activeItem,
  focused,
  extras = NO_NAV_EXTRAS,
  hotkeys,
  onSelect,
}: {
  group: NavGroupId;
  activeItem: string;
  focused: boolean;
  /**
   * Dynamic sections appended below the static ones, and badges by item label.
   * The starred-query and starred-dashboard sections arrive this way.
   */
  extras?: SecondaryNavExtras;
  /** Goto keys to print in the labels. Absent unless goto mode is open. */
  hotkeys?: ReadonlyMap<string, Hotkey>;
  /** Clicking an item commits it, exactly as Enter does on the cursor. */
  onSelect?: (item: NavItemSpec) => void;
}) {
  const nav = getNavGroup(group);
  const sections = navSectionsFor(group, extras);

  return (
    <box
      style={{
        width: SECONDARY_NAV_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        // Untinted, on the app background — see `NavRail`.
        border: true,
        borderColor: focused ? theme.borderFocused : theme.border,
        paddingTop: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={theme.text} attributes={1 /* BOLD */}>
        {nav.label}
      </text>
      {sections.map((section, si) => (
        <box key={si} style={{ flexDirection: "column" }}>
          {/* The rule doubles as the separator a dynamic section hangs under. */}
          <text fg={theme.border}>{"─".repeat(CONTENT_WIDTH)}</text>
          {section.title ? <text fg={theme.muted}>{section.title}</text> : null}
          {section.items.map((item) => {
            const isActive = item.label === activeItem;
            // The wrapper stretches to the pane's content width, so a click
            // anywhere on the row counts — not just on the label's glyphs.
            return (
              <box
                key={item.label}
                style={{ flexDirection: "row", height: 1 }}
                onMouseDown={() => onSelect?.(item)}
              >
                {/*
                 * Keyed by the full label — goto builds its keys from the nav's
                 * own labels, while what we print is trimmed to leave room for
                 * a badge. A dynamic item (a starred query) has no goto key and
                 * renders as the plain text this component drew before.
                 */}
                <NavHotkeyLabel
                  label={labelText(item)}
                  hotkey={hotkeys?.get(item.label)}
                  fg={isActive ? theme.accent : theme.muted}
                  bold={isActive}
                />
                {item.badge ? (
                  <text fg={theme.subText} attributes={DIM}>
                    {` ${item.badge}`}
                  </text>
                ) : null}
              </box>
            );
          })}
        </box>
      ))}
    </box>
  );
}

/**
 * The label, trimmed to leave room for its badge.
 *
 * A badge is worth less than the name it annotates, but it can't be allowed to
 * push the row past the sidebar's width either — so the label gives up the
 * cells rather than the row overflowing.
 */
function labelText(item: NavItemSpec): string {
  const badgeWidth = item.badge ? measureTextWidth(item.badge) + 1 : 0;
  return fitText(item.label, CONTENT_WIDTH - badgeWidth);
}
