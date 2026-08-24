import { getNavGroup, type NavGroupId } from "~/core/nav";
import { useTheme } from "~/ui/theme";
import type { Hotkey } from "~/lib/hotkeys";
import { fitText } from "~/lib/text";
import { NavHotkeyLabel } from "~/ui/components/NavHotkeyLabel";
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
   * Dynamic sections appended below the static ones. The starred-query and
   * starred-dashboard sections arrive this way.
   */
  extras?: SecondaryNavExtras;
  /** Goto keys to print in the labels. Absent unless goto mode is open. */
  hotkeys?: ReadonlyMap<string, Hotkey>;
  /** Clicking an item commits it, exactly as Enter does on the cursor. */
  onSelect?: (item: NavItemSpec) => void;
}) {
  const theme = useTheme();
  const nav = getNavGroup(group);
  const sections = navSectionsFor(group, extras);

  return (
    <box
      style={{
        width: SECONDARY_NAV_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        // A dynamic section can make the list longer than the pane. Without
        // this the overflowing rows are drawn on top of the ones above them
        // rather than falling off the bottom, and the sidebar turns to soup.
        overflow: "hidden",
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
        // `flexShrink: 0` for the same reason as the clip above: a list taller
        // than the pane must run off the bottom, not compress its rows into
        // each other.
        <box key={si} style={{ flexDirection: "column", flexShrink: 0 }}>
          {/* The rule doubles as the separator a dynamic section hangs under. */}
          <text fg={theme.border}>{"─".repeat(CONTENT_WIDTH)}</text>
          {section.title ? <text fg={theme.muted}>{section.title}</text> : null}
          {section.items.map((item, ii) => {
            const isActive = item.label === activeItem;
            // The wrapper stretches to the pane's content width, so a click
            // anywhere on the row counts — not just on the label's glyphs.
            //
            // Keyed by position, not by label: a dynamic section lists things
            // the user named, and two starred queries may well share a name.
            return (
              <box
                key={`${si}:${ii}:${item.label}`}
                style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
                onMouseDown={() => onSelect?.(item)}
              >
                {/*
                 * Keyed by the full label — goto builds its keys from the nav's
                 * own labels, while what we print is trimmed to the pane's
                 * width. A dynamic item (a starred query) has no goto key and
                 * renders as plain text.
                 */}
                <NavHotkeyLabel
                  label={fitText(item.label, CONTENT_WIDTH)}
                  hotkey={hotkeys?.get(item.label)}
                  fg={isActive ? theme.accent : theme.muted}
                  bold={isActive}
                />
              </box>
            );
          })}
        </box>
      ))}
    </box>
  );
}
