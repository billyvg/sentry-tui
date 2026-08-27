/**
 * The check-in timeline where it lives: on a Cron or Uptime detector row.
 *
 * `src/lib/checkInTimeline.test.ts` pins the folding, `test/checkInTimeline
 * .test.tsx` pins the drawing, and this pins the wiring — which screens get a
 * timeline, what they ask for, and what the row does when the answer is
 * missing, late, or a failure.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import type { ScreenId } from "~/core/screens";
import {
  CRON_GLYPHS,
  TIMELINE_EMPTY_GLYPH,
  TIMELINE_PENDING_GLYPH,
  UPTIME_GLYPHS,
} from "~/lib/checkInTimeline";
import { UPTIME_RESOLUTIONS_SECONDS } from "~/api/monitorStats";
import { App } from "~/ui/App";
import { TIMELINE_MAX_WIDTH, timelineColumnWidth } from "~/ui/screens/monitorTimeline";
import { renderHarness } from "./helpers";
import { detectorListFixture, monitorProjectsFixture } from "./monitor-fixtures";
import { cronDay, uptimeDay } from "./timeline-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 140;
const HEIGHT = 30;

/** The cron monitor guid behind `nightly-billing-rollup` in the fixture. */
const CRON_MONITOR_ID = "cron-1";
/** The uptime detector's own id — what `uptime-stats/` is keyed by. */
const UPTIME_DETECTOR_ID = "3";

interface StubOptions {
  calls?: string[];
  /** Fail both stats endpoints, for the degraded row. */
  failStats?: boolean;
  /** Never settle the stats requests, for the pending rail. */
  pendingStats?: boolean;
  /** Answer the detector list unfiltered, whatever `type:` was asked for. */
  ignoreTypeFilter?: boolean;
  /** Answer `uptime-stats/` with no entry for the detector at all. */
  emptyUptime?: boolean;
}

/**
 * A client that answers all three endpoints, filtering detectors by the
 * screen's `type:` the way the real one does — so a Cron screen really does
 * get only cron rows.
 */
function stubClient({
  calls,
  failStats = false,
  pendingStats = false,
  ignoreTypeFilter = false,
  emptyUptime = false,
}: StubOptions = {}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls?.push(url);
    const params = new URL(url).searchParams;

    if (url.includes("/monitors-stats/") || url.includes("/uptime-stats/")) {
      if (pendingStats) return new Promise<Response>(() => {});
      if (failStats) return json({ detail: "nope" }, 500);
      const since = Number(params.get("since"));
      if (url.includes("/monitors-stats/")) {
        return json({
          [CRON_MONITOR_ID]: cronDay(since, { failures: { 6: { ok: 0, error: 2 } } }),
        });
      }
      return json(
        emptyUptime ? {} : { [UPTIME_DETECTOR_ID]: uptimeDay(since, { incidents: [10] }) },
      );
    }

    if (url.includes("/detectors/")) {
      const query = params.get("query") ?? "";
      const wanted = /(?:^|\s)type:(\S+)/.exec(query)?.[1];
      const rows =
        wanted && !ignoreTypeFilter
          ? detectorListFixture.filter((detector) => detector.type === wanted)
          : detectorListFixture;
      return json(rows);
    }

    if (url.includes("/projects/")) return json(monitorProjectsFixture);
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

async function renderMonitors(screen: ScreenId, options: StubOptions = {}, width = WIDTH) {
  return renderHarness(
    <App onQuit={() => {}} client={stubClient(options)} org="acme" initialScreen={screen} />,
    { width, height: HEIGHT },
  );
}

/** The drawn line for a row, found by the monitor name on it. */
function lineFor(frame: string, name: string): string {
  return frame.split("\n").find((line) => line.includes(name)) ?? "";
}

// ---------------------------------------------------------------------------
// Which screens get one
// ---------------------------------------------------------------------------

test("Cron trades the three middle columns for the timeline", async () => {
  const h = await renderMonitors("monitors.cron");
  try {
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));

    const frame = h.frame();
    expect(frame).toContain("Name");
    expect(frame).toContain("Type");
    // The header is where the window is stated — there is no axis under it.
    expect(frame).toContain("Last 14 days");
    expect(frame).toContain("D 14d");
    // The three the web gives up when a visualization is present.
    expect(frame).not.toContain("Last Issue");
    expect(frame).not.toContain("Assignee");
    expect(frame).not.toContain("Alerts");
  } finally {
    await h.cleanup();
  }
});

