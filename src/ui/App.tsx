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
import { findScreen, getScreen, stateKeyOf, type ScreenId } from "~/core/screens";
import {
  parseSentryUrl,
  recordSentryUrlFailure,
  type SentryUrlFailure,
  type SentryUrlLocation,
} from "~/core/sentryUrl";
import { useTheme } from "~/ui/theme";
import { findTriageAction, TRIAGE_ACTIONS } from "~/core/triage";
import { breadcrumbTrail } from "~/lib/breadcrumb";
// Aliased: `breadcrumb` is taken in this file by the trail rendered in the
// pane's border title, which is a different thing entirely.
import { breadcrumb as leaveCrumb, identify, log } from "~/telemetry/index";
import { CommandPalette } from "~/ui/components/CommandPalette";
import { DetailBackRow, detailBackWidth } from "~/ui/components/DetailBackRow";
import { isDropdownMounted } from "~/ui/components/Dropdown";
import { isFilterBarMounted, type FilterDropdownType } from "~/ui/components/FilterBar";
import { HelpDialog } from "~/ui/components/HelpDialog";
import { OpenSentryUrlDialog } from "~/ui/components/OpenSentryUrlDialog";
import {
  COLLAPSED_NAV_RAIL_WIDTH,
  NavRail,
  NAV_RAIL_WIDTH,
  ORG_HEADER_ANCHOR_LEFT,
  ORG_HEADER_ANCHOR_TOP,
} from "~/ui/components/NavRail";
import { OrgPicker } from "~/ui/components/OrgPicker";
import { SecondaryNav, SECONDARY_NAV_WIDTH } from "~/ui/components/SecondaryNav";
import { isSortSelectorMounted } from "~/ui/components/SortSelector";
import { StatusBar, type Notice } from "~/ui/components/StatusBar";
import { useFocusRing } from "~/ui/hooks/useFocusRing";
import { useNavigationTrace } from "~/ui/hooks/useNavigationTrace";
import { SeerChatContext, useSeerChat } from "~/ui/hooks/useSeerChat";
import { useUpdateCheck } from "~/ui/hooks/useUpdateCheck";
import { rowsOf, useScreenState, type ScreenStatus } from "~/ui/hooks/useScreenState";
import { useSecondaryNavExtras } from "~/ui/hooks/useSecondaryNavExtras";
import { useTriage } from "~/ui/hooks/useTriage";
import { navItemsFor, navTargetOf, type NavItemSpec } from "~/ui/lib/navSections";
import { SCREEN_COMPONENTS } from "~/ui/screens/registry";
import type { ScreenActions, ViewStackEntry } from "~/ui/screens/types";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";
import { viewForSentryUrl } from "~/ui/sentryUrl";

/**
 * Cells the pane's frame costs a border title: one border cell each side, plus
 * the space the title is padded with so it doesn't butt against the corners.
 */
const BREADCRUMB_CHROME_WIDTH = 4;

const REGIONS = ["nav", "secondary", "content"] as const;
type Region = (typeof REGIONS)[number];

export interface AppProps {
  onQuit: () => void;
  client?: SentryClient | null;
  org?: string;
  /**
   * Screen to open on, instead of Issues › Feed.
   *
   * Tests use this to start on the screen under test. Walking the rail costs a
   * render pass per keystroke, and at ~29ms each that dwarfed the assertions.
   */
  initialScreen?: ScreenId;
  /** Parsed CLI destination, including filters and an optional detail. */
  initialLocation?: SentryUrlLocation;
  /** Remembered project selections, keyed by organization slug. */
  initialProjectsByOrg?: Readonly<Record<string, readonly string[]>>;
  /**
   * Hand the terminal to a newly downloaded build and exit.
   *
   * Owned by `runApp`, which has to tear the renderer down before the exec.
   * Absent — as in every test that does not pass one — means the update pill
   * never appears, so nothing can offer a restart it cannot perform.
   */
  onRestart?: (binaryPath: string) => void;
}

/**
 * Which dropdown each filter command opens.
 *
 * One table for both routes to them — the command palette and the bare key —
 * so the two cannot come to disagree about what `P` means or about which of
 * them checks for a filter row first.
 */
const FILTER_COMMAND_DROPDOWN = {
  "sentry.view.filterProject": "project",
  "sentry.view.filterEnv": "env",
  "sentry.view.filterDate": "date",
} as const satisfies Record<string, Exclude<FilterDropdownType, null>>;

