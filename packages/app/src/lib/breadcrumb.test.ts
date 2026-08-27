import { expect, test } from "bun:test";

import { breadcrumbTrail } from "~/lib/breadcrumb";

test("joins segments with the app's separator", () => {
  expect(breadcrumbTrail(["Issues", "Feed", "PUMP-STATION-1"], 80)).toBe(
    "Issues › Feed › PUMP-STATION-1",
  );
});

test("drops blank and missing segments", () => {
  expect(breadcrumbTrail(["Explore", undefined, "All Queries", "  "], 80)).toBe(
    "Explore › All Queries",
  );
  expect(breadcrumbTrail([undefined, ""], 80)).toBe("");
});

test("sheds ancestors from the front before it touches the leaf", () => {
  // Room for the leaf and one ancestor, but not for all three.
  const trail = breadcrumbTrail(["Dashboards", "All Dashboards", "Mobile Crash Rates"], 30);
  expect(trail).toBe("… › Mobile Crash Rates");
  expect(trail).toContain("Mobile Crash Rates");
});

test("trims the leaf only when the leaf alone overruns the pane", () => {
  const trail = breadcrumbTrail(["Explore", "All Queries", "p95 by route, by release"], 12);
  expect(trail).toBe("p95 by rout…");
  expect(trail.length).toBe(12);
});

test("never exceeds the width it is given", () => {
  const segments = ["Dashboards", "All Dashboards", "Mobile Crash Rates"];
  for (let width = 1; width <= 60; width++) {
    expect(breadcrumbTrail(segments, width).length).toBeLessThanOrEqual(width);
  }
});

test("a width of zero or less yields nothing rather than an ellipsis", () => {
  expect(breadcrumbTrail(["Issues", "Feed"], 0)).toBe("");
  expect(breadcrumbTrail(["Issues", "Feed"], -4)).toBe("");
});
