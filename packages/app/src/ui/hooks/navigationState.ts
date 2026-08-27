import type { Group } from "~/api/types";
import type { NavGroupId } from "~/core/nav";
import type { ViewStackEntry } from "~/ui/screens/types";

/** The coordinated route, drawer, and pushed-view state owned by navigation. */
export interface NavigationModel {
  railGroup: NavGroupId;
  activeGroup: NavGroupId;
  activeItem: string;
  navExpanded: boolean;
  showSecondary: boolean;
  secondaryItem: string;
  gotoMode: boolean;
  viewStack: readonly ViewStackEntry[];
}

/** Every atomic transition supported by the navigation state machine. */
export type NavigationAction =
  | { type: "navigate"; group: NavGroupId; item: string }
  | { type: "openGroup"; group: NavGroupId; item: string }
  | { type: "expandNav" }
  | { type: "openGoto" }
  | { type: "closeGoto" }
  | { type: "previewGroup"; group: NavGroupId; item: string }
  | { type: "selectRailGroup"; group: NavGroupId }
  | { type: "closeSecondary" }
  | { type: "selectSecondaryItem"; item: string }
  | { type: "pushView"; view: ViewStackEntry }
  | { type: "popView" }
  | { type: "clearViews" }
  | { type: "updateView"; id: string; update: { label?: string; issue?: Group } }
  | { type: "replaceIssue"; issue: Group };

/** Build the navigation state used on the first render. */
export function initialNavigationModel(
  group: NavGroupId,
  item: string,
  initialViews: readonly ViewStackEntry[] = [],
): NavigationModel {
  return {
    railGroup: group,
    activeGroup: group,
    activeItem: item,
    navExpanded: false,
    showSecondary: false,
    secondaryItem: item,
    gotoMode: false,
    viewStack: [...initialViews],
  };
}

/** Apply one navigation transition without side effects. */
export function navigationReducer(
  state: NavigationModel,
  action: NavigationAction,
): NavigationModel {
  switch (action.type) {
    case "navigate":
      return {
        ...state,
        railGroup: action.group,
        activeGroup: action.group,
        activeItem: action.item,
        navExpanded: false,
        showSecondary: false,
        secondaryItem: action.item,
        gotoMode: false,
        viewStack: [],
      };
    case "openGroup":
      return {
        ...state,
        railGroup: action.group,
        showSecondary: true,
        secondaryItem: action.item,
        gotoMode: false,
      };
    case "expandNav":
      return state.navExpanded ? state : { ...state, navExpanded: true };
    case "openGoto":
      return { ...state, navExpanded: true, gotoMode: true };
    case "closeGoto":
      return state.gotoMode ? { ...state, gotoMode: false } : state;
    case "previewGroup":
      return { ...state, railGroup: action.group, secondaryItem: action.item };
    case "selectRailGroup":
      return state.railGroup === action.group ? state : { ...state, railGroup: action.group };
    case "closeSecondary":
      return state.showSecondary ? { ...state, showSecondary: false } : state;
    case "selectSecondaryItem":
      return state.secondaryItem === action.item ? state : { ...state, secondaryItem: action.item };
    case "pushView":
      return { ...state, viewStack: [...state.viewStack, action.view] };
    case "popView":
      return state.viewStack.length === 0
        ? state
        : { ...state, viewStack: state.viewStack.slice(0, -1) };
    case "clearViews":
      return state.viewStack.length === 0 ? state : { ...state, viewStack: [] };
    case "updateView": {
      const index = state.viewStack.findIndex((view) => view.id === action.id);
      if (index === -1) return state;
      return {
        ...state,
        viewStack: state.viewStack.map((view, viewIndex) =>
          viewIndex === index ? { ...view, ...action.update } : view,
        ),
      };
    }
    case "replaceIssue": {
      const viewStack = state.viewStack.map((view) =>
        view.issue?.id === action.issue.id ? { ...view, issue: action.issue } : view,
      );
      return viewStack.some((view, index) => view !== state.viewStack[index])
        ? { ...state, viewStack }
        : state;
    }
  }
}
