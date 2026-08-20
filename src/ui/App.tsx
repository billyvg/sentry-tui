import { useState } from "react";
import { useKeyboard } from "@opentui/react";

import { matchesCommand } from "~/core/commands";
import { getNavGroup, NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";
import { HelpDialog } from "~/ui/components/HelpDialog";
import { NavRail } from "~/ui/components/NavRail";
import { SecondaryNav } from "~/ui/components/SecondaryNav";
import { StatusBar, type Notice } from "~/ui/components/StatusBar";
import { useFocusRing } from "~/ui/hooks/useFocusRing";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";

const REGIONS = ["nav", "secondary", "content"] as const;
type Region = (typeof REGIONS)[number];

export function App({ onQuit }: { onQuit: () => void }) {
  const [group, setGroup] = useState<NavGroupId>("issues");
  const [item, setItem] = useState("Feed");
  const [showHelp, setShowHelp] = useState(false);
  const focus = useFocusRing<Region>(REGIONS);

  const notice: Notice = { kind: "idle", text: "Ready" };

  useKeyboard((key) => {
    // Precedence chain: overlays first, then global commands. Each handler
    // answers who owns the key rather than a bare boolean.
    routeKeyOwnership(
      [
        // 1. Help overlay swallows everything while open.
        () => {
          if (!showHelp) return "notMine";
          if (matchesCommand("sentry.nav.back", key) || matchesCommand("sentry.app.help", key)) {
            setShowHelp(false);
          }
          return "mine";
        },
        // 2. Global app commands.
        () => {
          if (matchesCommand("sentry.app.help", key)) {
            setShowHelp(true);
            return "mine";
          }
          if (matchesCommand("sentry.app.quit", key)) {
            onQuit();
            return "mine";
          }
          if (matchesCommand("sentry.app.focusNext", key)) {
            focus.next();
            return "mine";
          }
          if (matchesCommand("sentry.app.focusPrev", key)) {
            focus.prev();
            return "mine";
          }
          return "notMine";
        },
        // 3. Nav rail movement, only when the rail owns focus.
        () => {
          if (focus.focusedRef.current !== "nav") return "notMine";
          const index = NAV_GROUPS.findIndex((g) => g.id === group);
          if (matchesCommand("sentry.nav.down", key)) {
            const next = NAV_GROUPS[(index + 1) % NAV_GROUPS.length]!;
            setGroup(next.id);
            setItem(next.sections[0]?.items[0] ?? "");
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            const next =
              NAV_GROUPS[(index - 1 + NAV_GROUPS.length) % NAV_GROUPS.length]!;
            setGroup(next.id);
            setItem(next.sections[0]?.items[0] ?? "");
            return "mine";
          }
          return "notMine";
        },
        // 4. Secondary nav movement.
        () => {
          if (focus.focusedRef.current !== "secondary") return "notMine";
          const items = getNavGroup(group).sections.flatMap((s) => s.items);
          const index = items.indexOf(item);
          if (matchesCommand("sentry.nav.down", key)) {
            setItem(items[Math.min(index + 1, items.length - 1)] ?? item);
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setItem(items[Math.max(index - 1, 0)] ?? item);
            return "mine";
          }
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: theme.bg,
      }}
    >
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        <NavRail active={group} focused={focus.isFocused("nav")} />
        <SecondaryNav
          group={group}
          activeItem={item}
          focused={focus.isFocused("secondary")}
        />
        <box
          style={{
            flexGrow: 1,
            flexDirection: "column",
            padding: 1,
            border: ["left"],
            borderColor: focus.isFocused("content")
              ? theme.borderFocused
              : theme.border,
          }}
        >
          <text fg={theme.text} attributes={1}>
            {getNavGroup(group).label} › {item}
          </text>
          <text fg={theme.muted}>Not implemented yet.</text>
        </box>
      </box>

      <StatusBar
        notice={notice}
        hints={[
          { command: "sentry.app.focusNext", label: "pane" },
          { command: "sentry.app.help", label: "help" },
          { command: "sentry.app.quit", label: "quit" },
        ]}
      />

      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}
    </box>
  );
}
