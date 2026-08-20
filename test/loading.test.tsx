import { describe, expect, test } from "bun:test";

import {
  elapsedMs,
  errorOf,
  idle,
  isInitialLoad,
  rejected,
  resolved,
  startLoading,
  valueOf,
} from "~/core/async";
import { createStore } from "~/core/store";
import { formatCount, sparkline, SPARKLINE_PENDING, timeAgo } from "~/lib/sparkline";
import { IssueRow, IssueRowSkeleton } from "~/ui/components/IssueRow";
import { groupFixture } from "./fixtures";
import { renderHarness } from "./helpers";

describe("AsyncStatus", () => {
  test("a first load has nothing to show, so it warrants skeletons", () => {
    const status = startLoading<string[]>(idle(), 1000);
    expect(isInitialLoad(status)).toBe(true);
    expect(valueOf(status)).toBeUndefined();
  });

  test("a refresh keeps the previous value on screen", () => {
    const ready = resolved(["a", "b"], 1000);
    const refreshing = startLoading(ready, 2000);

    expect(isInitialLoad(refreshing)).toBe(false);
    expect(valueOf(refreshing)).toEqual(["a", "b"]);
  });

  test("a failure keeps the last good value rather than blanking the screen", () => {
    const ready = resolved(["a"], 1000);
    const failed = rejected(ready, { message: "boom", retryable: true });

    expect(valueOf(failed)).toEqual(["a"]);
    expect(errorOf(failed)?.message).toBe("boom");
  });

  test("elapsed time is only defined while loading", () => {
    expect(elapsedMs(startLoading(idle(), 1000), 3500)).toBe(2500);
    expect(elapsedMs(resolved([], 1000), 3500)).toBeUndefined();
  });
});

describe("store", () => {
  test("notifies subscribers and skips no-op dispatches", () => {
    const store = createStore({ n: 0 }, (state, action: "inc" | "noop") =>
      action === "inc" ? { n: state.n + 1 } : state,
    );

    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);

    store.dispatch("inc");
    store.dispatch("noop"); // reducer returns the same reference
    expect(store.getSnapshot().n).toBe(1);
    expect(notifications).toBe(1);

    unsubscribe();
    store.dispatch("inc");
    expect(notifications).toBe(1);
  });

  test("a listener can unsubscribe during notification", () => {
    const store = createStore({ n: 0 }, (s: { n: number }) => ({ n: s.n + 1 }));
    const unsubscribe = store.subscribe(() => unsubscribe());
    expect(() => store.dispatch(undefined as never)).not.toThrow();
  });
});

describe("sparkline", () => {
  test("renders pending glyphs when stats have not arrived", () => {
    expect(sparkline(undefined, 8)).toBe(SPARKLINE_PENDING.repeat(8));
  });

  test("scales to the series maximum and fills the requested width", () => {
    const line = sparkline(
      [
        [0, 0],
        [1, 5],
        [2, 10],
      ],
      3,
    );
    expect(line).toHaveLength(3);
    expect(line).toContain("█"); // the peak
  });

  test("an all-zero window is data, not absence", () => {
    const line = sparkline([[0, 0], [1, 0]], 4);
    expect(line).toHaveLength(4);
    expect(line).not.toContain(SPARKLINE_PENDING);
  });

  test("downsamples a long series to the column width", () => {
    const series = Array.from({ length: 96 }, (_, i): [number, number] => [i, i]);
    expect(sparkline(series, 10)).toHaveLength(10);
  });
});

describe("formatting", () => {
  test("compacts counts like the web app", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1428)).toBe("1.4k");
    expect(formatCount(12_000)).toBe("12k");
    expect(formatCount(2_400_000)).toBe("2.4m");
    expect(formatCount("1428")).toBe("1.4k");
  });

  test("renders short relative times", () => {
    const now = Date.parse("2026-08-20T12:00:00Z");
    expect(timeAgo("2026-08-20T11:59:30Z", now)).toBe("30s");
    expect(timeAgo("2026-08-20T11:30:00Z", now)).toBe("30m");
    expect(timeAgo("2026-08-20T09:00:00Z", now)).toBe("3h");
    expect(timeAgo("2026-08-18T12:00:00Z", now)).toBe("2d");
    expect(timeAgo("not-a-date", now)).toBe("");
  });
});

describe("IssueRow", () => {
  const WIDTH = 90;

  test("renders title, short id, culprit and counts", async () => {
    const h = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: 4 },
    );
    try {
      const frame = h.frame();
      expect(frame).toContain("TypeError");
      expect(frame).toContain("PUMP-STATION-1");
      expect(frame).toContain("Unhandled");
      expect(frame).toContain("1.4k"); // 1428 events
    } finally {
      await h.cleanup();
    }
  });

  test("shows pending sparkline glyphs before stats arrive", async () => {
    const { stats: _dropped, ...withoutStats } = groupFixture;
    const h = await renderHarness(
      <IssueRow group={withoutStats} selected={false} width={WIDTH} />,
      { width: WIDTH, height: 4 },
    );
    try {
      expect(h.frame()).toContain(SPARKLINE_PENDING);
      // Text is readable while the graph is still in flight — the whole point
      // of the two-phase fetch.
      expect(h.frame()).toContain("TypeError");
    } finally {
      await h.cleanup();
    }
  });

  test("skeleton occupies the same geometry as a real row", async () => {
    const real = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: 4 },
    );
    const realLines = real.frame().split("\n");
    await real.cleanup();

    const skeleton = await renderHarness(
      <IssueRowSkeleton width={WIDTH} seed={0} />,
      { width: WIDTH, height: 4 },
    );
    const skeletonLines = skeleton.frame().split("\n");
    await skeleton.cleanup();

    // Same number of rows, same cell width — no reflow when data lands.
    expect(skeletonLines.length).toBe(realLines.length);
    for (let i = 0; i < realLines.length; i++) {
      expect(skeletonLines[i]!.length).toBe(realLines[i]!.length);
    }
  });

  test("skeleton bar widths vary by seed so it reads as content", async () => {
    const frames: string[] = [];
    for (const seed of [0, 1, 2]) {
      const h = await renderHarness(<IssueRowSkeleton width={WIDTH} seed={seed} />, {
        width: WIDTH,
        height: 4,
      });
      frames.push(h.frame());
      await h.cleanup();
    }
    expect(new Set(frames).size).toBeGreaterThan(1);
  });
});
