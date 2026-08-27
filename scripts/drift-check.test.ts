import { expect, test } from "bun:test";

import { WIDGET_DISPLAY_TYPES } from "~/api/dashboards";
import { DETECTOR_TYPE } from "~/api/detectors";
import { SORT_OPTIONS } from "~/api/issues";
import { EXPLORE_TABLES } from "~/core/exploreTables";
import { NAV_GROUPS, navItems } from "~/core/nav";

import baseline from "./sentry-frontend-baseline.json";
import generated from "../packages/app/src/core/prebuiltDashboards.generated.json";
import { dashboardDifference, listDifference, report } from "./drift-check";

test("the reviewed frontend baseline remains connected to local declarations", () => {
  const snapshot = baseline.snapshot;

  expect(snapshot.detectorTypes).toEqual(Object.values(DETECTOR_TYPE));
  expect(snapshot.widgetDisplayTypes).toEqual([...WIDGET_DISPLAY_TYPES]);
  const localSorts: string[] = SORT_OPTIONS.map((option) => option.value);
  expect(localSorts.sort()).toEqual(
    snapshot.issueSortOptions.filter((value) => !value.startsWith("recommended_v")).sort(),
  );

  const fieldsByScreen = Object.fromEntries(
    EXPLORE_TABLES.map((table) => [table.id, table.fields]),
  );
  expect(fieldsByScreen["explore.traces"]).toEqual(snapshot.exploreFields.traces);
  expect(
    snapshot.exploreFields.logs.every((field) => fieldsByScreen["explore.logs"]!.includes(field)),
  ).toBe(true);
  expect(
    snapshot.exploreFields.metrics
      .filter((field) => !["expand_row", "project_badge"].includes(field))
      .every((field) => fieldsByScreen["explore.metrics"]!.includes(field)),
  ).toBe(true);
  expect(
    snapshot.exploreFields.errors.every((field) =>
      fieldsByScreen["explore.errors"]!.includes(field),
    ),
  ).toBe(true);
});

test("intentional navigation differences are explicit", () => {
  const upstream = new Set(Object.values(baseline.snapshot.navigation).flat());
  const local = NAV_GROUPS.flatMap((group) => [group.label, ...navItems(group)]);
  const intentionalLocalOnly = new Set(["Seer", "Ask Seer", "Conversations"]);

  expect(local.filter((label) => !upstream.has(label)).sort()).toEqual(
    [...intentionalLocalOnly].sort(),
  );
  expect(local.every((label) => upstream.has(label) || intentionalLocalOnly.has(label))).toBe(true);
});

test("the semantic baseline and generated dashboards use one upstream revision", () => {
  expect(baseline.source.revision).toBe(generated.source.revision);
  expect(Object.keys(generated.dashboards)).toHaveLength(29);
});

test("drift helpers report additions, removals, and changed widgets", () => {
  expect(listDifference(["one", "two"], ["two", "three"])).toEqual([
    "added `three`",
    "removed `one`",
  ]);

  const dashboard = generated.dashboards[28]!;
  const changed = structuredClone(dashboard);
  changed.widgets[0]!.title = "Cache Misses";
  expect(dashboardDifference(dashboard, changed)).toEqual(["widgets changed: `cache-hits-widget`"]);

  expect(
    report("1234567890abcdef", [
      { title: "Detector Types", drifted: true, details: ["added `future_detector`"] },
    ]),
  ).toContain("⚠️ added `future_detector`");
});
