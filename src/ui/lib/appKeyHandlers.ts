import type { Group } from "~/api/types";
import { matchesCommand } from "~/core/commands";
import { TRIAGE_ACTIONS } from "~/core/triage";
import type { NavGroup } from "~/core/nav";
import { isDropdownMounted } from "~/ui/components/Dropdown";
import { isFilterBarMounted, type FilterDropdownType } from "~/ui/components/FilterBar";
import { isSortSelectorMounted } from "~/ui/components/SortSelector";
import type { AppRegion, NavigationState } from "~/ui/hooks/useNavigation";
import type { ScreenState } from "~/ui/hooks/useScreenState";
import type { KeyOwnerHandler } from "~/ui/lib/keyRouting";
import type { ScreenActions } from "~/ui/screens/types";

/** Which dropdown each filter command opens. */
export const FILTER_COMMAND_DROPDOWN = {
  "sentry.view.filterProject": "project",
  "sentry.view.filterEnv": "env",
  "sentry.view.filterDate": "date",
} as const satisfies Record<string, Exclude<FilterDropdownType, null>>;

const FILTER_COMMAND_ENTRIES = Object.entries(FILTER_COMMAND_DROPDOWN) as ReadonlyArray<
  [keyof typeof FILTER_COMMAND_DROPDOWN, Exclude<FilterDropdownType, null>]
>;

interface KeyFocus {
  focusedRef: { current: AppRegion };
  isFocused: (region: AppRegion) => boolean;
  focus: (region: AppRegion) => void;
}

interface MutableScreenActions {
  current: ScreenActions | null;
}

export interface AppKeyHandlerOptions {
  showOpenUrl: boolean;
  showPalette: boolean;
  showHelp: boolean;
  showOrgPicker: boolean;
  setShowOpenUrl: (show: boolean) => void;
  setShowPalette: (show: boolean) => void;
  setShowHelp: (show: boolean) => void;
  setShowOrgPicker: (show: boolean) => void;
  navigation: NavigationState;
  state: ScreenState;
  screenActions: MutableScreenActions;
  focus: KeyFocus;
  availableNavGroups: readonly NavGroup[];
  activeIssue?: Group;
  triage: (commandId: string, issue: Group) => void;
  refresh: () => void;
  runUpdate: () => void;
  onQuit: () => void;
}

/** Stop routing at an open modal overlay, closing Help on its own keys. */
export function createOverlayHandler({
  showOpenUrl,
  showPalette,
  showHelp,
  setShowHelp,
}: Pick<
  AppKeyHandlerOptions,
  "showOpenUrl" | "showPalette" | "showHelp" | "setShowHelp"
>): KeyOwnerHandler {
  return (key) => {
    if (showOpenUrl || showPalette) return "focused";
    if (!showHelp) return "notMine";
    if (matchesCommand("sentry.nav.back", key) || matchesCommand("sentry.app.help", key)) {
      setShowHelp(false);
    }
    return "mine";
  };
}

/** Hand mounted dropdowns the keyboard and rescue an orphaned dropdown state. */
export function createDropdownHandler({
  state,
  showOrgPicker,
}: Pick<AppKeyHandlerOptions, "state" | "showOrgPicker">): KeyOwnerHandler {
  return (key) => {
    if (!state.openDropdown && !showOrgPicker && !isDropdownMounted()) return "notMine";
    if (state.openDropdown && !isDropdownMounted() && matchesCommand("sentry.nav.back", key)) {
      state.dispatch({ type: "setOpenDropdown", payload: null });
      return "mine";
    }
    return "focused";
  };
}

/** Open the command palette from any input context. */
export function createPaletteOpenHandler({
  state,
  screenActions,
  setShowPalette,
}: Pick<AppKeyHandlerOptions, "state" | "screenActions" | "setShowPalette">): KeyOwnerHandler {
  return (key) => {
    if (!matchesCommand("sentry.app.commandPalette", key)) return "notMine";
    if (state.searchFocused) state.cancelSearch();
    if (screenActions.current?.inputFocused?.()) screenActions.current.blurInput?.();
    setShowPalette(true);
    return "mine";
  };
}

