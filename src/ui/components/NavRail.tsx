import { formatKey, primaryKey } from "~/core/commands";
import { NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";
import type { Hotkey } from "~/lib/hotkeys";
import { fitText, measureTextWidth } from "~/lib/text";
import { KeyHint } from "~/ui/components/KeyHint";
import { NavHotkeyLabel } from "~/ui/components/NavHotkeyLabel";
import { NAV_ICON_WIDTH, NavIcon } from "~/ui/components/NavIcon";
import { useImageSupport } from "~/ui/hooks/useImageSupport";

/** The command the org header opens — its key is printed beside the slug. */
const ORG_PICKER_COMMAND = "sentry.app.switchOrg";

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
 * Cells the org picker's key takes beside the slug: a separating space plus the
 * parenthesised key itself. Zero when the command is unbound, since `KeyHint`
 * then renders nothing.
 */
const ORG_KEY_HINT_WIDTH = (() => {
  const key = formatKey(primaryKey(ORG_PICKER_COMMAND));
  return key ? 1 + measureTextWidth(key) + 2 : 0;
})();

/**
 * Extra cells a goto key costs a label: the two parens it wears. The key itself
 * replaces one of the label's own characters, so it is free.
 *
 * Budgeted permanently rather than only while goto mode is open — a rail that
 * grew two columns on `g` would shove the whole layout sideways, which is a
 * loud way to answer a keystroke that only means "show me the keys".
 */
const GOTO_KEY_WIDTH = 2;

/** Widest row a nav item can produce: its icon, a gap, and its label. */
const NAV_ITEM_ROW_WIDTH = NAV_ICON_WIDTH + NAV_ICON_GAP + WIDEST_NAV_LABEL + GOTO_KEY_WIDTH;

/**
 * Widest row the org header can produce: the avatar, a gap, a slug given the
 * same room as the widest nav label, and the picker's key.
 */
const ORG_HEADER_ROW_WIDTH = AVATAR_WIDTH + 1 + WIDEST_NAV_LABEL + ORG_KEY_HINT_WIDTH;

/**
 * Rail width, sized so no row in it ever wraps — the widest nav label and the
 * org header both get their full run. Derived rather than hard-coded so
 * renaming a nav group or rebinding the org key can't silently truncate one.
 * Always budgets for the icon column, even when the terminal can't render
 * images, so the rail doesn't change width between terminals.
 */
export const NAV_RAIL_WIDTH =
  RAIL_CHROME_WIDTH + Math.max(NAV_ITEM_ROW_WIDTH, ORG_HEADER_ROW_WIDTH);

/**
 * Blank rows framing the org header. The bottom margin exceeds NAV_ITEM_GAP so
 * the org reads as its own block rather than another nav entry.
 */
const ORG_HEADER_MARGIN_TOP = 1;
const ORG_HEADER_MARGIN_BOTTOM = 2;

/** Column an overlay anchored to the org header starts at: inside the border. */
export const ORG_HEADER_ANCHOR_LEFT = 1;

/**
 * Row an overlay anchored to the org header drops from — the rail's top border,
 * the header's own top margin, and the header row itself.
 */
export const ORG_HEADER_ANCHOR_TOP = 1 + ORG_HEADER_MARGIN_TOP + AVATAR_HEIGHT;

interface NavRailProps {
  active: NavGroupId;
  focused: boolean;
  /** Goto keys to print in the labels. Absent unless goto mode is open. */
  hotkeys?: ReadonlyMap<NavGroupId, Hotkey>;
  /** Remote URL for the organization's avatar image. */
  avatarUrl?: string;
  /** Organization slug, shown next to the avatar. */
  orgSlug?: string;
  /** Clicking a group opens it, exactly as Enter does on the rail cursor. */
  onSelect?: (group: NavGroupId) => void;
  /** Open the organization picker — the header is a control, not a caption. */
  onOrgPress?: () => void;
}

/** Primary navigation rail — shows icons (when supported) plus text labels. */
export function NavRail({
  active,
  focused,
  hotkeys,
  avatarUrl,
  orgSlug,
  onSelect,
  onOrgPress,
}: NavRailProps) {
  /** Usable content width: total minus borders (left+right) and horizontal padding. */
  const contentWidth = NAV_RAIL_WIDTH - RAIL_CHROME_WIDTH;
  const { supportsHighRes: hasImages } = useImageSupport();

  /** What the slug has left after the avatar (when drawn) and the key hint. */
  const slugWidth =
    contentWidth - (hasImages && avatarUrl ? AVATAR_WIDTH + 1 : 0) - ORG_KEY_HINT_WIDTH;

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
          onMouseDown={onOrgPress}
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
                {fitText(orgSlug, slugWidth)}
              </text>
            ) : null}
            {/* The key rides the slug, so the org reads as something you press
                rather than a label that happens to sit above the nav. Wrapped
                so the row's gap falls beside the hint, not between its parens
                and the key. */}
            <box style={{ flexDirection: "row" }}>
              <KeyHint command={ORG_PICKER_COMMAND} />
            </box>
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
              <NavHotkeyLabel
                label={group.label}
                hotkey={hotkeys?.get(group.id)}
                fg={isActive ? theme.accent : theme.muted}
                bold={isActive}
              />
            </box>
          );
        })}
      </box>
    </box>
  );
}
