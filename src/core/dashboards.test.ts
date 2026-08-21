import { describe, expect, test } from "bun:test";

import { DASHBOARD_LIST_VIEWS, getDashboardListView } from "~/core/dashboards";
import { SCREENS, type ScreenId } from "~/core/screens";

const DASHBOARD_SCREEN_IDS = SCREENS.filter((screen) => screen.group === "dashboards").map(
  (screen) => screen.id,
);

describe("dashboard list views", () => {
  test("every Dashboards nav destination has a list configuration", () => {
    const missing = DASHBOARD_SCREEN_IDS.filter((id) => !getDashboardListView(id));
    expect(missing).toEqual([]);
  });

  test("no configuration exists for a screen that isn't registered", () => {
    const registered = new Set<string>(DASHBOARD_SCREEN_IDS);
    const orphans = Object.keys(DASHBOARD_LIST_VIEWS).filter((id) => !registered.has(id));
    expect(orphans).toEqual([]);
  });

  test("Sentry Built asks the endpoint for prebuilt dashboards only", () => {
    expect(getDashboardListView("dashboards.sentry-built")?.filter).toBe("onlyPrebuilt");
  });

  test("All Dashboards sends no filter, so it lists everything", () => {
    expect(getDashboardListView("dashboards.all")?.filter).toBeUndefined();
  });

  test("no empty state claims there are simply no results", () => {
    // Org feature flags are invisible to us, so an empty list is at least as
    // likely to mean "not enabled" as "nothing here" — every screen has to say
    // both, not just the prebuilt one.
    for (const id of DASHBOARD_SCREEN_IDS) {
      const lines = getDashboardListView(id)?.emptyLines ?? [];
      expect(lines.join(" ")).toContain("may not have");
    }
  });

  test("an unregistered id has no configuration", () => {
    expect(getDashboardListView("issues.feed" as ScreenId)).toBeUndefined();
  });
});
