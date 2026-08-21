import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import type { SentryClient } from "~/api/client";
import { writeConfig } from "~/api/config";
import { getOrganization } from "~/api/issues";
import type { Group } from "~/api/types";
import { matchesCommand } from "~/core/commands";
import { buildGotoHotkeys } from "~/core/goto";
import { getNavGroup, NAV_GROUPS, soleNavItem, type NavGroupId } from "~/core/nav";
import { buildPaletteActions, type PaletteAction } from "~/core/palette";
import { findScreen, stateKeyOf } from "~/core/screens";
import { theme } from "~/core/theme";
import { findTriageAction, TRIAGE_ACTIONS } from "~/core/triage";
import { CommandPalette } from "~/ui/components/CommandPalette";
import { isDropdownMounted } from "~/ui/components/Dropdown";
import { HelpDialog } from "~/ui/components/HelpDialog";
import {
  NavRail,
  NAV_RAIL_WIDTH,
  ORG_HEADER_ANCHOR_LEFT,
  ORG_HEADER_ANCHOR_TOP,
} from "~/ui/components/NavRail";
import { OrgPicker } from "~/ui/components/OrgPicker";
import { SecondaryNav, SECONDARY_NAV_WIDTH } from "~/ui/components/SecondaryNav";
import { StatusBar, type Notice } from "~/ui/components/StatusBar";
import { useFocusRing } from "~/ui/hooks/useFocusRing";
import { SeerChatContext, useSeerChat } from "~/ui/hooks/useSeerChat";
import { rowsOf, useScreenState, type ScreenStatus } from "~/ui/hooks/useScreenState";
import { useSecondaryNavExtras } from "~/ui/hooks/useSecondaryNavExtras";
import { useTriage } from "~/ui/hooks/useTriage";
import { navItemsFor, navTargetOf, type NavItemSpec } from "~/ui/lib/navSections";
import { SCREEN_COMPONENTS } from "~/ui/screens/registry";
import type { ScreenActions, ViewStackEntry } from "~/ui/screens/types";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";

const REGIONS = ["nav", "secondary", "content"] as const;
type Region = (typeof REGIONS)[number];

export interface AppProps {
  onQuit: () => void;
  client?: SentryClient | null;
  org?: string;
}