/** Open the Sentry URL prompt from any input context. */
export function createUrlOpenHandler({
  state,
  screenActions,
  setShowOpenUrl,
}: Pick<AppKeyHandlerOptions, "state" | "screenActions" | "setShowOpenUrl">): KeyOwnerHandler {
  return (key) => {
    if (!matchesCommand("sentry.app.openUrl", key)) return "notMine";
    if (state.searchFocused) state.cancelSearch();
    if (screenActions.current?.inputFocused?.()) screenActions.current.blurInput?.();
    setShowOpenUrl(true);
    return "mine";
  };
}

/** Route keys owned by a screen's private text input. */
export function createScreenInputHandler({
  screenActions,
}: Pick<AppKeyHandlerOptions, "screenActions">): KeyOwnerHandler {
  return (key) => {
    const actions = screenActions.current;
    if (!actions?.inputFocused?.()) return "notMine";
    if (matchesCommand("sentry.nav.back", key)) {
      actions.blurInput?.();
      return "mine";
    }
    if (matchesCommand("sentry.nav.open", key)) {
      return actions.submitInput?.() ? "mine" : "focused";
    }
    if (actions.handleInputKey?.(key)) return "mine";
    if (
      matchesCommand("sentry.app.focusNext", key) ||
      matchesCommand("sentry.app.focusPrev", key)
    ) {
      actions.blurInput?.();
      return "notMine";
    }
    return "focused";
  };
}

/** Route submit, cancel, and text to the app's focused search input. */
export function createSearchHandler({
  state,
}: Pick<AppKeyHandlerOptions, "state">): KeyOwnerHandler {
  return (key) => {
    if (!state.searchFocused) return "notMine";
    if (matchesCommand("sentry.nav.back", key)) {
      state.cancelSearch();
      return "mine";
    }
    if (matchesCommand("sentry.nav.open", key)) {
      state.submitSearch();
      return "mine";
    }
    return "focused";
  };
}

/** Own the two-step goto-mode interaction. */
export function createGotoHandler({
  navigation,
  setShowOrgPicker,
}: Pick<AppKeyHandlerOptions, "navigation" | "setShowOrgPicker">): KeyOwnerHandler {
  return (key) => {
    if (!navigation.gotoMode) {
      if (!matchesCommand("sentry.nav.goto", key)) return "notMine";
      navigation.setNavExpanded(true);
      navigation.setGotoMode(true);
      return "mine";
    }
    if (
      matchesCommand("sentry.nav.goto", key) ||
      matchesCommand("sentry.nav.back", key) ||
      key.ctrl ||
      key.meta ||
      key.shift
    ) {
      navigation.setGotoMode(false);
      return "mine";
    }
    if (matchesCommand("sentry.app.switchOrg", key)) {
      navigation.setGotoMode(false);
      setShowOrgPicker(true);
      return "mine";
    }
    const target = navigation.gotoHotkeys?.byKey.get(key.name.toLowerCase());
    if (target?.kind === "group") {
      navigation.previewNavGroup(target.group);
      return "mine";
    }
    if (target?.kind === "item") {
      navigation.navigateTo(navigation.railGroup, target.item);
      return "mine";
    }
    navigation.setGotoMode(false);
    return "mine";
  };
}

/** Pop the top pushed view when no newer secondary drawer is open. */
export function createViewStackHandler({
  navigation,
}: Pick<AppKeyHandlerOptions, "navigation">): KeyOwnerHandler {
  return (key) => {
    if (!navigation.topView || navigation.showSecondary) return "notMine";
    if (!matchesCommand("sentry.nav.back", key)) return "notMine";
    navigation.popView();
    return "mine";
  };
}

/** Offer Escape to an inline screen panel before app-level navigation. */
export function createScreenBackHandler({
  navigation,
  focus,
  screenActions,
}: Pick<AppKeyHandlerOptions, "navigation" | "focus" | "screenActions">): KeyOwnerHandler {
  return (key) => {
    if (navigation.topView) return "notMine";
    if (focus.focusedRef.current !== "content") return "notMine";
    if (!matchesCommand("sentry.nav.back", key)) return "notMine";
    return screenActions.current?.back?.() ? "mine" : "notMine";
  };
}

