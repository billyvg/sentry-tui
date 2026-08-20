import { NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";
import { NavIcon } from "~/ui/components/NavIcon";
import { useImageSupport } from "~/ui/hooks/useImageSupport";

export const NAV_RAIL_WIDTH = 16;

/** Icon size for the org avatar at the top of the rail. */
const AVATAR_SIZE = 2;

interface NavRailProps {
  active: NavGroupId;
  focused: boolean;
  /** Remote URL for the organization's avatar image. */
  avatarUrl?: string;
  /** Organization slug, shown next to the avatar. */
  orgSlug?: string;
}

/** Primary navigation rail — shows icons (when supported) plus text labels. */
export function NavRail({ active, focused, avatarUrl, orgSlug }: NavRailProps) {
  /** Usable content width: total minus border and horizontal padding. */
  const contentWidth = NAV_RAIL_WIDTH - 3;
  const { supportsHighRes: hasImages } = useImageSupport();

  return (
    <box
      style={{
        width: NAV_RAIL_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        backgroundColor: theme.panelAlt,
        border: ["right"],
        borderColor: focused ? theme.borderFocused : theme.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {/* Org header: avatar only when hi-res images are available, slug always */}
      {orgSlug || (hasImages && avatarUrl) ? (
        <box
          style={{
            height: hasImages ? AVATAR_SIZE + 1 : 1,
            flexDirection: "column",
            marginBottom: 1,
          }}
        >
          <box style={{ flexDirection: "row", gap: 1 }}>
            {hasImages && avatarUrl ? (
              <image
                source={avatarUrl}
                fit="fit"
                style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
              />
            ) : null}
            {orgSlug ? (
              <text fg={theme.text} attributes={1}>
                {fitText(
                  orgSlug,
                  hasImages && avatarUrl ? contentWidth - AVATAR_SIZE - 1 : contentWidth,
                )}
              </text>
            ) : null}
          </box>
        </box>
      ) : null}

      {NAV_GROUPS.map((group) => {
        const isActive = group.id === active;

        if (hasImages) {
          return (
            <box
              key={group.id}
              style={{
                flexDirection: "column",
                height: 3,
              }}
            >
              <box style={{ flexDirection: "row", gap: 1 }}>
                <NavIcon groupId={group.id} active={isActive} />
                <text fg={isActive ? theme.accent : theme.muted} attributes={isActive ? 1 : 0}>
                  {group.label}
                </text>
              </box>
            </box>
          );
        }

        return (
          <text
            key={group.id}
            fg={isActive ? theme.accent : theme.muted}
            attributes={isActive ? 1 : 0}
          >
            {group.label.slice(0, contentWidth)}
          </text>
        );
      })}
    </box>
  );
}
