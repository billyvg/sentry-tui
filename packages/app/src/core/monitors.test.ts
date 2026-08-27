import { describe, expect, test } from "bun:test";

import { buildDetectorQuery, getMonitorListView, MONITOR_LIST_VIEWS } from "~/core/monitors";
import { SCREENS, type ScreenId } from "~/core/screens";

/** Every Monitors screen that is the detector table — Alerts is its own thing. */
const MONITOR_SCREEN_IDS = SCREENS.filter(
  (screen) => screen.group === "monitors" && screen.id !== "monitors.alerts",
).map((screen) => screen.id);

describe("monitor list views", () => {
  test("every detector-backed Monitors destination has a configuration", () => {
    const missing = MONITOR_SCREEN_IDS.filter((id) => !getMonitorListView(id));
    expect(missing).toEqual([]);
  });

  test("no configuration exists for a screen that isn't registered", () => {
    const registered = new Set<string>(MONITOR_SCREEN_IDS);
    const orphans = Object.keys(MONITOR_LIST_VIEWS).filter((id) => !registered.has(id));
    expect(orphans).toEqual([]);
  });

  test("Alerts is not one of them — it reads /workflows/, not /detectors/", () => {
    expect(getMonitorListView("monitors.alerts")).toBeUndefined();
  });

  test("each type screen filters on the type the web filters on", () => {
    expect(getMonitorListView("monitors.error")?.type).toBe("error");
    expect(getMonitorListView("monitors.metric")?.type).toBe("metric_issue");
    expect(getMonitorListView("monitors.cron")?.type).toBe("monitor_check_in_failure");
    expect(getMonitorListView("monitors.uptime")?.type).toBe("uptime_domain_failure");
    expect(getMonitorListView("monitors.mobile-build")?.type).toBe("preprod_size_analysis");
  });

  test("the two unfiltered screens list every type", () => {
    expect(getMonitorListView("monitors.all")?.type).toBeUndefined();
    expect(getMonitorListView("monitors.mine")?.type).toBeUndefined();
  });

  test("only My Monitors filters by assignee", () => {
    expect(getMonitorListView("monitors.mine")?.assignee).toBe("[me,my_teams]");
    const others = MONITOR_SCREEN_IDS.filter((id) => id !== "monitors.mine");
    expect(others.filter((id) => getMonitorListView(id)?.assignee)).toEqual([]);
  });

  test("no empty state claims there are simply no results", () => {
    // Org feature flags are invisible to us, so an empty list is at least as
    // likely to mean "not enabled" as "nothing here" — and the feature has to
    // be named, since "no results" tells nobody what to go and turn on.
    for (const id of MONITOR_SCREEN_IDS) {
      expect(getMonitorListView(id)?.emptyLines.join(" ")).toContain("may not have");
    }
  });

  test("an unregistered id has no configuration", () => {
    expect(getMonitorListView("issues.feed" as ScreenId)).toBeUndefined();
  });
});

describe("buildDetectorQuery", () => {
  test("every screen excludes the internal issue-stream detectors", () => {
    for (const id of MONITOR_SCREEN_IDS) {
      expect(buildDetectorQuery(getMonitorListView(id))).toContain("!type:issue_stream");
    }
  });

  test("All Monitors is the exclusion and nothing else", () => {
    expect(buildDetectorQuery(getMonitorListView("monitors.all"))).toBe("!type:issue_stream");
  });

  test("a type screen appends its type", () => {
    expect(buildDetectorQuery(getMonitorListView("monitors.cron"))).toBe(
      "!type:issue_stream type:monitor_check_in_failure",
    );
  });

  test("My Monitors appends its assignee filter", () => {
    expect(buildDetectorQuery(getMonitorListView("monitors.mine"))).toBe(
      "!type:issue_stream assignee:[me,my_teams]",
    );
  });

  test("the user's own query comes last, so it narrows within the screen", () => {
    expect(buildDetectorQuery(getMonitorListView("monitors.uptime"), "  example.com  ")).toBe(
      "!type:issue_stream type:uptime_domain_failure example.com",
    );
  });

  test("an empty query adds nothing", () => {
    expect(buildDetectorQuery(getMonitorListView("monitors.all"), "   ")).toBe(
      "!type:issue_stream",
    );
  });
});