/** Close the secondary drawer and return focus to the rail. */
export function createSecondaryNavCloseHandler({
  navigation,
  focus,
}: Pick<AppKeyHandlerOptions, "navigation" | "focus">): KeyOwnerHandler {
  return (key) => {
    if (!navigation.showSecondary || !matchesCommand("sentry.nav.back", key)) return "notMine";
    navigation.setShowSecondary(false);
    focus.focus("nav");
    return "mine";
  };
}

/** Route app-wide commands and focus traversal. */
export function createGlobalCommandHandler({
  navigation,
  state,
  focus,
  setShowHelp,
  setShowOrgPicker,
  refresh,
  runUpdate,
  onQuit,
}: Pick<
  AppKeyHandlerOptions,
  | "navigation"
  | "state"
  | "focus"
  | "setShowHelp"
  | "setShowOrgPicker"
  | "refresh"
  | "runUpdate"
  | "onQuit"
>): KeyOwnerHandler {
  return (key) => {
    if (navigation.listActive && focus.focusedRef.current === "content") {
      for (const [commandId, which] of FILTER_COMMAND_ENTRIES) {
        if (!matchesCommand(commandId, key)) continue;
        if (isFilterBarMounted()) {
          state.dispatch({ type: "setOpenDropdown", payload: which });
        }
        return "mine";
      }
      if (matchesCommand("sentry.view.sort", key) && isSortSelectorMounted()) {
        state.dispatch({ type: "setOpenDropdown", payload: "sort" });
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
      if (!navigation.navExpanded) {
        focus.focus("content");
        return "mine";
      }
      const current = focus.focusedRef.current;
      if (navigation.showSecondary) {
        focus.focus(current === "nav" ? "secondary" : "nav");
      } else {
        focus.focus(current === "nav" ? "content" : "nav");
      }
      return "mine";
    }
    if (matchesCommand("sentry.app.focusPrev", key)) {
      if (!navigation.navExpanded) {
        focus.focus("content");
        return "mine";
      }
      const current = focus.focusedRef.current;
      if (navigation.showSecondary) {
        focus.focus(current === "secondary" ? "nav" : "secondary");
      } else {
        focus.focus(current === "content" ? "nav" : "content");
      }
      return "mine";
    }
    return "notMine";
  };
}

/** Route issue triage keys while the content pane owns focus. */
export function createTriageHandler({
  activeIssue,
  focus,
  triage,
}: Pick<AppKeyHandlerOptions, "activeIssue" | "focus" | "triage">): KeyOwnerHandler {
  return (key) => {
    if (!activeIssue || focus.focusedRef.current !== "content") return "notMine";
    for (const action of TRIAGE_ACTIONS) {
      if (!matchesCommand(action.commandId, key)) continue;
      triage(action.commandId, activeIssue);
      return "mine";
    }
    return "notMine";
  };
}

/** Move and open the primary navigation rail. */
export function createNavRailHandler({
  navigation,
  focus,
  availableNavGroups,
}: Pick<AppKeyHandlerOptions, "navigation" | "focus" | "availableNavGroups">): KeyOwnerHandler {
  return (key) => {
    if (focus.focusedRef.current !== "nav") return "notMine";
    if (matchesCommand("sentry.nav.open", key)) {
      navigation.openNavGroup(navigation.railGroup);
      return "mine";
    }
    const index = availableNavGroups.findIndex((group) => group.id === navigation.railGroup);
    const step = matchesCommand("sentry.nav.down", key)
      ? 1
      : matchesCommand("sentry.nav.up", key)
        ? -1
        : 0;
    if (step === 0) return "notMine";
    const next =
      availableNavGroups[(index + step + availableNavGroups.length) % availableNavGroups.length]!;
    navigation.setRailGroup(next.id);
    return "mine";
  };
}

/** Move and commit the secondary navigation cursor. */
export function createSecondaryNavHandler({
  navigation,
  focus,
}: Pick<AppKeyHandlerOptions, "navigation" | "focus">): KeyOwnerHandler {
  return (key) => {
    if (!navigation.showSecondary || focus.focusedRef.current !== "secondary") return "notMine";
    const index = navigation.secondaryItems.findIndex(
      (item) => item.label === navigation.secondaryItem,
    );
    if (matchesCommand("sentry.nav.open", key)) {
      const item = navigation.secondaryItems[index] ?? navigation.secondaryItems[0];
      if (item) navigation.selectNavItem(item);
      return "mine";
    }
    const step = matchesCommand("sentry.nav.down", key)
      ? 1
      : matchesCommand("sentry.nav.up", key)
        ? -1
        : 0;
    if (step === 0) return "notMine";
    const next = Math.max(0, Math.min(index + step, navigation.secondaryItems.length - 1));
    navigation.setSecondaryItem(navigation.secondaryItems[next]?.label ?? navigation.secondaryItem);
    return "mine";
  };
}

/** Offer keys to a non-list screen body after global and nav commands. */
export function createScreenKeyHandler({
  screenActions,
  focus,
}: Pick<AppKeyHandlerOptions, "screenActions" | "focus">): KeyOwnerHandler {
  return (key) => {
    const actions = screenActions.current;
    if (!actions?.handleKey || !focus.isFocused("content")) return "notMine";
    return actions.handleKey(key) ? "mine" : "notMine";
  };
}

/** Focus the active list's search input. */
export function createSearchFocusHandler({
  navigation,
  state,
  focus,
}: Pick<AppKeyHandlerOptions, "navigation" | "state" | "focus">): KeyOwnerHandler {
  return (key) => {
    if (!navigation.listActive || focus.focusedRef.current !== "content") return "notMine";
    if (!matchesCommand("sentry.nav.search", key)) return "notMine";
    state.focusSearch();
    return "mine";
  };
}

/** Route paging, opening, and cursor movement for the active list. */
export function createListCursorHandler({
  navigation,
  state,
  screenActions,
  focus,
}: Pick<
  AppKeyHandlerOptions,
  "navigation" | "state" | "screenActions" | "focus"
>): KeyOwnerHandler {
  return (key) => {
    if (!navigation.listActive || focus.focusedRef.current !== "content") return "notMine";
    const last = Math.max(0, state.entries.length - 1);
    if (matchesCommand("sentry.nav.pageDown", key)) {
      return screenActions.current?.nextPage?.() ? "mine" : "notMine";
    }
    if (matchesCommand("sentry.nav.pageUp", key)) {
      return screenActions.current?.previousPage?.() ? "mine" : "notMine";
    }
    if (matchesCommand("sentry.nav.open", key)) {
      const open = screenActions.current?.open;
      if (!open) return "notMine";
      open(state.selected);
      return "mine";
    }
    if (matchesCommand("sentry.nav.down", key)) {
      state.dispatch({
        type: "setSelected",
        payload: (index) => Math.min(index + 1, last),
      });
      return "mine";
    }
    if (matchesCommand("sentry.nav.up", key)) {
      state.dispatch({
        type: "setSelected",
        payload: (index) => Math.max(index - 1, 0),
      });
      return "mine";
    }
    if (matchesCommand("sentry.nav.top", key)) {
      state.dispatch({ type: "setSelected", payload: 0 });
      return "mine";
    }
    if (matchesCommand("sentry.nav.bottom", key)) {
      state.dispatch({ type: "setSelected", payload: last });
      return "mine";
    }
    return "notMine";
  };
}

/** Build the app's ownership chain in its precedence order. */
export function createAppKeyHandlers(options: AppKeyHandlerOptions): readonly KeyOwnerHandler[] {
  return [
    createOverlayHandler(options),
    createDropdownHandler(options),
    createPaletteOpenHandler(options),
    createUrlOpenHandler(options),
    createScreenInputHandler(options),
    createSearchHandler(options),
    createGotoHandler(options),
    createViewStackHandler(options),
    createScreenBackHandler(options),
    createSecondaryNavCloseHandler(options),
    createGlobalCommandHandler(options),
    createTriageHandler(options),
    createNavRailHandler(options),
    createSecondaryNavHandler(options),
    createScreenKeyHandler(options),
    createSearchFocusHandler(options),
    createListCursorHandler(options),
  ];
}