export function App({ onQuit, client = null, org: initialOrg = "" }: AppProps) {
  const { width, height } = useTerminalDimensions();

  // The open organization. Sourced from the CLI at startup, then owned here so
  // the picker can repoint every screen at once — every fetch in the tree takes
  // it as a dependency.
  const [org, setOrg] = useState(initialOrg);

  // Rail cursor: which group is highlighted on the nav rail.
  const [railGroup, setRailGroup] = useState<NavGroupId>("issues");

  // Active selection: what the content pane renders. Default: Issues › Feed.
  const [activeGroup, setActiveGroup] = useState<NavGroupId>("issues");
  const [activeItem, setActiveItem] = useState("Feed");

  // Secondary nav: visible only after pressing Enter on the rail.
  const [showSecondary, setShowSecondary] = useState(false);
  const [secondaryItem, setSecondaryItem] = useState("Feed");

  // Goto mode: both nav panes on screen with a key printed on every
  // destination, so a jump anywhere is two keystrokes and no cursor work.
  const [gotoMode, setGotoMode] = useState(false);

  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();

  // One counter drives every fetch on screen: bumping it re-runs the data
  // hooks' effects, so refresh stays a single command rather than one
  // per-screen callback wired back up the tree.
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  // Fetch org details (including avatar) for whichever org is open.
  useEffect(() => {
    // Drop the previous org's avatar immediately — the wrong face in the rail
    // is worse than none while the new one loads.
    setAvatarUrl(undefined);
    if (!client || !org) return;
    const controller = new AbortController();
    getOrganization(client, { org, signal: controller.signal })
      .then((orgData) => {
        if (orgData.avatar?.avatarUrl) setAvatarUrl(orgData.avatar.avatarUrl);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [client, org]);

  const focus = useFocusRing<Region>(REGIONS, "content");

  // What the content pane is showing. Rows, cursor and filters live in the
  // store rather than the screen, so they survive navigating away and back.
  const screen = findScreen(activeGroup, activeItem);
  const ScreenComponent = screen ? SCREEN_COMPONENTS[screen.id] : undefined;

  // A view stack rather than a router: Enter pushes a view, Esc pops. Entries
  // carry their own renderer, so a new detail screen costs nothing here.
  const [viewStack, setViewStack] = useState<readonly ViewStackEntry[]>([]);
  const topView = viewStack.at(-1);

  /**
   * A view with no state of its own is a static detail pane: no cursor, no
   * search bar, no filters. One *with* a slice is a screen in all but name —
   * an opened saved search, say — and the app drives it as one.
   */
  const detailView = topView && !topView.stateKey ? topView : undefined;
  /** The content pane is a list the cursor and the filters act on. */
  const listActive = !detailView && (ScreenComponent !== undefined || topView !== undefined);

  // The slice in play: the nearest view that brought its own, else the
  // screen's. Walking down the stack matters when an issue detail sits on top
  // of an opened saved search — the triage write belongs to the list under it.
  const activeKey =
    [...viewStack].reverse().find((view) => view.stateKey)?.stateKey ??
    (screen ? stateKeyOf(screen) : undefined);
  const { active: state, resetOrgScoped, seed } = useScreenState(activeKey);

  // Seer's conversation outlives its screen: navigating to Issues and back is
  // not a reason to lose the transcript. The hook is inert until the first
  // message, so it costs nothing while the user is anywhere else.
  const seerChat = useSeerChat(client, org);

  // What Enter means on the screen that is mounted, registered by the screen
  // itself. Held in a ref because the key router reads it during a keystroke,
  // not during a render.
  const screenActions = useRef<ScreenActions | null>(null);
  const registerActions = useCallback((actions: ScreenActions | null) => {
    screenActions.current = actions;
  }, []);

  const pushView = useCallback(
    (view: ViewStackEntry) => {
      // Seed before the push so the view's first render already has its own
      // filters rather than a frame of whatever the slice held before.
      if (view.stateKey && view.initialState) seed(view.stateKey, view.initialState);
      setViewStack((stack) => [...stack, view]);
    },
    [seed],
  );

  const popView = useCallback(() => setViewStack((stack) => stack.slice(0, -1)), []);

  const [transientNotice, setTransientNotice] = useState<Notice | null>(null);

  // Notices about something the user just did are transient: they announce the
  // action, then get out of the way so the ambient load notice is visible again.
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showNotice = useCallback((notice: Notice) => {
    setTransientNotice(notice);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setTransientNotice(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  /**
   * Replace one issue in place — used for the optimistic write and rollback.
   *
   * Through the updater rather than the current rows: a confirmation arrives
   * after its own request, by which time the list may have moved on, and
   * writing a snapshot back would undo whatever happened in between.
   */
  const { setEntries } = state;
  const replaceIssue = useCallback(
    (next: Group) => {
      setEntries((rows) => {
        const groups = rows as readonly Group[];
        return groups.some((row) => row?.id === next.id)
          ? groups.map((row) => (row?.id === next.id ? next : row))
          : rows;
      });
      setViewStack((stack) =>
        stack.map((view) => (view.issue?.id === next.id ? { ...view, issue: next } : view)),
      );
    },
    [setEntries],
  );

  /**
   * Point the whole app at a different organization.
   *
   * Everything on screen is org-scoped, so the loaded rows and the project and
   * environment filters are dropped rather than carried across — a project slug
   * from the old org selects nothing in the new one. The choice is persisted as
   * the new default, matching what `--org` writes on first run.
   */
  const switchOrg = useCallback(
    (slug: string) => {
      setShowOrgPicker(false);
      if (!slug || slug === org) return;

      setOrg(slug);
      setViewStack([]);
      resetOrgScoped();
      showNotice({ kind: "info", text: `switched to ${slug}` });

      void writeConfig({ org: slug }).catch(() => {
        // A read-only config dir shouldn't undo a switch that already happened;
        // it only means the next launch opens the previous org.
      });
    },
    [org, resetOrgScoped, showNotice],
  );

  const triage = useTriage(client, org, {
    onOptimistic: replaceIssue,
    onNotice: showNotice,
  });

  // The row the keyboard acts on: the open issue, else the list cursor. The
  // list survives navigating away, so the cursor only counts while an issue
  // screen is the thing on screen — otherwise `r` on the log view would
  // resolve an issue nobody can see.
  const activeIssue =
    topView?.issue ?? (activeGroup === "issues" ? rowsOf<Group>(state)[state.selected] : undefined);

  // Dynamic nav sections (starred queries, starred dashboards) and item
  // badges. Empty until something supplies them; the cursor and the click
  // handler already walk whatever arrives.
  const navExtras = useSecondaryNavExtras(client, org, railGroup, reloadToken);
  const secondaryItems = useMemo(() => navItemsFor(railGroup, navExtras), [railGroup, navExtras]);

  /**
   * Open a nav group's secondary list — the one path Enter on the rail and a
   * click on a rail item both take.
   */
  /**
   * Show a group's item in the content pane — the one path every way of
   * navigating ends at: the secondary nav, a click, and the command palette.
   */
  const navigateTo = useCallback(
    (group: NavGroupId, item: string) => {
      setGotoMode(false);
      setRailGroup(group);
      setActiveGroup(group);
      setActiveItem(item);
      setSecondaryItem(item);
      setShowSecondary(false);
      // Navigating away supersedes whatever view is on the stack; otherwise
      // it keeps rendering over the group just chosen. The outgoing screen's
      // detail panel closes with it.
      setViewStack([]);
      state.setDetailOpen(false);
      focus.focus("content");
    },
    [focus, state],
  );

  /**
   * Enter on the rail: open the group's secondary pane.
   *
   * A group with exactly one destination has no list worth showing, so its rail
   * row goes straight there — Seer is the only one today.
   */
  const openNavGroup = useCallback(
    (group: NavGroupId) => {
      const sole = soleNavItem(getNavGroup(group));
      if (sole !== undefined) {
        // `navigateTo` clears goto mode itself.
        navigateTo(group, sole);
        return;
      }
      setGotoMode(false);
      setRailGroup(group);
      // Re-entering the active group starts on the current item.
      const startItem =
        group === activeGroup ? activeItem : (getNavGroup(group).sections[0]?.items[0] ?? "");
      setSecondaryItem(startItem);
      setShowSecondary(true);
      focus.focus("secondary");
    },
    [activeGroup, activeItem, focus, navigateTo],
  );

  /**
   * Commit a secondary nav item as the active view — shared by Enter on the
   * secondary cursor and a click on a secondary item. A dynamic item can point
   * somewhere other than its own label, and can carry a view of its own; a
   * static one never does either.
   */
  const selectNavItem = useCallback(
    (item: NavItemSpec) => {
      const target = navTargetOf(railGroup, item);
      navigateTo(target.group, target.item);
      // A starred item's `open` is what makes it *that* query rather than the
      // list it lives in. `navigateTo` has just cleared the stack, and both
      // updates land in one batch, so the pushed view is the only one on it.
      const view = item.open?.();
      if (view) pushView(view);
    },
    [railGroup, navigateTo, pushView],
  );

  // Keys for goto mode, for the group whose items are on screen. Computed only
  // while the mode is open so nothing else can accidentally print them.
  const gotoHotkeys = useMemo(
    () => (gotoMode ? buildGotoHotkeys(railGroup) : null),
    [gotoMode, railGroup],
  );

  /**
   * Point the secondary pane at another group without leaving goto mode — the
   * first half of a two-key jump, e.g. `g` `e` `l` for Explore › Logs.
   *
   * A group with a single destination has no second half to offer, so its key
   * completes the jump rather than previewing a one-row list.
   */
  const previewNavGroup = useCallback(
    (group: NavGroupId) => {
      const sole = soleNavItem(getNavGroup(group));
      if (sole !== undefined) {
        navigateTo(group, sole);
        return;
      }
      setRailGroup(group);
      setSecondaryItem(
        group === activeGroup ? activeItem : (navItemsFor(group, navExtras)[0]?.label ?? ""),
      );
    },
    [activeGroup, activeItem, navExtras, navigateTo],
  );

  const paletteActions = useMemo(
    () =>
      buildPaletteActions({
        streamView: listActive,
        hasIssue: Boolean(activeIssue),
      }),
    [listActive, activeIssue],
  );

  /**
   * Run what the palette selected, then close it.
   *
   * Every branch reuses the callback the key binding already goes through, so
   * a command can't behave one way from the keyboard and another from `ctrl+k`.
   */
  const runPaletteAction = useCallback(
    (action: PaletteAction) => {
      setShowPalette(false);
      if (action.target.kind === "nav") {
        navigateTo(action.target.group, action.target.item);
        return;
      }

      const { commandId } = action.target;
      switch (commandId) {
        case "sentry.app.quit":
          onQuit();
          return;
        case "sentry.app.help":
          setShowHelp(true);
          return;
        case "sentry.app.refresh":
          refresh();
          return;
        case "sentry.app.switchOrg":
          setShowOrgPicker(true);
          return;
        case "sentry.nav.search":
          focus.focus("content");
          state.focusSearch();
          return;
        case "sentry.view.filterProject":
          focus.focus("content");
          state.setOpenDropdown("project");
          return;
        case "sentry.view.filterEnv":
          focus.focus("content");
          state.setOpenDropdown("env");
          return;
        case "sentry.view.filterDate":
          focus.focus("content");
          state.setOpenDropdown("date");
          return;
        default:
          // The remaining palette-scoped commands are all triage actions; the
          // catalog only offers them when there is an issue to act on.
          if (findTriageAction(commandId) && activeIssue) triage.run(commandId, activeIssue);
      }
    },
    [activeIssue, focus, navigateTo, onQuit, refresh, state, triage],
  );

  /**
   * Mouse handling for a row: the first click puts the cursor on the row, a
   * second click on that same row opens it. Two steps rather than one, because
   * a stray click in a list is cheap to recover from only while it moves a
   * cursor — and it mirrors the rail, where a click picks a group and a click
   * in the list beside it commits.
   */
  const activateRow = useCallback(
    (index: number) => {
      // A click that arrives while the list is unfocused is the one that
      // focuses it, so it can only ever select — the cursor it would be
      // "confirming" wasn't on screen to be aimed at.
      const confirming = focus.focusedRef.current === "content" && index === state.selected;
      state.setSelected(index);
      // The secondary nav is a drawer over the nav rail; acting in the content
      // pane closes it, exactly as choosing an item from it does.
      setShowSecondary(false);
      focus.focus("content");
      if (confirming) screenActions.current?.open?.(index);
    },
    [focus, state],
  );

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        // 0. The palette owns every key while open. It runs its own listener
        // for the cursor and Enter, and everything it doesn't claim is text
        // for its query input — so this handler only has to end the chain.
        () => (showPalette ? "focused" : "notMine"),
        // 1. Overlays swallow everything while open.
        () => {
          if (!showHelp) return "notMine";
          if (matchesCommand("sentry.nav.back", key) || matchesCommand("sentry.app.help", key)) {
            setShowHelp(false);
          }
          return "mine";
        },
        // 1b. Filter dropdowns swallow keys while open — the Dropdown
        // component handles its own navigation via a separate useKeyboard.
        // Returning "focused" stops this routing chain so later handlers
        // (e.g. the list cursor) don't steal j/k, while still letting the
        // Dropdown's global listener fire.
        () => {
          if (!state.openDropdown && !showOrgPicker) return "notMine";
          // Rescue an *orphaned* dropdown. `P` is in the command table for
          // every screen, including those with no filter row to mount a
          // `Dropdown` — and with nothing mounted, "focused" ends the chain
          // before any handler can clear the state, so the app stops answering
          // the keyboard entirely. A mounted dropdown is left alone: it owns a
          // two-stage Escape (clear the filter, then close) that this would
          // otherwise short-circuit.
          if (
            state.openDropdown &&
            !isDropdownMounted() &&
            matchesCommand("sentry.nav.back", key)
          ) {
            state.setOpenDropdown(null);
            return "mine";
          }
          return "focused";
        },
        // 1c. The palette opens from anywhere, including mid-edit in the
        // search box — so it is claimed ahead of the handler that would
        // otherwise hand the chord to the focused input.
        () => {
          if (!matchesCommand("sentry.app.commandPalette", key)) return "notMine";
          if (state.searchFocused) state.cancelSearch();
          // A screen's own input (Seer's composer) has to let go as well, or it
          // keeps claiming keys behind the palette.
          if (screenActions.current?.inputFocused?.()) screenActions.current.blurInput?.();
          setShowPalette(true);
          return "mine";
        },
        // 1d. A screen's own text input — Seer's composer — owns Enter (send)
        // and Escape (release). It sits above the app's search handler because
        // the two are different inputs, and above the global commands because
        // otherwise `r` would resolve an issue mid-sentence. Tab still moves
        // between panes: the composer lets go and the move happens below.
        () => {
          const actions = screenActions.current;
          if (!actions?.inputFocused?.()) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            actions.blurInput?.();
            return "mine";
          }
          if (matchesCommand("sentry.nav.open", key)) {
            return actions.submitInput?.() ? "mine" : "focused";
          }
          if (
            matchesCommand("sentry.app.focusNext", key) ||
            matchesCommand("sentry.app.focusPrev", key)
          ) {
            actions.blurInput?.();
            return "notMine";
          }
          // Everything else belongs to the input renderable itself.
          return "focused";
        },
        // 2. Search input intercepts Escape (cancel) and Enter (submit);
        //    all other keys pass through to the focused <input>.
        () => {
          if (!state.searchFocused) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            state.cancelSearch();
            return "mine";
          }
          if (matchesCommand("sentry.nav.open", key)) {
            state.submitSearch();
            return "mine";
          }
          // Let the focused input renderable handle all other keystrokes.
          return "focused";
        },
        // 2b. Goto mode. Sits under the search handler so `n` is still a letter
        // while a query is being typed, and over everything else so the mode
        // owns the keyboard for exactly as long as it is open — a printed key
        // that sometimes resolved an issue instead would be worse than none.
        () => {
          if (!gotoMode) {
            if (!matchesCommand("sentry.nav.goto", key)) return "notMine";
            setGotoMode(true);
            return "mine";
          }
          if (
            matchesCommand("sentry.nav.goto", key) ||
            matchesCommand("sentry.nav.back", key) ||
            key.ctrl ||
            key.meta ||
            key.shift
          ) {
            // `n` and Escape close the mode; a modifier means the user has
            // moved on to some other chord and this one was a false start.
            setGotoMode(false);
            return "mine";
          }
          if (matchesCommand("sentry.app.switchOrg", key)) {
            // The rail prints this key beside the org slug for as long as the
            // mode is open, so in the mode it still opens the picker — the
            // organization is a destination like any other row up there.
            setGotoMode(false);
            setShowOrgPicker(true);
            return "mine";
          }
          const target = gotoHotkeys?.byKey.get(key.name.toLowerCase());
          if (target?.kind === "group") {
            previewNavGroup(target.group);
            return "mine";
          }
          if (target?.kind === "item") {
            // `navigateTo` closes the mode, as every other way of arriving does.
            navigateTo(railGroup, target.item);
            return "mine";
          }
          // An unassigned key is a miss, not a command: leave, and let the next
          // keystroke mean what it usually means.
          setGotoMode(false);
          return "mine";
        },
        // 3. The detail view owns Escape (back) before anything else claims it.
        () => {
          if (!topView) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            popView();
            return "mine";
          }
          return "notMine";
        },
        // 3b. The screen gets Escape next: it may have an inline panel open
        // that should close before the key means anything else.
        () => {
          if (topView) return "notMine";
          if (focus.focusedRef.current !== "content") return "notMine";
          if (!matchesCommand("sentry.nav.back", key)) return "notMine";
          return screenActions.current?.back?.() ? "mine" : "notMine";
        },
        // 4. Escape closes the secondary nav and returns focus to the rail.
        () => {
          if (!showSecondary) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            setShowSecondary(false);
            focus.focus("nav");
            return "mine";
          }
          return "notMine";
        },
        // 5. Global app commands. Tab cycles only through visible regions.
        () => {
          // Filter shortcuts belong to whatever list is on screen.
          if (listActive && focus.focusedRef.current === "content") {
            if (matchesCommand("sentry.view.filterProject", key)) {
              state.setOpenDropdown("project");
              return "mine";
            }
            if (matchesCommand("sentry.view.filterEnv", key)) {
              state.setOpenDropdown("env");
              return "mine";
            }
            if (matchesCommand("sentry.view.filterDate", key)) {
              state.setOpenDropdown("date");
              return "mine";
            }
          }
          if (matchesCommand("sentry.app.help", key)) {
            setShowHelp(true);
            return "mine";
          }
          if (matchesCommand("sentry.app.refresh", key)) {
            refresh();
            return "mine";
          }
          if (matchesCommand("sentry.app.switchOrg", key)) {
            setShowOrgPicker(true);
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
        // 6. Triage actions, valid in both the list and the detail view.
        () => {
          if (!activeIssue) return "notMine";
          // In the list these belong to the content pane; the nav panes keep
          // their own j/k. In the detail view there is only one issue, so no
          // focus check is needed.
          if (!detailView && focus.focusedRef.current !== "content") {
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
        // 7. Nav rail: j/k moves the cursor, Enter opens secondary nav.
        () => {
          if (topView) return "notMine";
          if (focus.focusedRef.current !== "nav") return "notMine";
          if (matchesCommand("sentry.nav.open", key)) {
            openNavGroup(railGroup);
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
        // 8. Secondary nav: j/k moves the cursor, Enter selects and closes.
        () => {
          if (topView) return "notMine";
          if (!showSecondary) return "notMine";
          if (focus.focusedRef.current !== "secondary") return "notMine";
          const index = secondaryItems.findIndex((item) => item.label === secondaryItem);
          if (matchesCommand("sentry.nav.open", key)) {
            const item = secondaryItems[index] ?? secondaryItems[0];
            if (item) selectNavItem(item);
            return "mine";
          }
          const step = matchesCommand("sentry.nav.down", key)
            ? 1
            : matchesCommand("sentry.nav.up", key)
              ? -1
              : 0;
          if (step === 0) return "notMine";
          const next = Math.max(0, Math.min(index + step, secondaryItems.length - 1));
          setSecondaryItem(secondaryItems[next]?.label ?? secondaryItem);
          return "mine";
        },
        // 8b. The screen's own keys, for a body that isn't a list — Seer's
        // transcript. Below the nav panes and the global commands, so it can
        // claim `n` and the digits without shadowing `?` or `q`.
        () => {
          const actions = screenActions.current;
          if (!actions?.handleKey) return "notMine";
          if (!focus.isFocused("content")) return "notMine";
          return actions.handleKey(key) ? "mine" : "notMine";
        },
        // 9. `/` focuses the search bar from the content pane.
        () => {
          if (!listActive) return "notMine";
          if (focus.focusedRef.current !== "content") return "notMine";
          if (matchesCommand("sentry.nav.search", key)) {
            state.focusSearch();
            return "mine";
          }
          return "notMine";
        },
        // 10. The list cursor, for whichever screen is mounted. Enter is the
        // screen's own business — it registers what opening a row means.
        () => {
          if (!listActive) return "notMine";
          if (focus.focusedRef.current !== "content") return "notMine";
          const last = Math.max(0, state.entries.length - 1);
          if (matchesCommand("sentry.nav.open", key)) {
            const open = screenActions.current?.open;
            if (!open) return "notMine";
            open(state.selected);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            state.setSelected((i) => Math.min(i + 1, last));
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            state.setSelected((i) => Math.max(i - 1, 0));
            return "mine";
          }
          if (matchesCommand("sentry.nav.top", key)) {
            state.setSelected(0);
            return "mine";
          }
          if (matchesCommand("sentry.nav.bottom", key)) {
            state.setSelected(last);
            return "mine";
          }
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  // Goto mode shows the secondary pane without opening it: leaving
  // `showSecondary` alone means cancelling the mode puts the panes back exactly
  // as they were, rather than leaving a drawer open that nobody pulled.
  const showSecondaryPane = showSecondary || gotoMode;
  const secondaryWidth = showSecondaryPane ? SECONDARY_NAV_WIDTH : 0;
  const contentWidth = Math.max(20, width - NAV_RAIL_WIDTH - secondaryWidth - 2);
  const contentHeight = Math.max(3, height - 3);

  /**
   * What the content pane hands whatever it draws. A screen and a pushed view
   * take the same things — the view just brings its own renderer.
   */
  const paneProps = {
    client,
    org,
    focused: focus.isFocused("content"),
    width: contentWidth,
    height: contentHeight,
    reloadToken,
    pendingIds: triage.pending,
    pushView,
    notify: showNotice,
    activateRow,
    registerActions,
  };

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
          hotkeys={gotoHotkeys?.groups}
          onSelect={openNavGroup}
          onOrgPress={() => setShowOrgPicker(true)}
        />
        {showSecondaryPane ? (
          <SecondaryNav
            group={railGroup}
            activeItem={secondaryItem}
            focused={focus.isFocused("secondary")}
            extras={navExtras}
            hotkeys={gotoHotkeys?.items}
            onSelect={selectNavItem}
          />
        ) : null}
        <box
          style={{
            flexGrow: 1,
            flexDirection: "column",
            // Clip rather than letting an over-tall screen paint over the
            // pane's bottom border and the status bar below it.
            overflow: "hidden",
            border: true,
            borderColor:
              focus.isFocused("content") && !state.searchFocused
                ? theme.borderFocused
                : theme.border,
          }}
        >
          {/* Seer reads its transcript from here; every other screen ignores it. */}
          <SeerChatContext.Provider value={seerChat}>
            {topView ? (
              topView.render({
                ...paneProps,
                // A view with no slice of its own gets none: it is a detail
                // pane, and `state` would be the list's underneath it.
                state: topView.stateKey ? state : undefined,
                issue: topView.issue,
              })
            ) : ScreenComponent && screen ? (
              <ScreenComponent {...paneProps} screen={screen} state={state} />
            ) : (
              <box style={{ flexDirection: "column", paddingLeft: 1 }}>
                <text fg={theme.text} attributes={1}>
                  {`${getNavGroup(activeGroup).label} › ${activeItem}`}
                </text>
                <text fg={theme.muted}>Not implemented yet.</text>
              </box>
            )}
          </SeerChatContext.Provider>
        </box>
      </box>

      <StatusBar
        notice={
          // Goto mode is a held-open key prompt, so it outranks even a fresh
          // triage result: the bar has to answer "what is it waiting for?".
          gotoMode
            ? { kind: "info", text: "go to…" }
            : // A triage result or an org switch is the most recent thing the
              // user did, so it outranks the ambient load notice.
              (transientNotice ??
              (detailView
                ? { kind: "idle", text: detailView.label ?? "" }
                : toNotice(state.status)))
        }
        elapsedMs={detailView || gotoMode ? undefined : state.status.elapsedMs}
        hints={
          gotoMode
            ? [{ command: "sentry.nav.back", label: "cancel" }]
            : state.searchFocused
              ? [
                  { command: "sentry.nav.open", label: "submit" },
                  { command: "sentry.nav.back", label: "cancel" },
                ]
              : detailView
                ? [
                    { command: "sentry.nav.back", label: "back" },
                    { command: "sentry.issue.resolve", label: "resolve" },
                    { command: "sentry.issue.archive", label: "archive" },
                    { command: "sentry.nav.goto", label: "nav" },
                    { command: "sentry.app.commandPalette", label: "commands" },
                    { command: "sentry.app.help", label: "help" },
                  ]
                : [
                    {
                      command: "sentry.nav.open",
                      // Enter toggles a panel on some screens, so the one hint
                      // carries both directions.
                      label: state.detailOpen ? "close" : (screen?.openLabel ?? "open"),
                    },
                    { command: "sentry.nav.search", label: "search" },
                    { command: "sentry.nav.goto", label: "nav" },
                    { command: "sentry.app.commandPalette", label: "commands" },
                    { command: "sentry.app.help", label: "help" },
                    { command: "sentry.app.quit", label: "quit" },
                  ]
        }
      />

      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}

      {showPalette ? (
        <CommandPalette
          actions={paletteActions}
          onRun={runPaletteAction}
          onClose={() => setShowPalette(false)}
        />
      ) : null}

      {showOrgPicker ? (
        <OrgPicker
          client={client}
          currentOrg={org}
          anchorLeft={ORG_HEADER_ANCHOR_LEFT}
          anchorTop={ORG_HEADER_ANCHOR_TOP}
          onSelect={switchOrg}
          onClose={() => setShowOrgPicker(false)}
        />
      ) : null}
    </box>
  );
}

/** The ambient notice: what the screen on screen is doing, in its own words. */
function toNotice(status: ScreenStatus): Notice {
  if (status.error) return { kind: "error", text: status.error };
  if (status.loading) {
    return { kind: "loading", text: status.noun ? `loading ${status.noun}…` : "loading…" };
  }
  return { kind: "idle", text: "" };
}
