import { NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";
import { fitText, measureTextWidth } from "~/lib/text";
import { NAV_ICON_WIDTH, NavIcon } from "~/ui/components/NavIcon";
import { useImageSupport } from "~/ui/hooks/useImageSupport";

/**
 * Footprint of the org avatar at the top of the rail. Two columns by one row is
 * roughly square given terminal cell proportions.
 */
const AVATAR_WIDTH = 2;
const AVATAR_HEIGHT = 1;

/**
 * Row height of a nav item when icons are rendered. Matches the icon height so
 * items stack without a blank row between them.
 */
const NAV_ITEM_HEIGHT = 1;

/** Blank rows between icon nav items, so single-row entries still breathe. */
const NAV_ITEM_GAP = 1;

/** Columns between a nav item's icon and its label. */
const NAV_ICON_GAP = 1;

/** One cell of border plus one of padding on each side of the rail. */
const RAIL_CHROME_WIDTH = 4;

/** Widest nav label in terminal cells — the label that decides the rail width. */
const WIDEST_NAV_LABEL = Math.max(...NAV_GROUPS.map((group) => measureTextWidth(group.label)));

/**
 * Rail width, sized so the longest nav label always fits on one row. Derived
 * rather than hard-coded so renaming or adding a nav group can't silently wrap
 * a label. Always budgets for the icon column, even when the terminal can't
 * render images, so the rail doesn't change width between terminals.
 */
export const NAV_RAIL_WIDTH = RAIL_CHROME_WIDTH + NAV_ICON_WIDTH + NAV_ICON_GAP + WIDEST_NAV_LABEL;

/**
 * Blank rows framing the org header. The bottom margin exceeds NAV_ITEM_GAP so
 * the org reads as its own block rather than another nav entry.
 */
const ORG_HEADER_MARGIN_TOP = 1;
const ORG_HEADER_MARGIN_BOTTOM = 2;

interface NavRailProps {
  active: NavGroupId;
  focused: boolean;
  /** Remote URL for the organization's avatar image. */
  avatarUrl?: string;
  /** Organization slug, shown next to the avatar. */
  orgSlug?: string;
  /** Clicking a group opens it, exactly as Enter does on the rail cursor. */
  onSelect?: (group: NavGroupId) => void;
}

/** Primary navigation rail — shows icons (when supported) plus text labels. */
export function NavRail({ active, focused, avatarUrl, orgSlug, onSelect }: NavRailProps) {
  /** Usable content width: total minus borders (left+right) and horizontal padding. */
  const contentWidth = NAV_RAIL_WIDTH - RAIL_CHROME_WIDTH;
  const { supportsHighRes: hasImages } = useImageSupport();

  return (
    <box
      style={{
        width: NAV_RAIL_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        // No surface tint: the rail sits on the app background like the content
        // pane does. A box paints its background over its border cells too, so
        // any tint here would also thicken the border into a colored band.
        border: true,
        borderColor: focused ? theme.borderFocused : theme.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {/* Org header: avatar only when hi-res images are available, slug always */}
      {orgSlug || (hasImages && avatarUrl) ? (
        <box
          style={{
            height: hasImages ? AVATAR_HEIGHT : 1,
            flexDirection: "column",
            marginTop: ORG_HEADER_MARGIN_TOP,
            marginBottom: ORG_HEADER_MARGIN_BOTTOM,
          }}
        >
          <box style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
            {hasImages && avatarUrl ? (
              <image
                source={avatarUrl}
                fit="fit"
                style={{ width: AVATAR_WIDTH, height: AVATAR_HEIGHT }}
              />
            ) : null}
            {orgSlug ? (
              <text fg={theme.text} attributes={1}>
                {fitText(
                  orgSlug,
                  hasImages && avatarUrl ? contentWidth - AVATAR_WIDTH - 1 : contentWidth,
                )}
              </text>
            ) : null}
          </box>
        </box>
      ) : null}

      <box style={{ flexDirection: "column", gap: hasImages ? NAV_ITEM_GAP : 0 }}>
        {NAV_GROUPS.map((group) => {
          const isActive = group.id === active;

          // The row wrapper exists even without icons: it stretches to the
          // rail's content width, so the click target is the whole row rather
          // than just the label's glyphs.
          return (
            <box
              key={group.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: hasImages ? NAV_ICON_GAP : 0,
                height: NAV_ITEM_HEIGHT,
              }}
              onMouseDown={() => onSelect?.(group.id)}
            >
              {hasImages ? <NavIcon groupId={group.id} active={isActive} /> : null}
              <text fg={isActive ? theme.accent : theme.muted} attributes={isActive ? 1 : 0}>
                {group.label}
              </text>
            </box>
          );
        })}
      </box>
    </box>
  );
}