const FILTER_COMMAND_ENTRIES = Object.entries(FILTER_COMMAND_DROPDOWN) as ReadonlyArray<
  [keyof typeof FILTER_COMMAND_DROPDOWN, Exclude<FilterDropdownType, null>]
>;

/** Issues › Feed — where the app opens when nothing says otherwise. */
const DEFAULT_SCREEN: ScreenId = "issues.feed";

export function App({
  onQuit,
  client = null,
  org: initialOrg = "",
  initialScreen = DEFAULT_SCREEN,
  initialLocation,
  initialProjectsByOrg = {},
  onRestart,
}: AppProps) {
  const theme = useTheme();
  const { width, height } = useTerminalDimensions();

  const [projectsByOrg, setProjectsByOrg] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      Object.entries(initialProjectsByOrg).map(([slug, projects]) => [slug, [...projects]]),
    ),
  );
  const projectsByOrgRef = useRef(projectsByOrg);

  // The open organization. Sourced from the CLI at startup, then owned here so
  // the picker can repoint every screen at once — every fetch in the tree takes
  // it as a dependency.
  const [org, setOrg] = useState(initialLocation?.org ?? initialOrg);

  // Rail cursor: which group is highlighted on the nav rail.
  const initial = getScreen(initialLocation?.screen ?? initialScreen);

  const [railGroup, setRailGroup] = useState<NavGroupId>(initial.group);

  // Active selection: what the content pane renders.
  const [activeGroup, setActiveGroup] = useState<NavGroupId>(initial.group);
  const [activeItem, setActiveItem] = useState(initial.item);

  // Primary nav labels start hidden; secondary nav appears after opening a group.
  const [navExpanded, setNavExpanded] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);
  const [secondaryItem, setSecondaryItem] = useState(initial.item);

  // Goto mode: both nav panes on screen with a key printed on every
  // destination, so a jump anywhere is two keystrokes and no cursor work.
  const [gotoMode, setGotoMode] = useState(false);

  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showOpenUrl, setShowOpenUrl] = useState(false);
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
  const [initialView] = useState(() =>
    viewForSentryUrl(initialLocation?.detail, initialLocation?.state),
  );
  const [viewStack, setViewStack] = useState<readonly ViewStackEntry[]>(() =>
    initialView ? [initialView] : [],
  );
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
  const {
    active: state,
    resetOrgScoped,
    seed,
  } = useScreenState(
    activeKey,
    projectsByOrg[org] ?? [],
    initialView?.stateKey ? initialView.initialState : initialLocation?.state,
  );

  /** Apply a dropdown selection and remember it as this organization's default. */
  const selectProjects = useCallback(
    (projects: string[]) => {
      state.setSelectedProjects(projects);

      const next = { ...projectsByOrgRef.current, [org]: [...projects] };
      projectsByOrgRef.current = next;
      setProjectsByOrg(next);
      void writeConfig({ projectsByOrg: next }).catch(() => {
        // A read-only config dir should not undo the selection on screen.
      });
    },
    [org, state.setSelectedProjects],
  );

  useNavigationTrace(activeGroup, activeItem, state.status.loading);

  // Seer's conversation outlives its screen: navigating to Issues and back is
  // not a reason to lose the transcript. The hook is inert until the first
  // message, so it costs nothing while the user is anywhere else.
  const seerChat = useSeerChat(client, org);

  // What Enter means on the screen that is mounted, registered by the screen
  // itself. Held in a ref because the key router reads it during a keystroke,
  // not during a render.
  const screenActions = useRef<ScreenActions | null>(null);
  /**
   * Whether the mounted screen has told us what Enter does.
   *
   * The ref above is what the *router* reads, during a keystroke rather than
   * during a render. The status bar is drawn from state, so it needs this
   * mirror: without it the bar printed `(enter) open` for every screen, having
   * never checked that anything was listening — which was a lie on the stub
   * screens and on any list that had not registered an action yet.
   *
   * `useScreenActions` re-registers on every render and clears on unmount, so
   * this flips within a commit rather than across renders, and React collapses
   * the pair into no re-render when the answer has not changed.
   */
  const [canOpen, setCanOpen] = useState(false);
  const registerActions = useCallback((actions: ScreenActions | null) => {
    screenActions.current = actions;
    setCanOpen(Boolean(actions?.open));
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

  /** Merge metadata learned after a URL-addressed detail has loaded. */
  const updateView = useCallback((id: string, update: { label?: string; issue?: Group }) => {
    setViewStack((stack) => stack.map((view) => (view.id === id ? { ...view, ...update } : view)));
  }, []);

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
      resetOrgScoped(projectsByOrgRef.current[slug] ?? []);
      showNotice({ kind: "info", text: `switched to ${slug}` });

      // Retag, so an error after this points at the org actually on screen.
      identify({ org: slug });
      leaveCrumb({ category: "navigation", message: `switched org to ${slug}` });
      log("info", "ui.org.switched", { org: slug });

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

  // Dynamic nav sections (starred queries, starred dashboards). Empty until
  // something supplies them; the cursor and the click handler already walk
  // whatever arrives.
  const navExtras = useSecondaryNavExtras(client, org, railGroup, reloadToken);
  const secondaryItems = useMemo(() => navItemsFor(railGroup, navExtras), [railGroup, navExtras]);

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
      setNavExpanded(false);
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

  /** Apply a parsed URL through the same navigation and view-stack paths as the UI. */
  const openSentryLocation = useCallback(
    (location: SentryUrlLocation) => {
      const target = getScreen(location.screen);
      if (location.org !== org) switchOrg(location.org);
      navigateTo(target.group, target.item);

      const view = viewForSentryUrl(location.detail, location.state);
      if (view) {
        // Stateless details leave their filters on the list underneath them;
        // stateful ones carry the seed on the view itself.
        if (!view.stateKey && location.state) seed(stateKeyOf(target), location.state);
        pushView(view);
      } else if (location.state) {
        seed(stateKeyOf(target), location.state);
      }
    },
    [navigateTo, org, pushView, seed, switchOrg],
  );

  /** Parse one dialog submission, keeping expected failures inside the dialog. */
  const submitSentryUrl = useCallback(
    (url: string): SentryUrlFailure | undefined => {
      const result = parseSentryUrl(url);
      if (result.kind !== "location") {
        recordSentryUrlFailure(result, "command_palette");
        return result;
      }
      openSentryLocation(result.location);
      setShowOpenUrl(false);
      return undefined;
    },
    [openSentryLocation],
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

  /** Restore the labeled rail without choosing a destination. */
  const expandNav = useCallback(() => {
    setNavExpanded(true);
    focus.focus("nav");
  }, [focus]);

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

  // A newer build sitting in the cache, if there is one. Undefined the whole
  // time for anyone the launcher did not start — see `canSelfUpdate`.
  const pendingUpdate = useUpdateCheck();
  const updateReady = Boolean(pendingUpdate && onRestart);

  /**
   * Restart into the downloaded build, or say why there is nothing to do.
   *
   * No success notice: `onRestart` tears the renderer down and hands the
   * terminal over, so anything written here would be painted and dropped in
   * the same frame. `runApp` prints the line that covers the gap instead.
   */
  const runUpdate = useCallback(() => {
    if (!pendingUpdate || !onRestart) {
      // Short on purpose: the hints row owns the other end of the bar, and at
      // 100 cells anything longer than this is clipped mid-word.
      showNotice({ kind: "idle", text: "already up to date" });
      return;
    }
    onRestart(pendingUpdate.path);
  }, [pendingUpdate, onRestart, showNotice]);

  const paletteActions = useMemo(
    () =>
      buildPaletteActions({
        streamView: listActive,
        hasIssue: Boolean(activeIssue),
        updateReady,
      }),
    [listActive, activeIssue, updateReady],
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
        case "sentry.app.openUrl":
          setShowOpenUrl(true);
          return;
        case "sentry.app.update":
          runUpdate();
          return;
        case "sentry.nav.search":
          focus.focus("content");
          state.focusSearch();
          return;
        // Only a screen with a filter row can close what these open, so on one
        // without, they do nothing at all. See `isFilterBarMounted`.
        case "sentry.view.filterProject":
        case "sentry.view.filterEnv":
        case "sentry.view.filterDate": {
          if (!isFilterBarMounted()) return;
          focus.focus("content");
          state.setOpenDropdown(FILTER_COMMAND_DROPDOWN[commandId]);
          return;
        }
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
        // 0. The URL prompt owns the keyboard while its input is focused.
        () => (showOpenUrl ? "focused" : "notMine"),
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
        // 1b. Dropdowns swallow keys while open — the Dropdown component
        // handles its own navigation via a separate useKeyboard. Returning
        // "focused" stops this routing chain so later handlers (e.g. the list
        // cursor) don't steal j/k, while still letting the Dropdown's global
        // listener fire.
        //
        // Mounted, not just "the app set the state": Explore's query builder
        // opens its own menus from the screen rather than through
        // `openDropdown`, and a menu the app didn't open still owns the
        // keyboard for as long as it is on screen.
        () => {
          if (!state.openDropdown && !showOrgPicker && !isDropdownMounted()) return "notMine";
          // Rescue an *orphaned* dropdown — the second line of defence, not
          // the first. The filter keys no longer open one on a screen with no
          // filter row (see `isFilterBarMounted`), so the way left to strand
          // the state is for a filter row to unmount while its dropdown is
          // open, on a screen sharing that slice. With nothing mounted,
          // "focused" ends the chain before any handler can clear the state,
          // and the app stops answering the keyboard. A mounted dropdown is
          // left alone: it owns a two-stage Escape (clear the filter, then
          // close) that this would otherwise short-circuit.
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
        // 1d. Opening a URL is global too, including while a text input owns
        // focus. A modifier chord cannot be useful input in either field.
        () => {
          if (!matchesCommand("sentry.app.openUrl", key)) return "notMine";
          if (state.searchFocused) state.cancelSearch();
          if (screenActions.current?.inputFocused?.()) screenActions.current.blurInput?.();
          setShowOpenUrl(true);
          return "mine";
        },
        // 1e. A screen's own text input — Seer's composer — owns Enter (send)
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
            setNavExpanded(true);
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
        // 3. The pushed view owns Escape (back) before anything else claims it
        // — unless the secondary drawer is open over it. Escape undoes the most
        // recent thing the user opened, and while the drawer is up that is the
        // drawer, not the view underneath it.
        () => {
          if (!topView) return "notMine";
          if (showSecondary) return "notMine";
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
          // ...and only to one that has a filter row to show. Without that
          // guard these open a dropdown nothing can close: see
          // `isFilterBarMounted`. Claimed either way, so the key does not fall
          // through to some unrelated handler on screens without one.
          if (listActive && focus.focusedRef.current === "content") {
            for (const [commandId, which] of FILTER_COMMAND_ENTRIES) {
              if (!matchesCommand(commandId, key)) continue;
              if (isFilterBarMounted()) state.setOpenDropdown(which);
              return "mine";
            }
            if (matchesCommand("sentry.view.sort", key) && isSortSelectorMounted()) {
              state.setOpenDropdown("sort");
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
          if (matchesCommand("sentry.app.update", key)) {
            runUpdate();
            return "mine";
          }
          if (matchesCommand("sentry.app.quit", key)) {
            onQuit();
            return "mine";
          }
          if (matchesCommand("sentry.app.focusNext", key)) {
            if (!navExpanded) {
              focus.focus("content");
              return "mine";
            }
            const cur = focus.focusedRef.current;
            if (showSecondary) {
              focus.focus(cur === "nav" ? "secondary" : "nav");
            } else {
              focus.focus(cur === "nav" ? "content" : "nav");
            }
            return "mine";
          }
          if (matchesCommand("sentry.app.focusPrev", key)) {
            if (!navExpanded) {
              focus.focus("content");
              return "mine";
            }
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
          // Triage belongs to the content pane, in the detail view as much as
          // in the list: the nav panes are live over an open issue now, and a
          // rail cursor is no place to resolve from.
          if (focus.focusedRef.current !== "content") return "notMine";
          for (const action of TRIAGE_ACTIONS) {
            if (matchesCommand(action.commandId, key)) {
              triage.run(action.commandId, activeIssue);
              return "mine";
            }
          }
          return "notMine";
        },
        // 7. Nav rail: j/k moves the cursor, Enter opens secondary nav. Live
        // whenever the expanded rail holds focus, a pushed view included — a
        // focused pane that answers nothing is indistinguishable from a hung app.
        () => {
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
        // Live over a pushed view for the same reason the rail is; choosing an
        // item goes through `navigateTo`, which clears the stack.
        () => {
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
  const railWidth = navExpanded ? NAV_RAIL_WIDTH : COLLAPSED_NAV_RAIL_WIDTH;
  const contentWidth = Math.max(20, width - railWidth - secondaryWidth - 2);
  const contentHeight = Math.max(3, height - 3);

  /**
   * Where Escape lands from the view on top: the view beneath it, else the
   * screen the stack was pushed from. Named rather than left as "back" so the
   * control says what it costs to press.
   */
  const backTarget = viewStack.at(-2)?.label ?? activeItem;

  /**
   * The trail printed in the pane's border while a view is open — the app's
   * answer to "how deep am I?", kept out of the content's way. Absent at the
   * top level, where the screen's own heading already says where you are and a
   * second copy would only be noise.
   *
   * The renderer draws a border title as one flat string, so it is clamped here
   * rather than left to overrun the frame in a narrow terminal.
   */
  const breadcrumb = useMemo(() => {
    if (viewStack.length === 0) return undefined;
    const trail = breadcrumbTrail(
      [getNavGroup(activeGroup).label, activeItem, ...viewStack.map((view) => view.label)],
      // The back control shares this border, hard against the other end.
      Math.max(
        0,
        contentWidth - BREADCRUMB_CHROME_WIDTH - detailBackWidth(backTarget, contentWidth),
      ),
    );
    return trail ? ` ${trail} ` : undefined;
  }, [viewStack, activeGroup, activeItem, contentWidth, backTarget]);

  /**
   * The status bar's key row, for whatever the app is in the middle of.
   *
   * Escape leads it whenever there is a stack to pop. That used to hold only
   * for a static detail pane, which left an opened saved query or dashboard
   * printing the ordinary list hints and no way out at all — the one control in
   * the app you had to already know about to find.
   */
  const statusHints = useMemo(() => {
    if (gotoMode) return [{ command: "sentry.nav.back", label: "cancel" }];
    if (state.searchFocused) {
      return [
        { command: "sentry.nav.open", label: "submit" },
        { command: "sentry.nav.back", label: "cancel" },
      ];
    }

    const back = topView ? [{ command: "sentry.nav.back", label: "back" }] : [];
    // A static detail pane has no cursor and no search box, so neither hint
    // would mean anything on it.
    const list = detailView
      ? []
      : [
          // Only when the screen has said what Enter does. A hint for a key
          // that does nothing is worse than no hint: it reads as the app
          // ignoring you.
          ...(canOpen
            ? [
                {
                  command: "sentry.nav.open",
                  // Enter toggles a panel on some screens, so the one hint
                  // carries both directions.
                  label: state.detailOpen ? "close" : (screen?.openLabel ?? "open"),
                },
              ]
            : []),
          { command: "sentry.nav.search", label: "search" },
        ];

    return [
      ...back,
      ...list,
      { command: "sentry.nav.goto", label: "nav" },
      { command: "sentry.app.commandPalette", label: "commands" },
      { command: "sentry.app.help", label: "help" },
      // Quit yields its place to `back` rather than pushing the row past the
      // width of a small terminal. `q` still quits; it just stops being the
      // hint worth spending the cells on once there is somewhere to go back to.
      ...(topView ? [] : [{ command: "sentry.app.quit", label: "quit" }]),
    ];
  }, [
    gotoMode,
    state.searchFocused,
    state.detailOpen,
    topView,
    detailView,
    screen?.openLabel,
    canOpen,
  ]);

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
    onProjectSelect: selectProjects,
    pendingIds: triage.pending,
    pushView,
    notify: showNotice,
    activateRow,
    registerActions,
    updateView,
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
          expanded={navExpanded}
          focused={focus.isFocused("nav")}
          avatarUrl={avatarUrl}
          orgSlug={org}
          hotkeys={gotoHotkeys?.groups}
          onSelect={openNavGroup}
          onExpand={expandNav}
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
          title={breadcrumb}
          titleColor={theme.accent}
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
        {/*
          Drawn over the pane's top border, opposite the trail in its title.
          A sibling of the pane rather than a child: the pane clips its
          overflow, and this deliberately lands on the frame itself.
        */}
        {topView ? (
          <DetailBackRow parent={backTarget} top={0} right={width - 1} paneWidth={contentWidth} />
        ) : null}
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
        since={detailView || gotoMode ? undefined : state.status.since}
        hints={statusHints}
        onUpdate={updateReady ? runUpdate : undefined}
      />

      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}

      {showPalette ? (
        <CommandPalette
          actions={paletteActions}
          onRun={runPaletteAction}
          onClose={() => setShowPalette(false)}
        />
      ) : null}

      {showOpenUrl ? (
        <OpenSentryUrlDialog onSubmit={submitSentryUrl} onClose={() => setShowOpenUrl(false)} />
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
