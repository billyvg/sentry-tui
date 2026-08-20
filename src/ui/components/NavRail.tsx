import { NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";

export const NAV_RAIL_WIDTH = 3;

/** The narrow icon rail — the terminal analogue of Sentry's 74px primary sidebar. */
export function NavRail({ active, focused }: { active: NavGroupId; focused: boolean }) {
  return (
    <box
      style={{
        width: NAV_RAIL_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        backgroundColor: theme.panelAlt,
        border: ["right"],
        borderColor: focused ? theme.borderFocused : theme.border,
      }}
    >
      {NAV_GROUPS.map((group) => {
        const isActive = group.id === active;
        return (
          <text
            key={group.id}
            fg={isActive ? theme.text : theme.muted}
            bg={isActive ? theme.accent : undefined}
          >
            {` ${group.glyph} `}
          </text>
        );
      })}
    </box>
  );
}
