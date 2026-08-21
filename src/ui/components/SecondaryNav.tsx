import { getNavGroup, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";
import type { Hotkey } from "~/lib/hotkeys";
import { NavHotkeyLabel } from "~/ui/components/NavHotkeyLabel";

export const SECONDARY_NAV_WIDTH = 22;

/** Usable content width: total minus borders (left+right) and horizontal padding. */
const CONTENT_WIDTH = SECONDARY_NAV_WIDTH - 4;

/** Sentry's 190px secondary sidebar: section header + grouped links. */
export function SecondaryNav({
  group,
  activeItem,
  focused,
  hotkeys,
  onSelect,
}: {
  group: NavGroupId;
  activeItem: string;
  focused: boolean;
  /** Goto keys to print in the labels. Absent unless goto mode is open. */
  hotkeys?: ReadonlyMap<string, Hotkey>;
  /** Clicking an item commits it, exactly as Enter does on the cursor. */
  onSelect?: (item: string) => void;
}) {
  const nav = getNavGroup(group);

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
      {nav.sections.map((section, si) => (
        <box key={si} style={{ flexDirection: "column" }}>
          <text fg={theme.border}>{"─".repeat(CONTENT_WIDTH)}</text>
          {section.title ? <text fg={theme.muted}>{section.title}</text> : null}
          {section.items.map((item) => {
            const isActive = item === activeItem;
            // The wrapper stretches to the pane's content width, so a click
            // anywhere on the row counts — not just on the label's glyphs.
            return (
              <box
                key={item}
                style={{ flexDirection: "row", height: 1 }}
                onMouseDown={() => onSelect?.(item)}
              >
                <NavHotkeyLabel
                  label={item}
                  hotkey={hotkeys?.get(item)}
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
