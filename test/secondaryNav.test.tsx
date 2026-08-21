import { expect, test } from "bun:test";

import { SecondaryNav, SECONDARY_NAV_WIDTH } from "~/ui/components/SecondaryNav";
import { navItemsFor, type SecondaryNavExtras } from "~/ui/lib/navSections";
import { renderHarness } from "./helpers";

const EXTRAS: SecondaryNavExtras = {
  sections: [
    {
      title: "Starred",
      items: [
        { label: "p95 by route", target: { group: "explore", item: "All Queries" } },
        { label: "slow checkout spans", target: { group: "explore", item: "All Queries" } },
      ],
    },
  ],
};

const render = (extras: SecondaryNavExtras, onSelect?: (item: { label: string }) => void) =>
  renderHarness(
    <SecondaryNav
      group="explore"
      activeItem="Traces"
      focused
      extras={extras}
      onSelect={onSelect}
    />,
    { width: SECONDARY_NAV_WIDTH, height: 24 },
  );

test("dynamic sections are appended under their own rule", async () => {
  const h = await render(EXTRAS);
  try {
    const frame = h.frame();
    // The static IA is still there, in order, above the dynamic section.
    expect(frame).toContain("Traces");
    expect(frame).toContain("All Queries");
    expect(frame).toContain("Starred");
    expect(frame).toContain("p95 by route");
    expect(frame.indexOf("All Queries")).toBeLessThan(frame.indexOf("p95 by route"));
    // Every section is separated by a rule, the dynamic one included.
    const rules = frame.split("\n").filter((line) => line.includes("──")).length;
    expect(rules).toBeGreaterThanOrEqual(3);
  } finally {
    await h.cleanup();
  }
});

test("a long dynamic label is trimmed rather than overflowing", async () => {
  const h = await render({
    sections: [{ items: [{ label: "an extremely long starred query name" }] }],
  });
  try {
    for (const line of h.frame().split("\n").filter(Boolean)) {
      expect(line.length).toBeLessThanOrEqual(SECONDARY_NAV_WIDTH);
    }
    expect(h.frame()).toContain("…");
  } finally {
    await h.cleanup();
  }
});

test("dynamic items join the cursor's item list, carrying their target", () => {
  const items = navItemsFor("explore", EXTRAS);
  expect(items.map((item) => item.label)).toContain("p95 by route");
  expect(items.at(-1)?.target).toEqual({ group: "explore", item: "All Queries" });
});

test("clicking a dynamic item reports the item, target and all", async () => {
  const selected: string[] = [];
  const h = await render(EXTRAS, (item) => selected.push(item.label));
  try {
    const line = h
      .frame()
      .split("\n")
      .findIndex((row) => row.includes("p95 by route"));
    await h.click(3, line);
    expect(selected).toEqual(["p95 by route"]);
  } finally {
    await h.cleanup();
  }
});
