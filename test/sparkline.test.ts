import { describe, expect, test } from "bun:test";

import { countLabel, sparkline } from "~/lib/sparkline";

/** `[unixSeconds, count]` pairs, as `group.stats` returns them. */
function series(...counts: number[]): Array<[number, number]> {
  return counts.map((count, i) => [i, count]);
}

describe("countLabel", () => {
  test("agrees in number with its noun", () => {
    expect(countLabel(1, "event")).toBe("1 event");
    expect(countLabel("1", "event")).toBe("1 event");
    expect(countLabel(2, "event")).toBe("2 events");
    expect(countLabel(0, "user")).toBe("0 users");
  });

  test("treats a count that hasn't arrived as the neutral plural", () => {
    expect(countLabel(undefined, "event")).toBe("·· events");
  });

  test("keeps the compact formatting of the count itself", () => {
    expect(countLabel(1428, "event")).toBe("1.4k events");
  });
});

describe("sparkline floor", () => {
  test("leaves empty buckets blank by default, so a stream column stays legible", () => {
    expect(sparkline(series(0, 5, 0), 3)).toBe(" █ ");
  });

  test("draws a baseline under empty buckets when asked, so it reads as a chart", () => {
    expect(sparkline(series(0, 5, 0), 3, { floor: true })).toBe("▁█▁");
  });

  test("an all-zero window is a flat floor either way — it is data, not absence", () => {
    expect(sparkline(series(0, 0, 0), 3)).toBe("▁▁▁");
    expect(sparkline(series(0, 0, 0), 3, { floor: true })).toBe("▁▁▁");
  });
});