test("Uptime gets one too, drawing its own vocabulary", async () => {
  const h = await renderMonitors("monitors.uptime");
  try {
    await h.waitForFrame((f) => f.includes(UPTIME_GLYPHS.success));

    const row = lineFor(h.frame(), "marketing site uptime");
    expect(row).toContain(UPTIME_GLYPHS.success);
    expect(row).toContain(UPTIME_GLYPHS.failure_incident);
    expect(h.frame()).toContain("Last 14 days");
  } finally {
    await h.cleanup();
  }
});

for (const screen of ["monitors.all", "monitors.error", "monitors.metric"] as const) {
  test(`${screen} keeps the five columns and asks for no stats`, async () => {
    const calls: string[] = [];
    const h = await renderMonitors(screen, { calls });
    try {
      await h.waitForFrame((f) => f.includes("Last Issue"));

      expect(h.frame()).toContain("Assignee");
      expect(h.frame()).toContain("Alerts");
      expect(h.frame()).not.toContain("Last 14 days");
      expect(calls.some((url) => url.includes("-stats/"))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
}

// ---------------------------------------------------------------------------
// What it asks for
// ---------------------------------------------------------------------------

test("Cron asks monitors-stats for the monitor behind the detector, not the detector", async () => {
  const calls: string[] = [];
  const h = await renderMonitors("monitors.cron", { calls });
  try {
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));

    const url = new URL(calls.find((candidate) => candidate.includes("/monitors-stats/"))!);
    expect(url.searchParams.getAll("monitor")).toEqual([CRON_MONITOR_ID]);
    expect(url.searchParams.get("resolution")).toMatch(/^\d+s$/);
    const span = Number(url.searchParams.get("until")) - Number(url.searchParams.get("since"));
    expect(span).toBe(14 * 24 * 60 * 60);
  } finally {
    await h.cleanup();
  }
});

test("Cron can select the timeline window from the date chip", async () => {
  const calls: string[] = [];
  const h = await renderMonitors("monitors.cron", { calls });
  try {
    await h.waitForFrame((frame) => frame.includes("Last 14 days"));

    await h.press((input) => input.pressKey("D", { shift: true }));
    expect(h.frame()).toContain("Date Range");

    // The shared default is 14d; the row immediately above it is 7d.
    await h.press((input) => input.pressKey("k"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("Last 7 days"));

    expect(h.frame()).toContain("D 7d");
    const requests = calls.filter((candidate) => candidate.includes("/monitors-stats/"));
    const url = new URL(requests.at(-1)!);
    const span = Number(url.searchParams.get("until")) - Number(url.searchParams.get("since"));
    expect(span).toBe(7 * 24 * 60 * 60);
  } finally {
    await h.cleanup();
  }
});

test("Uptime asks uptime-stats by the detector's own id", async () => {
  const calls: string[] = [];
  const h = await renderMonitors("monitors.uptime", { calls });
  try {
    await h.waitForFrame((f) => f.includes(UPTIME_GLYPHS.success));

    const url = new URL(calls.find((candidate) => candidate.includes("/uptime-stats/"))!);
    expect(url.searchParams.getAll("uptimeDetectorId")).toEqual([UPTIME_DETECTOR_ID]);
    // Snuba only takes a granularity off its own ladder; a width-derived
    // resolution has to be snapped onto it or the request 400s.
    const resolution = Number(url.searchParams.get("resolution")!.replace("s", ""));
    expect(UPTIME_RESOLUTIONS_SECONDS).toContain(resolution);
  } finally {
    await h.cleanup();
  }
});

test("a failed stats request says so rather than degrading silently", async () => {
  const h = await renderMonitors("monitors.cron", { failStats: true });
  try {
    await h.waitForFrame((f) => f.includes("check-in history unavailable"));
    // And the list is still there underneath the notice.
    expect(h.frame()).toContain("nightly-billing-rollup");
  } finally {
    await h.cleanup();
  }
});

test("a screen with no timeline never warns about stats it did not ask for", async () => {
  const h = await renderMonitors("monitors.all", { failStats: true });
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));
    expect(h.frame()).not.toContain("check-in history unavailable");
  } finally {
    await h.cleanup();
  }
});

