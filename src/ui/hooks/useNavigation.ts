import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { SentryClient } from "~/api/client";
import type { Group } from "~/api/types";
import { buildGotoHotkeys, type GotoHotkeys } from "~/core/goto";
import { getNavGroup, soleNavItem, type NavGroup, type NavGroupId } from "~/core/nav";
import { findScreen, getScreen, stateKeyOf, type ScreenDef, type ScreenId } from "~/core/screens";
import { breadcrumbTrail } from "~/lib/breadcrumb";
import { detailBackWidth } from "~/ui/components/DetailBackRow";
import { COLLAPSED_NAV_RAIL_WIDTH, NAV_RAIL_WIDTH } from "~/ui/components/NavRail";
import { SECONDARY_NAV_WIDTH } from "~/ui/components/SecondaryNav";
import { useScreenState, type ScreenState, type ScreenStateSeed } from "~/ui/hooks/useScreenState";
import { useSecondaryNavExtras } from "~/ui/hooks/useSecondaryNavExtras";
import {
  navItemsFor,
  navTargetOf,
  type NavItemSpec,
  type SecondaryNavExtras,
} from "~/ui/lib/navSections";
import { SCREEN_COMPONENTS } from "~/ui/screens/registry";
import type { ScreenComponent, ViewStackEntry } from "~/ui/screens/types";
import type { SentryUrlLocation } from "~/core/sentryUrl";
import { viewForSentryUrl } from "~/ui/sentryUrl";

/** Cells consumed around the breadcrumb by the pane border and its padding. */
const BREADCRUMB_CHROME_WIDTH = 4;

/** Focusable regions in their keyboard traversal order. */
export const APP_REGIONS = ["nav", "secondary", "content"] as const;
export type AppRegion = (typeof APP_REGIONS)[number];

/** The focus operations navigation needs without coupling to a hook implementation. */
export interface NavigationFocus {
  focusedRef: { current: AppRegion };
  focus: (region: AppRegion) => void;
}

export interface UseNavigationOptions {
  client: SentryClient | null;
  org: string;
  reloadToken: number;
  width: number;
  initialScreen: ScreenId;
  initialLocation?: SentryUrlLocation;
  initialSelectedProjects?: readonly string[];
  availableNavGroups: readonly NavGroup[];
  focus: NavigationFocus;
  canOpen: boolean;
}

export interface NavigationState {
  railGroup: NavGroupId;
  setRailGroup: Dispatch<SetStateAction<NavGroupId>>;
  activeGroup: NavGroupId;
  activeItem: string;
  navExpanded: boolean;
  setNavExpanded: Dispatch<SetStateAction<boolean>>;
  showSecondary: boolean;
  setShowSecondary: Dispatch<SetStateAction<boolean>>;
  showSecondaryPane: boolean;
  secondaryItem: string;
  setSecondaryItem: Dispatch<SetStateAction<string>>;
  gotoMode: boolean;
  setGotoMode: Dispatch<SetStateAction<boolean>>;
  viewStack: readonly ViewStackEntry[];
  topView?: ViewStackEntry;
  detailView?: ViewStackEntry;
  listActive: boolean;
  screen?: ScreenDef;
  ScreenComponent?: ScreenComponent;
  state: ScreenState;
  resetOrgScoped: (selectedProjects?: readonly string[]) => void;
  seed: (key: string, values: ScreenStateSeed) => void;
  navExtras: SecondaryNavExtras;
  secondaryItems: readonly NavItemSpec[];
  gotoHotkeys: GotoHotkeys | null;
  contentWidth: number;
  breadcrumb?: string;
  backTarget: string;
  statusHints: ReadonlyArray<{ command: string; label?: string }>;
  navigateTo: (group: NavGroupId, item: string) => void;
  navigateToScreen: (screenId: ScreenId, initialState?: ScreenStateSeed) => void;
  openNavGroup: (group: NavGroupId) => void;
  expandNav: () => void;
  selectNavItem: (item: NavItemSpec) => void;
  previewNavGroup: (group: NavGroupId) => void;
  pushView: (view: ViewStackEntry) => void;
  popView: () => void;
  clearViews: () => void;
  updateView: (id: string, update: { label?: string; issue?: Group }) => void;
  replaceIssue: (next: Group) => void;
}

