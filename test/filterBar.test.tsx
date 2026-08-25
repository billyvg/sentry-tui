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
      sort={{
        value: "date",
        items: [
          { label: "Last Seen", value: "date" },
          { label: "Age", value: "new" },
        ],
        onChange: () => {},
      }}
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

/** The middle line of the chips, where their labels are printed. */
function filterLine(frame: string): string {
  return frame.split("\n").find((line) => line.includes("Last Seen")) ?? "";
}

test("multiple selections fit while sort stays against the right edge", async () => {
  const width = 120;
  const h = await renderFilterBar(width, ["backend", "frontend"], ["production", "staging"]);
  try {
    const line = filterLine(h.frame());
    expect(line).toContain("backend, frontend");
    expect(line).toContain("production, staging");
    expect(line).toContain("Last Seen");
    expect(line).not.toContain("Sort:");
    expect(line).not.toContain("2 projects");
    expect(line).not.toContain("2 envs");
    expect(line.indexOf("Last Seen")).toBeGreaterThan(width - 20);
  } finally {
    await h.cleanup();
  }
});

test("long selection lists ellipsize before they can displace right-aligned sort", async () => {
  const width = 80;
  const h = await renderFilterBar(
    width,
    ["checkout-service", "billing-worker"],
    ["production-us-east", "staging-us-west"],
  );
  try {
    const line = filterLine(h.frame());
    expect(line).toContain("Last Seen");
    expect(line.match(/…/g)).toHaveLength(2);
    expect(line).not.toContain("billing-worker");
    expect(line).not.toContain("staging-us-west");
    expect(measureTextWidth(line)).toBeLessThanOrEqual(width);
    expect(line.indexOf("Last Seen")).toBeGreaterThan(width - 20);
  } finally {
    await h.cleanup();
  }
});
