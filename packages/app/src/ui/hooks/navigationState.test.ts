import { describe, expect, test } from "bun:test";

import type { Group } from "~/api/types";
import {
  initialNavigationModel,
  navigationReducer,
  type NavigationModel,
} from "~/ui/hooks/navigationState";
import type { ViewStackEntry } from "~/ui/screens/types";

/** Build a minimal pushed view for reducer tests. */
function view(id: string, label = id): ViewStackEntry {
  return {
    id,
    label,
    sentryLocation: { screen: "issues.feed" },
    render: () => null,
  };
}

/** Reduce several actions in the same order React would dispatch them. */
function reduce(
  state: NavigationModel,
  ...actions: Parameters<typeof navigationReducer>[1][]
): NavigationModel {
  return actions.reduce(navigationReducer, state);
}

describe("navigationReducer", () => {
  test("navigating commits the route and closes every transient surface", () => {
    const dirty = reduce(
      initialNavigationModel("issues", "Feed"),
      { type: "openGoto" },
      { type: "openGroup", group: "explore", item: "Logs" },
      { type: "pushView", view: view("detail") },
    );

    const next = navigationReducer(dirty, {
      type: "navigate",
      group: "dashboards",
      item: "All Dashboards",
    });

    expect(next).toEqual({
      railGroup: "dashboards",
      activeGroup: "dashboards",
      activeItem: "All Dashboards",
      navExpanded: false,
      showSecondary: false,
      secondaryItem: "All Dashboards",
      gotoMode: false,
      viewStack: [],
    });
  });

  test("opening and previewing groups leave the committed route alone", () => {
    const initial = initialNavigationModel("issues", "Feed");
    const goto = navigationReducer(initial, { type: "openGoto" });
    const preview = navigationReducer(goto, {
      type: "previewGroup",
      group: "explore",
      item: "Traces",
    });

    expect(preview).toMatchObject({
      railGroup: "explore",
      activeGroup: "issues",
      activeItem: "Feed",
      secondaryItem: "Traces",
      navExpanded: true,
      gotoMode: true,
    });

    expect(
      navigationReducer(preview, {
        type: "openGroup",
        group: "dashboards",
        item: "All Dashboards",
      }),
    ).toMatchObject({
      railGroup: "dashboards",
      activeGroup: "issues",
      activeItem: "Feed",
      secondaryItem: "All Dashboards",
      showSecondary: true,
      gotoMode: false,
    });
  });

  test("view actions preserve stack order and update only matching entries", () => {
    const issue = { id: "1" } as Group;
    const replacement = { id: "1", title: "Updated" } as Group;
    const issueView = { ...view("issue", "Original"), issue };
    const pushed = reduce(
      initialNavigationModel("issues", "Feed"),
      { type: "pushView", view: issueView },
      { type: "pushView", view: view("event") },
      { type: "updateView", id: "issue", update: { label: "Known issue" } },
      { type: "replaceIssue", issue: replacement },
    );

    expect(pushed.viewStack.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "issue", label: "Known issue" },
      { id: "event", label: "event" },
    ]);
    expect(pushed.viewStack[0]?.issue).toBe(replacement);
    expect(navigationReducer(pushed, { type: "popView" }).viewStack).toHaveLength(1);
    expect(navigationReducer(pushed, { type: "clearViews" }).viewStack).toEqual([]);
  });
});
