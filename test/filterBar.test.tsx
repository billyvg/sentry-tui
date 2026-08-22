/** Responsive labels in the shared project/environment filter row. */

import { expect, test } from "bun:test";

import { measureTextWidth } from "~/lib/text";
import { FilterBar } from "~/ui/components/FilterBar";
import { renderHarness } from "./helpers";

/** Render a closed filter row with the selected values under test. */
function renderFilterBar(width: number, projects: string[], environments: string[]) {
  return renderHarness(
    <FilterBar
      client={null}
      org="acme"
      openDropdown={null}
      selectedProjects={projects}
      selectedEnvs={environments}
      statsPeriod="14d"
      sortLabel="Last Seen"
      width={width}
      anchorTop={0}
      onProjectChange={() => {}}
      onEnvChange={() => {}}
      onPeriodChange={() => {}}
      onDropdownClose={() => {}}
    />,
    { width, height: 8 },
  );
}

/** The middle line of the chips, where their labels and Sort are printed. */
function filterLine(frame: string): string {
  return frame.split("\n").find((line) => line.includes("(P)")) ?? "";
}

test("multiple selections list every project slug and environment name when they fit", async () => {
  const h = await renderFilterBar(120, ["backend", "frontend"], ["production", "staging"]);
  try {
    const line = filterLine(h.frame());
    expect(line).toContain("backend, frontend");
    expect(line).toContain("production, staging");
    expect(line).toContain("Sort: Last Seen");
    expect(line).not.toContain("2 projects");
    expect(line).not.toContain("2 envs");
  } finally {
    await h.cleanup();
  }
});

test("long selection lists ellipsize before they can displace Sort", async () => {
  const width = 80;
  const h = await renderFilterBar(
    width,
    ["checkout-service", "billing-worker"],
    ["production-us-east", "staging-us-west"],
  );
  try {
    const line = filterLine(h.frame());
    expect(line).toContain("Sort: Last Seen");
    expect(line.match(/…/g)).toHaveLength(2);
    expect(line).not.toContain("billing-worker");
    expect(line).not.toContain("staging-us-west");
    expect(measureTextWidth(line)).toBeLessThanOrEqual(width);
  } finally {
    await h.cleanup();
  }
});