test("one stats request covers every row on the page", async () => {
  const calls: string[] = [];
  const h = await renderMonitors("monitors.cron", { calls });
  try {
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));
    // Two cron rows in the fixture; the web would have made two requests.
    expect(calls.filter((url) => url.includes("/monitors-stats/"))).toHaveLength(1);
  } finally {
    await h.cleanup();
  }
});

test("R refetches the stats along with the list", async () => {
  const calls: string[] = [];
  const h = await renderMonitors("monitors.cron", { calls });
  try {
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));
    const before = calls.filter((url) => url.includes("/monitors-stats/")).length;

    await h.press((i) => i.pressKey("R", { shift: true }));
    await h.waitForFrame(
      () => calls.filter((url) => url.includes("/monitors-stats/")).length > before,
    );
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// What the row draws
// ---------------------------------------------------------------------------

test("the timeline draws the day's failures on the row it belongs to", async () => {
  const h = await renderMonitors("monitors.cron");
  try {
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.error));

    const row = lineFor(h.frame(), "nightly-billing-rollup");
    expect(row).toContain(CRON_GLYPHS.ok);
    expect(row).toContain(CRON_GLYPHS.error);
  } finally {
    await h.cleanup();
  }
});

test("a cron row with no monitor behind it draws the track, not a rail it waits on", async () => {
  const h = await renderMonitors("monitors.cron");
  try {
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));

    // `session-cleanup`'s data source came back with a null `queryObj`, so
    // there is no guid to ask for and never will be.
    const row = lineFor(h.frame(), "session-cleanup");
    expect(row).toContain(TIMELINE_EMPTY_GLYPH);
    expect(row).not.toContain(TIMELINE_PENDING_GLYPH);
  } finally {
    await h.cleanup();
  }
});

test("a settled response with no entry for a monitor reads as no check-ins", async () => {
  const h = await renderMonitors("monitors.uptime", { emptyUptime: true });
  try {
    await h.waitForFrame((f) => f.includes("marketing site uptime"));
    await h.waitForFrame((f) => lineFor(f, "marketing site uptime").includes(TIMELINE_EMPTY_GLYPH));

    const row = lineFor(h.frame(), "marketing site uptime");
    expect(row).not.toContain(TIMELINE_PENDING_GLYPH);
  } finally {
    await h.cleanup();
  }
});

test("a row of the wrong type leaves the cell blank rather than drawing an empty day", async () => {
  // A typed `type:` in the search box can land any kind of monitor here.
  const h = await renderMonitors("monitors.cron", { ignoreTypeFilter: true });
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));

    const metric = lineFor(h.frame(), "checkout p95 latency");
    expect(metric).not.toContain(TIMELINE_EMPTY_GLYPH);
    expect(metric).not.toContain(TIMELINE_PENDING_GLYPH);
    expect(metric).not.toContain(CRON_GLYPHS.ok);
  } finally {
    await h.cleanup();
  }
});

