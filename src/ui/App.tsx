import { useCallback, useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import type { SentryClient } from "~/api/client";
import { getOrganization } from "~/api/issues";
import type { Group } from "~/api/types";
import { matchesCommand } from "~/core/commands";
import { getNavGroup, NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { theme } from "~/core/theme";
import { TRIAGE_ACTIONS } from "~/core/triage";
import { HelpDialog } from "~/ui/components/HelpDialog";
import { NavRail, NAV_RAIL_WIDTH } from "~/ui/components/NavRail";
import { SecondaryNav, SECONDARY_NAV_WIDTH } from "~/ui/components/SecondaryNav";
import { StatusBar, type Notice } from "~/ui/components/StatusBar";
import { useFocusRing } from "~/ui/hooks/useFocusRing";
import { useTriage } from "~/ui/hooks/useTriage";
import { IssueDetail } from "~/ui/screens/IssueDetail";
import { IssueStream } from "~/ui/screens/IssueStream";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";

const REGIONS = ["nav", "secondary", "content"] as const;
type Region = (typeof REGIONS)[number];

export interface AppProps {
  onQuit: () => void;
  client?: SentryClient | null;
  org?: string;
}

interface StreamStatus {
  loading: boolean;
  elapsedMs?: number;
  error?: string;
  count?: number;
}

export function App({ onQuit, client = null, org = "" }: AppProps) {
  const { width, height } = useTerminalDimensions();

  // Rail cursor: which group is highlighted on the nav rail.
  const [railGroup, setRailGroup] = useState<NavGroupId>("issues");

  // Active selection: what the content pane renders. Default: Issues › Feed.
  const [activeGroup, setActiveGroup] = useState<NavGroupId>("issues");
  const [activeItem, setActiveItem] = useState("Feed");

  // Secondary nav: visible only after pressing Enter on the rail.
  const [showSecondary, setShowSecondary] = useState(false);
  const [secondaryItem, setSecondaryItem] = useState("Feed");

  const [showHelp, setShowHelp] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();

  // Fetch org details (including avatar) once on mount.
  useEffect(() => {
    if (!client || !org) return;
    const controller = new AbortController();
    getOrganization(client, { org, signal: controller.signal })
      .then((orgData) => {
        if (orgData.avatar?.avatarUrl) setAvatarUrl(orgData.avatar.avatarUrl);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [client, org]);
  const [issues, setIssues] = useState<Group[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<StreamStatus>({ loading: false });
  // A view stack rather than a router: Enter pushes a detail view, Esc pops.
  const [openIssue, setOpenIssue] = useState<Group | null>(null);
  const focus = useFocusRing<Region>(REGIONS);

  const [triageNotice, setTriageNotice] = useState<Notice | null>(null);

  const showIssues = activeGroup === "issues";

  const handleIssues = useCallback((next: Group[]) => {
    setIssues(next);
    // Clamp rather than reset: a refresh shouldn't move the cursor off the row
    // the user was looking at.
    setSelected((current) => Math.min(current, Math.max(0, next.length - 1)));
  }, []);

  /** Replace one issue in place — used for the optimistic write and rollback. */
  const replaceIssue = useCallback((next: Group) => {
    setIssues((current) => current.map((g) => (g.id === next.id ? next : g)));
    setOpenIssue((current) => (current && current.id === next.id ? next : current));
  }, []);

  // Triage notices are transient: they announce what just happened, then get
  // out of the way so the ambient load/count notice is visible again.
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showTriageNotice = useCallback((notice: Notice) => {
    setTriageNotice(notice);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setTriageNotice(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const triage = useTriage(client, org, {
    onOptimistic: replaceIssue,
    onNotice: showTriageNotice,
  });

  // The row the keyboard acts on: the open issue, else the list cursor.
  const activeIssue = openIssue ?? issues[selected];

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        // 1. Overlays swallow everything while open.
        () => {
          if (!showHelp) return "notMine";
          if (matchesCommand("sentry.nav.back", key) || matchesCommand("sentry.app.help", key)) {
            setShowHelp(false);
          }
          return "mine";
        },
        // 2. The detail view owns Escape (back) before anything else claims it.
        () => {
          if (!openIssue) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            setOpenIssue(null);
            return "mine";
          }
          return "notMine";
        },
        // 3. Escape closes the secondary nav and returns focus to the rail.
        () => {
          if (!showSecondary) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            setShowSecondary(false);
            focus.focus("nav");
            return "mine";
          }
          return "notMine";
        },
        // 4. Global app commands. Tab cycles only through visible regions.
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
            const cur = focus.focusedRef.current;
            if (showSecondary) {
              focus.focus(cur === "nav" ? "secondary" : "nav");
            } else {
              focus.focus(cur === "nav" ? "content" : "nav");
            }
            return "mine";
          }
          if (matchesCommand("sentry.app.focusPrev", key)) {
            const cur = focus.focusedRef.current;
            if (showSecondary) {
              focus.focus(cur === "secondary" ? "nav" : "secondary");
            } else {
              focus.focus(cur === "content" ? "nav" : "content");
            }
            return "mine";
          }
          return "notMine";
        },
        // 5. Triage actions, valid in both the list and the detail view.
        () => {
          if (!activeIssue) return "notMine";
          // In the list these belong to the content pane; the nav panes keep
          // their own j/k. In the detail view there is only one issue, so no
          // focus check is needed.
          if (!openIssue && focus.focusedRef.current !== "content") {
            return "notMine";
          }
          for (const action of TRIAGE_ACTIONS) {
            if (matchesCommand(action.commandId, key)) {
              triage.run(action.commandId, activeIssue);
              return "mine";
            }
          }
          return "notMine";
        },
        // 6. Nav rail: j/k moves the cursor, Enter opens secondary nav.
        () => {
          if (openIssue) return "notMine";
          if (focus.focusedRef.current !== "nav") return "notMine";
          if (matchesCommand("sentry.nav.open", key)) {
            const navGroup = getNavGroup(railGroup);
            // Re-entering the active group starts on the current item.
            const startItem =
              railGroup === activeGroup ? activeItem : (navGroup.sections[0]?.items[0] ?? "");
            setSecondaryItem(startItem);
            setShowSecondary(true);
            focus.focus("secondary");
            return "mine";
          }
          const index = NAV_GROUPS.findIndex((g) => g.id === railGroup);
          const step = matchesCommand("sentry.nav.down", key)
            ? 1
            : matchesCommand("sentry.nav.up", key)
              ? -1
              : 0;
          if (step === 0) return "notMine";
          const next = NAV_GROUPS[(index + step + NAV_GROUPS.length) % NAV_GROUPS.length]!;
          setRailGroup(next.id);
          return "mine";
        },
        // 7. Secondary nav: j/k moves the cursor, Enter selects and closes.
        () => {
          if (openIssue) return "notMine";
          if (!showSecondary) return "notMine";
          if (focus.focusedRef.current !== "secondary") return "notMine";
          const items = getNavGroup(railGroup).sections.flatMap((s) => s.items);
          const index = items.indexOf(secondaryItem);
          if (matchesCommand("sentry.nav.open", key)) {
            setActiveGroup(railGroup);
            setActiveItem(secondaryItem);
            setShowSecondary(false);
            focus.focus("content");
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setSecondaryItem(items[Math.min(index + 1, items.length - 1)] ?? secondaryItem);
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setSecondaryItem(items[Math.max(index - 1, 0)] ?? secondaryItem);
            return "mine";
          }
          return "notMine";
        },
        // 8. Issue list cursor and open.
        () => {
          if (openIssue) return "notMine";
          if (focus.focusedRef.current !== "content") return "notMine";
          const last = Math.max(0, issues.length - 1);
          if (matchesCommand("sentry.nav.open", key)) {
            const target = issues[selected];
            if (target) setOpenIssue(target);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setSelected((i) => Math.min(i + 1, last));
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setSelected((i) => Math.max(i - 1, 0));
            return "mine";
          }
          if (matchesCommand("sentry.nav.top", key)) {
            setSelected(0);
            return "mine";
          }
          if (matchesCommand("sentry.nav.bottom", key)) {
            setSelected(last);
            return "mine";
          }
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  const secondaryWidth = showSecondary ? SECONDARY_NAV_WIDTH : 0;
  const contentWidth = Math.max(20, width - NAV_RAIL_WIDTH - secondaryWidth - 2);
  const contentHeight = Math.max(3, height - 1);

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
        <NavRail
          active={railGroup}
          focused={focus.isFocused("nav")}
          avatarUrl={avatarUrl}
          orgSlug={org}
        />
        {showSecondary ? (
          <SecondaryNav
            group={railGroup}
            activeItem={secondaryItem}
            focused={focus.isFocused("secondary")}
          />
        ) : null}
        <box
          style={{
            flexGrow: 1,
            flexDirection: "column",
            paddingTop: 1,
            paddingLeft: 1,
            border: ["left"],
            borderColor: focus.isFocused("content") ? theme.borderFocused : theme.border,
          }}
        >
          {openIssue ? (
            <IssueDetail
              client={client}
              org={org}
              group={openIssue}
              width={contentWidth}
              height={contentHeight}
              focused={focus.isFocused("content")}
            />
          ) : showIssues ? (
            <IssueStream
              client={client}
              org={org}
              width={contentWidth}
              height={contentHeight}
              focused={focus.isFocused("content")}
              selectedIndex={selected}
              onIssuesChange={handleIssues}
              onStatusChange={setStatus}
              // Once loaded, the App owns the list so optimistic triage edits
              // survive; before that the stream renders its own fetch state.
              issuesOverride={issues.length > 0 ? issues : undefined}
              pendingIds={triage.pending}
            />
          ) : (
            <box style={{ flexDirection: "column" }}>
              <text fg={theme.text} attributes={1}>
                {`${getNavGroup(activeGroup).label} › ${activeItem}`}
              </text>
              <text fg={theme.muted}>Not implemented yet.</text>
            </box>
          )}
        </box>
      </box>

      <StatusBar
        notice={
          // A triage result is the most recent thing the user did, so it
          // outranks the ambient load/count notice.
          triageNotice ??
          (openIssue
            ? { kind: "idle", text: openIssue.shortId }
            : toNotice(status, showIssues, org))
        }
        elapsedMs={openIssue ? undefined : status.elapsedMs}
        hints={
          openIssue
            ? [
                { command: "sentry.nav.back", label: "back" },
                { command: "sentry.issue.resolve", label: "resolve" },
                { command: "sentry.issue.archive", label: "archive" },
                { command: "sentry.app.help", label: "help" },
              ]
            : [
                { command: "sentry.nav.open", label: "open" },
                { command: "sentry.app.refresh", label: "reload" },
                { command: "sentry.app.help", label: "help" },
                { command: "sentry.app.quit", label: "quit" },
              ]
        }
      />

      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}
    </box>
  );
}

function toNotice(status: StreamStatus, showIssues: boolean, org: string): Notice {
  if (!showIssues) return { kind: "idle", text: org || "Ready" };
  if (status.error) return { kind: "error", text: status.error };
  if (status.loading) return { kind: "loading", text: "Loading issues…" };
  if (status.count !== undefined) {
    return { kind: "success", text: `${status.count} issues` };
  }
  return { kind: "idle", text: org || "Ready" };
}
