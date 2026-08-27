import { describe, expect, test } from "bun:test";

import { filterByLabel, highlightByLabel } from "~/ui/lib/listFilter";

const items = [
  { label: "sentry" },
  { label: "javascript-frontend" },
  { label: "sentry-mobile" },
  { label: "backend" },
];

const labels = (query: string) => filterByLabel(items, query).map((r) => r.item.label);

describe("filterByLabel", () => {
  test("an empty query keeps every item in order", () => {
    expect(labels("")).toEqual(items.map((i) => i.label));
    expect(labels("   ")).toEqual(items.map((i) => i.label));
  });

  test("drops items the query is not a subsequence of", () => {
    expect(labels("sentry")).toEqual(["sentry", "sentry-mobile"]);
    expect(labels("zzz")).toEqual([]);
  });

  test("matches non-contiguously, the way the palette does", () => {
    expect(labels("jsfront")).toEqual(["javascript-frontend"]);
  });

  test("ranks the tighter match first, ahead of the original order", () => {
    // "be" opens "backend" but is split across "sentry-mo-b-il-e", so the
    // ranking has to overturn the order the two arrived in.
    expect(labels("be")).toEqual(["backend", "sentry-mobile"]);
  });

  test("is case-insensitive and reports matched positions", () => {
    const [first] = filterByLabel(items, "SEN");
    expect(first?.item.label).toBe("sentry");
    expect(first?.positions).toEqual([0, 1, 2]);
  });
});

describe("highlightByLabel", () => {
  test("keeps every item, in the order it was given", () => {
    const rows = highlightByLabel(items, "sentry");
    expect(rows.map((r) => r.item.label)).toEqual(items.map((i) => i.label));
  });

  test("reports positions where the label matched, and none where it did not", () => {
    const rows = highlightByLabel(items, "sen");
    expect(rows[0]?.positions).toEqual([0, 1, 2]);
    // "backend" is in the list because something else matched it — its name,
    // say — so there is nothing in its label to underline.
    expect(rows[3]?.item.label).toBe("backend");
    expect(rows[3]?.positions).toEqual([]);
  });

  test("an empty query highlights nothing", () => {
    expect(highlightByLabel(items, "  ").every((r) => r.positions.length === 0)).toBe(true);
  });
});