test("a failed stats request costs the timeline, not the list", async () => {
  const h = await renderMonitors("monitors.cron", { failStats: true });
  try {
    await h.waitForFrame((f) => f.includes("nightly-billing-rollup"));
    await h.waitForFrame((f) =>
      lineFor(f, "nightly-billing-rollup").includes(TIMELINE_EMPTY_GLYPH),
    );

    // The list is intact and nothing claims to still be loading.
    expect(h.frame()).toContain("nightly-billing-rollup");
    expect(h.frame()).not.toContain("Failed to load monitors");
    expect(lineFor(h.frame(), "nightly-billing-rollup")).not.toContain(TIMELINE_PENDING_GLYPH);
  } finally {
    await h.cleanup();
  }
});

test("stats in flight draw the pending rail, and the row does not shift when they land", async () => {
  const pending = await renderMonitors("monitors.cron", { pendingStats: true });
  let pendingLine: string;
  try {
    await pending.waitForFrame((f) => f.includes(TIMELINE_PENDING_GLYPH));
    pendingLine = lineFor(pending.frame(), "nightly-billing-rollup");
    expect(pendingLine).toContain(TIMELINE_PENDING_GLYPH);
    expect(pending.frame().split("\n").filter(Boolean)).toHaveLength(HEIGHT);
  } finally {
    await pending.cleanup();
  }

  const settled = await renderMonitors("monitors.cron");
  try {
    await settled.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));
    const settledLine = lineFor(settled.frame(), "nightly-billing-rollup");
    // Same length, and the timeline starts at the same offset — the rail held
    // the geometry the real row lands in.
    expect(settledLine).toHaveLength(pendingLine.length);
    expect(settledLine.indexOf(CRON_GLYPHS.ok)).toBe(pendingLine.indexOf(TIMELINE_PENDING_GLYPH));
  } finally {
    await settled.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Reflow
// ---------------------------------------------------------------------------

test("timelineColumnWidth grows with the pane and stops at a sensible ceiling", () => {
  expect(timelineColumnWidth(60)).toBeLessThan(timelineColumnWidth(120));
  expect(timelineColumnWidth(4000)).toBe(TIMELINE_MAX_WIDTH);
  // Never negative, never zero — a row of no cells is not a timeline.
  expect(timelineColumnWidth(0)).toBeGreaterThan(0);
});

for (const width of [80, 100, 140] as const) {
  test(`the cron row reflows at ${width} columns without wrapping`, async () => {
    const h = await renderMonitors("monitors.cron", {}, width);
    try {
      await h.waitForFrame((f) => f.includes("nightly-billing-rollup"));

      const lines = h.frame().split("\n").filter(Boolean);
      expect(lines).toHaveLength(HEIGHT);
      expect([...new Set(lines.map((line) => line.length))]).toEqual([width]);
      // The name identifies the row and never gives way to the chart.
      expect(h.frame()).toContain("nightly-billing-rollup");
    } finally {
      await h.cleanup();
    }
  });
}

test("a wider terminal buys a wider timeline, and asks for finer buckets", async () => {
  const resolutions: number[] = [];
  const drawn: number[] = [];

  for (const width of [100, 140]) {
    const calls: string[] = [];
    const h = await renderMonitors("monitors.cron", { calls }, width);
    try {
      await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));

      const url = new URL(calls.find((candidate) => candidate.includes("/monitors-stats/"))!);
      resolutions.push(Number(url.searchParams.get("resolution")!.replace("s", "")));

      const row = lineFor(h.frame(), "nightly-billing-rollup");
      const first = [...row].findIndex((glyph) => glyph === CRON_GLYPHS.ok);
      drawn.push(row.trimEnd().length - first);
    } finally {
      await h.cleanup();
    }
  }

  expect(drawn[1]).toBeGreaterThan(drawn[0]!);
  expect(resolutions[1]).toBeLessThan(resolutions[0]!);
});