/**
 * Own the route, view stack, keyed screen slice, and every transition between
 * navigation surfaces.
 */
export function useNavigation({
  client,
  org,
  reloadToken,
  width,
  initialScreen,
  initialLocation,
  initialSelectedProjects = [],
  availableNavGroups,
  focus,
  canOpen,
}: UseNavigationOptions): NavigationState {
  const initial = getScreen(initialLocation?.screen ?? initialScreen);
  const [railGroup, setRailGroup] = useState<NavGroupId>(initial.group);
  const [activeGroup, setActiveGroup] = useState<NavGroupId>(initial.group);
  const [activeItem, setActiveItem] = useState(initial.item);
  const [navExpanded, setNavExpanded] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);
  const [secondaryItem, setSecondaryItem] = useState(initial.item);
  const [gotoMode, setGotoMode] = useState(false);
  const [initialView] = useState(() =>
    viewForSentryUrl(initialLocation?.detail, initialLocation?.state),
  );
  const [viewStack, setViewStack] = useState<readonly ViewStackEntry[]>(() =>
    initialView ? [initialView] : [],
  );

  const screen = findScreen(activeGroup, activeItem);
  const ScreenComponent = screen ? SCREEN_COMPONENTS[screen.id] : undefined;
  const topView = viewStack.at(-1);
  const detailView = topView && !topView.stateKey ? topView : undefined;
  const listActive = !detailView && (ScreenComponent !== undefined || topView !== undefined);
  const activeKey =
    [...viewStack].reverse().find((view) => view.stateKey)?.stateKey ??
    (screen ? stateKeyOf(screen) : undefined);
  const {
    active: state,
    resetOrgScoped,
    seed,
  } = useScreenState(
    activeKey,
    initialSelectedProjects,
    initialView?.stateKey ? initialView.initialState : initialLocation?.state,
  );

  const navExtras = useSecondaryNavExtras(client, org, railGroup, reloadToken);
  const secondaryItems = useMemo(() => navItemsFor(railGroup, navExtras), [railGroup, navExtras]);

  /** Push a view after initializing the state slice it carries, if any. */
  const pushView = useCallback(
    (view: ViewStackEntry) => {
      if (view.stateKey && view.initialState) seed(view.stateKey, view.initialState);
      setViewStack((stack) => [...stack, view]);
    },
    [seed],
  );

  /** Merge metadata learned after a URL-addressed detail has loaded. */
  const updateView = useCallback((id: string, update: { label?: string; issue?: Group }) => {
    setViewStack((stack) => stack.map((view) => (view.id === id ? { ...view, ...update } : view)));
  }, []);

  /** Remove the topmost pushed view. */
  const popView = useCallback(() => setViewStack((stack) => stack.slice(0, -1)), []);

  /** Return to the active top-level screen. */
  const clearViews = useCallback(() => setViewStack([]), []);

  /** Show a group's item in the content pane through the canonical route. */
  const navigateTo = useCallback(
    (group: NavGroupId, item: string) => {
      setGotoMode(false);
      setRailGroup(group);
      setActiveGroup(group);
      setActiveItem(item);
      setSecondaryItem(item);
      setNavExpanded(false);
      setShowSecondary(false);
      setViewStack([]);
      state.setDetailOpen(false);
      focus.focus("content");
    },
    [focus, state.setDetailOpen],
  );

  /** Navigate to a registered screen from inside another screen. */
  const navigateToScreen = useCallback(
    (screenId: ScreenId, initialState?: ScreenStateSeed) => {
      const target = getScreen(screenId);
      if (!availableNavGroups.some((group) => group.id === target.group)) return;
      if (initialState) seed(stateKeyOf(target), initialState);
      navigateTo(target.group, target.item);
    },
    [availableNavGroups, navigateTo, seed],
  );

  /** Open a rail group, skipping a redundant secondary pane for one-item groups. */
  const openNavGroup = useCallback(
    (group: NavGroupId) => {
      const sole = soleNavItem(getNavGroup(group));
      if (sole !== undefined) {
        navigateTo(group, sole);
        return;
      }
      setGotoMode(false);
      setRailGroup(group);
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

  /** Commit a static or dynamic secondary-nav item. */
  const selectNavItem = useCallback(
    (item: NavItemSpec) => {
      const target = navTargetOf(railGroup, item);
      navigateTo(target.group, target.item);
      const view = item.open?.();
      if (view) pushView(view);
    },
    [railGroup, navigateTo, pushView],
  );

  const gotoHotkeys = useMemo(
    () => (gotoMode ? buildGotoHotkeys(railGroup, availableNavGroups) : null),
    [gotoMode, railGroup, availableNavGroups],
  );

  /** Point goto mode at a group, or complete the jump for a one-item group. */
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

  /** Keep optimistic issue edits consistent in the list and every open view. */
  const replaceIssue = useCallback(
    (next: Group) => {
      state.setEntries((rows) => {
        const groups = rows as readonly Group[];
        return groups.some((row) => row?.id === next.id)
          ? groups.map((row) => (row?.id === next.id ? next : row))
          : rows;
      });
      setViewStack((stack) =>
        stack.map((view) => (view.issue?.id === next.id ? { ...view, issue: next } : view)),
      );
    },
    [state.setEntries],
  );

  const showSecondaryPane = showSecondary || gotoMode;
  const secondaryWidth = showSecondaryPane ? SECONDARY_NAV_WIDTH : 0;
  const railWidth = navExpanded ? NAV_RAIL_WIDTH : COLLAPSED_NAV_RAIL_WIDTH;
  const contentWidth = Math.max(20, width - railWidth - secondaryWidth - 2);
  const backTarget = viewStack.at(-2)?.label ?? activeItem;
  const breadcrumb = useMemo(() => {
    if (viewStack.length === 0) return undefined;
    const trail = breadcrumbTrail(
      [getNavGroup(activeGroup).label, activeItem, ...viewStack.map((view) => view.label)],
      Math.max(
        0,
        contentWidth - BREADCRUMB_CHROME_WIDTH - detailBackWidth(backTarget, contentWidth),
      ),
    );
    return trail ? ` ${trail} ` : undefined;
  }, [viewStack, activeGroup, activeItem, contentWidth, backTarget]);

  const statusHints = useMemo(() => {
    if (gotoMode) return [{ command: "sentry.nav.back", label: "cancel" }];
    if (state.searchFocused) {
      return [
        { command: "sentry.nav.open", label: "submit" },
        { command: "sentry.nav.back", label: "cancel" },
      ];
    }

    const back = topView ? [{ command: "sentry.nav.back", label: "back" }] : [];
    const list = detailView
      ? []
      : [
          ...(canOpen
            ? [
                {
                  command: "sentry.nav.open",
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
      ...(topView ? [] : [{ command: "sentry.app.quit", label: "quit" }]),
    ];
  }, [gotoMode, state.searchFocused, state.detailOpen, topView, detailView, screen, canOpen]);

  return {
    railGroup,
    setRailGroup,
    activeGroup,
    activeItem,
    navExpanded,
    setNavExpanded,
    showSecondary,
    setShowSecondary,
    showSecondaryPane,
    secondaryItem,
    setSecondaryItem,
    gotoMode,
    setGotoMode,
    viewStack,
    topView,
    detailView,
    listActive,
    screen,
    ScreenComponent,
    state,
    resetOrgScoped,
    seed,
    navExtras,
    secondaryItems,
    gotoHotkeys,
    contentWidth,
    breadcrumb,
    backTarget,
    statusHints,
    navigateTo,
    navigateToScreen,
    openNavGroup,
    expandNav,
    selectNavItem,
    previewNavGroup,
    pushView,
    popView,
    clearViews,
    updateView,
    replaceIssue,
  };
}
