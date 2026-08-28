import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import type { ScreenId } from "~/core/screens";
import { App } from "~/ui/App";
import {
  CRON_GLYPHS,
  TIMELINE_EMPTY_GLYPH,
  TIMELINE_PENDING_GLYPH,
  UPTIME_GLYPHS,
} from "~/lib/checkInTimeline";
import { timelineWindowLabel } from "~/core/checkInTimeline";
import { TIMELINE_MAX_WIDTH } from "~/ui/screens/monitorTimeline";
import { renderHarness, type Harness } from "./helpers";
import { eventFixture, groupFixture, membersFixture } from "./fixtures";
import {
  detectorListFixture,
  detectorWorkflowsFixture,
  monitorProjectsFixture,
  NIGHTLY_ROLLUP_ID,
  openPeriodsFixture,
} from "./monitor-fixtures";
import { cronDay, uptimeDay } from "./timeline-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
/** Tall enough that the Details fields clear the open-period summary above them. */
const HEIGHT = 36;

interface StubOptions {
  openPeriods?: unknown;
  /** Matching open periods reported by `X-Hits`. */
  openPeriodsTotal?: number;
  /** Advertise another page of open periods. */
  openPeriodsHasMore?: boolean;
  workflows?: unknown;
  /** Fail the open-periods request, for its error state. */
  openPeriodsStatus?: number;
  /** Fail both check-in stats endpoints, for the degraded timeline. */
  failStats?: boolean;
  members?: unknown;
  detectors?: unknown;
  calls?: string[];
  puts?: unknown[];
}

/** The uptime detector's own id — what `uptime-stats/` is keyed by. */
const UPTIME_DETECTOR_ID = "3";

function stubClient({
  openPeriods = openPeriodsFixture,
  openPeriodsTotal,
  openPeriodsHasMore = false,
  workflows = detectorWorkflowsFixture,
  openPeriodsStatus = 200,
  failStats = false,
  members = membersFixture,
  detectors = detectorListFixture,
  calls,
  puts,
}: StubOptions = {}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls?.push(url);

    if (init.method === "PUT" && url.endsWith("/issues/900/")) {
      puts?.push(JSON.parse(String(init.body)));
      return json({
        ...groupFixture,
        id: "900",
        shortId: "JAVASCRIPT-7",
        status: "resolved",
      });
    }

    if (url.includes("/monitors-stats/") || url.includes("/uptime-stats/")) {
      if (failStats) return json({ detail: "nope" }, 500);
      const since = Number(new URL(url).searchParams.get("since"));
      return json(
        url.includes("/monitors-stats/")
          ? { [NIGHTLY_ROLLUP_ID]: cronDay(since, { failures: { 6: { ok: 0, error: 2 } } }) }
          : { [UPTIME_DETECTOR_ID]: uptimeDay(since, { incidents: [10] }) },
      );
    }

    if (url.includes("/detectors/")) return json(detectors);
    if (url.includes("/open-periods/")) {
      const headers: Record<string, string> = {};
      if (openPeriodsTotal !== undefined) headers["X-Hits"] = String(openPeriodsTotal);
      if (openPeriodsHasMore) {
        headers.Link =
          '<https://sentry.io/api/0/organizations/acme/open-periods/?cursor=next>; rel="next"; results="true"; cursor="next"';
      }
      return openPeriodsStatus === 200
        ? new Response(JSON.stringify(openPeriods), {
            status: 200,
            headers: { "Content-Type": "application/json", ...headers },
          })
        : json({ detail: "nope" }, openPeriodsStatus);
    }
    if (url.includes("/workflows/")) return json(workflows);
    if (url.includes("/projects/")) return json(monitorProjectsFixture);
    if (url.includes("/users/")) return json(members);
    if (url.endsWith("/issues/900/")) {
      return json({ ...groupFixture, id: "900", shortId: "JAVASCRIPT-7" });
    }
    if (url.includes("/issues/900/events/")) return json(eventFixture);
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

async function renderMonitors(
  client: SentryClient | null = stubClient(),
  screen: ScreenId = "monitors.all",
) {
  return renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen={screen} />,
    { width: WIDTH, height: HEIGHT },
  );
}

/**
 * Open the detail of the row at `index`.
 *
 * The fixture order is metric, cron, uptime, mobile build, error, cron —
 * `detectorListFixture` — and the cursor starts on the first.
 */
async function openRow(h: Harness, index = 0) {
  await h.waitForFrame((f) => f.includes("checkout p95 latency"));
  for (let step = 0; step < index; step++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

test("Enter on a row opens that monitor's detail", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Configuration"));

    const frame = h.frame();
    // The header: name, state, type, project, assignee.
    expect(frame).toContain("checkout p95 latency");
    expect(frame).toContain("enabled");
    expect(frame).toContain("Metric");
    expect(frame).toContain("checkout");
    expect(frame).toContain("Ada Lovelace");
    // And a way back out, in the pane's border.
    expect(frame).toContain("back to");
  } finally {
    await h.cleanup();
  }
});

test("Enter on a monitor detail fetches and opens its latest issue", async () => {
  const calls: string[] = [];
  const puts: unknown[] = [];
  const h = await renderMonitors(stubClient({ calls, puts }));
  try {
    await openRow(h);
    await h.waitForFrame((frame) => frame.includes("Configuration") && frame.includes("open"));

    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("1.4k events"));

    expect(h.frame()).toContain("JAVASCRIPT-7");
    expect(calls.some((url) => url.endsWith("/organizations/acme/issues/900/"))).toBe(true);

    await h.press((input) => input.pressKey("r"));
    await h.waitForFrame((frame) => frame.includes("unresolve"));
    expect(puts).toEqual([{ status: "resolved" }]);
  } finally {
    await h.cleanup();
  }
});

test("a monitor detail without a latest issue does not advertise Enter", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 1);
    await h.waitForFrame((frame) => frame.includes("nightly-billing-rollup"));
    expect(h.frame()).not.toContain("(enter)");
  } finally {
    await h.cleanup();
  }
});

test("Escape returns to the list with the cursor where it was", async () => {
  const h = await renderMonitors();
  try {
    // Third row, so a cursor that resets to the top is visible as a change.
    await openRow(h, 2);
    await h.waitForFrame((f) => f.includes("Configuration"));
    expect(h.frame()).toContain("marketing site uptime");

    await h.pressEscape();
    await h.waitForFrame((f) => f.includes("Last Issue"));

    // Back on the list, and Enter opens the same row rather than the first.
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Configuration"));
    expect(h.frame()).toContain("marketing site uptime");
    expect(h.frame()).toContain("Uptime");
  } finally {
    await h.cleanup();
  }
});

test("the detail costs no second request for the monitor itself", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }));
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Configuration"));

    // The row it was opened from is the whole monitor, so only what a row
    // never carried is fetched.
    expect(calls.filter((url) => url.includes("/detectors/"))).toHaveLength(1);
    expect(calls.some((url) => url.includes("/open-periods/"))).toBe(true);
    expect(calls.some((url) => url.includes("/workflows/"))).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("the alerts section asks only for this monitor's alerts", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }));
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Connected Alerts"));

    const url = calls.find((candidate) => candidate.includes("/workflows/"))!;
    expect(new URL(url).searchParams.getAll("detector")).toEqual(["1"]);
  } finally {
    await h.cleanup();
  }
});

/**
 * The list serializer does not send `lastTriggered` — verified against real
 * cron monitors that fire every hour — so a pane opened from a row must not
 * claim the monitor has never fired when its own Open Periods section is about
 * to list twenty of them.
 */
test("a monitor with no lastTriggered falls back to its last issue", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Configuration"));

    const frame = h.frame();
    expect(frame).toContain("last issue");
    expect(frame).not.toContain("never triggered");
  } finally {
    await h.cleanup();
  }
});

test("a monitor that has never fired at all does say so", async () => {
  // The sixth fixture is a cron detector with no latest group.
  const h = await renderMonitors();
  try {
    await openRow(h, 5);
    await h.waitForFrame((f) => f.includes("Configuration"));
    expect(h.frame()).toContain("never triggered");
  } finally {
    await h.cleanup();
  }
});

/**
 * The seven Monitors screens share one state slice, so `state.entries` still
 * holds the previous screen's detectors while the next screen's fetch is in
 * flight. Enter must not open a monitor that isn't on screen.
 *
 * Found in a real terminal: walking Cron → Metric and pressing Enter opened
 * the cron monitor the *previous* screen had listed, under a "Monitors ›
 * Metric" breadcrumb.
 */
test("Enter does nothing while a sibling screen's rows are still loading", async () => {
  let detectorCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/detectors/")) {
      detectorCalls += 1;
      // The first screen answers; the screen navigated to never does.
      if (detectorCalls > 1) return new Promise<Response>(() => {});
      return json(detectorListFixture);
    }
    if (url.includes("/projects/")) return json(monitorProjectsFixture);
    return json([]);
  }) as unknown as typeof fetch;

  const h = await renderMonitors(new SentryClient({ auth, fetchImpl, maxRetries: 0 }));
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));

    // Command palette → Monitors › Metric, whose fetch never lands.
    await h.press((i) => i.pressKey("k", { ctrl: true }));
    await h.press((i) => i.pressKey("metric"));
    await h.press((i) => i.pressEnter());
    // The Metric screen's own heading, so this waits for the navigation
    // rather than for a frame that merely lacks the old rows.
    await h.waitForFrame((f) => f.includes("Thresholds and anomalies"));

    await h.press((i) => i.pressEnter());
    const frame = h.frame();
    expect(frame).not.toContain("Configuration");
    expect(frame).not.toContain("back to");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Configuration, per type
// ---------------------------------------------------------------------------

test("a metric monitor's configuration is the row's detail line, labelled", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Configuration"));

    const frame = h.frame();
    expect(frame).toContain("Aggregate");
    expect(frame).toContain("p95(span.duration)");
    expect(frame).toContain("Query");
    // Untrimmed here, where the row mid-ellipsises it to forty cells.
    expect(frame).toContain("transaction:/checkout span.op:http.server");
    expect(frame).toContain("Environment");
    expect(frame).toContain("production");
    expect(frame).toContain("Threshold");
    expect(frame).toContain(">500ms high");
  } finally {
    await h.cleanup();
  }
});

test("a cron monitor shows its schedule and its check-in settings", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 1);
    await h.waitForFrame((f) => f.includes("Configuration"));

    const frame = h.frame();
    expect(frame).toContain("Schedule");
    expect(frame).toContain("Every day at 09:00");
    expect(frame).toContain("Timezone");
    expect(frame).toContain("UTC");
    expect(frame).toContain("Environments");
  } finally {
    await h.cleanup();
  }
});

test("an uptime monitor shows the URL it checks, whole", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 2);
    await h.waitForFrame((f) => f.includes("Configuration"));

    const frame = h.frame();
    expect(frame).toContain("URL");
    expect(frame).toContain("https://example.com/pricing?utm_source=sentry-tui-fixture");
    expect(frame).toContain("Interval");
    expect(frame).toContain("Every 1m");
  } finally {
    await h.cleanup();
  }
});

test("a disabled mobile build monitor says so, and shows its measurement", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 3);
    await h.waitForFrame((f) => f.includes("Configuration"));

    const frame = h.frame();
    expect(frame).toContain("android download size");
    expect(frame).toContain("disabled");
    expect(frame).toContain("Measurement");
    expect(frame).toContain("download_size");
  } finally {
    await h.cleanup();
  }
});

test("an error monitor says it has no settings rather than showing an empty section", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 4);
    await h.waitForFrame((f) => f.includes("Configuration"));
    expect(h.frame()).toContain("no settings");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Open periods and alerts
// ---------------------------------------------------------------------------

test("open periods list the ongoing one and the closed ones", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }));
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Open Periods"));

    const frame = h.frame();
    expect(frame).toContain("Open Periods (2)");
    expect(frame).toContain("All 2 in the last 14d, newest first.");
    expect(frame).toContain("#8801");
    expect(frame).toContain("2026-08-21 06:00");
    expect(frame).toContain("ongoing");
    // The closed one carries its end and how long it lasted.
    expect(frame).toContain("2026-08-19 11:45");
    expect(frame).toContain("2h");

    const request = calls.find((url) => url.includes("/open-periods/"))!;
    expect(new URL(request).searchParams.get("statsPeriod")).toBe("14d");
  } finally {
    await h.cleanup();
  }
});

test("no open periods names the selected window rather than claiming it never fired", async () => {
  const h = await renderMonitors(stubClient({ openPeriods: [] }));
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Open Periods"));
    expect(h.frame()).toContain("No open periods in the last 14d");
  } finally {
    await h.cleanup();
  }
});

test("a capped open-period page states its total and how many rows are hidden", async () => {
  const h = await renderMonitors(stubClient({ openPeriodsTotal: 5, openPeriodsHasMore: true }));
  try {
    await openRow(h);
    await h.waitForFrame((frame) => frame.includes("Open Periods (2 of 5)"));

    expect(h.frame()).toContain("Newest 2 in the last 14d; 3 older not shown.");
  } finally {
    await h.cleanup();
  }
});

test("a capped page remains honest when the endpoint omits its total", async () => {
  const h = await renderMonitors(stubClient({ openPeriodsHasMore: true }));
  try {
    await openRow(h);
    await h.waitForFrame((frame) => frame.includes("Open Periods (2+)"));

    expect(h.frame()).toContain("older periods not shown");
  } finally {
    await h.cleanup();
  }
});

test("a failed open-periods request costs that section, not the pane", async () => {
  const h = await renderMonitors(stubClient({ openPeriodsStatus: 500 }));
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Failed to load open periods"));

    const frame = h.frame();
    // The rest of the pane is still there.
    expect(frame).toContain("Configuration");
    expect(frame).toContain("Connected Alerts");
  } finally {
    await h.cleanup();
  }
});

test("connected alerts show what they notify and when they last fired", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Connected Alerts"));

    const frame = h.frame();
    expect(frame).toContain("Connected Alerts (2)");
    expect(frame).toContain("Page the on-call");
    expect(frame).toContain("Pagerduty, Slack");
    expect(frame).toContain("Weekly digest");
    expect(frame).toContain("last fired never");
  } finally {
    await h.cleanup();
  }
});

test("a monitor with no alerts says so", async () => {
  const h = await renderMonitors(stubClient({ workflows: [] }));
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Connected Alerts"));
    expect(h.frame()).toContain("No alerts are connected");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

test("the sections fold by the digit printed in their headers", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Aggregate"));
    expect(h.frame()).toContain("▾ 1 Configuration");

    await h.press((i) => i.pressKey("1"));
    expect(h.frame()).toContain("▸ 1 Configuration");
    expect(h.frame()).not.toContain("Aggregate");

    // z folds the rest with it, and unfolds everything again.
    await h.press((i) => i.pressKey("z"));
    expect(h.frame()).not.toContain("#8801");
    await h.press((i) => i.pressKey("z"));
    expect(h.frame()).toContain("Aggregate");
    expect(h.frame()).toContain("#8801");
  } finally {
    await h.cleanup();
  }
});

test("the Details section carries the ids and dates the header has no room for", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Details"));

    const frame = h.frame();
    expect(frame).toContain("Monitor ID");
    expect(frame).toContain("Last issue");
    expect(frame).toContain("JAVASCRIPT-7");
    expect(frame.split("\n").find((line) => line.includes("Created by"))).toContain("Ada Lovelace");
  } finally {
    await h.cleanup();
  }
});

test("a missing monitor creator is identified as a deactivated user", async () => {
  const h = await renderMonitors(stubClient({ members: [] }));
  try {
    await openRow(h);
    await h.waitForFrame((frame) => frame.includes("Deactivated user"));
    expect(
      h
        .frame()
        .split("\n")
        .find((line) => line.includes("Created by")),
    ).toContain("Deactivated user");
  } finally {
    await h.cleanup();
  }
});

test("a Sentry-created monitor names Sentry without loading members", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }));
  try {
    await openRow(h, 1);
    await h.waitForFrame((frame) => frame.includes("Created by"));
    expect(
      h
        .frame()
        .split("\n")
        .find((line) => line.includes("Created by")),
    ).toContain("Sentry");
    expect(calls.some((url) => url.includes("/users/"))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

test("the member directory is reused when a monitor detail is reopened", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }));
  try {
    await openRow(h);
    await h.waitForFrame((frame) => frame.includes("Created by"));
    await h.pressEscape();
    await h.waitForFrame((frame) => frame.includes("Last Issue"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("Created by"));

    expect(calls.filter((url) => url.includes("/users/"))).toHaveLength(1);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The check-in timeline
// ---------------------------------------------------------------------------

/**
 * How many cells the drawn track occupies, found by the line carrying it.
 *
 * Counted rather than measured off the pane, because a sparse monitor draws a
 * comb — hourly check-ins across ninety cells are three empty cells between
 * each — and that is deliberate, so the track is glyphs *and* the empty cells
 * between them.
 */
function trackWidth(frame: string, glyphs: readonly string[]): number {
  const track = new Set([...glyphs, TIMELINE_EMPTY_GLYPH]);
  let best = 0;
  for (const line of frame.split("\n")) {
    let run = 0;
    for (const character of line) {
      run = track.has(character) ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  return best;
}

test("a cron monitor's detail draws its check-in history across the pane", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 1);
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));

    const frame = h.frame();
    expect(frame).toContain("▾ 2 Check-ins");
    // The window is stated: there is no axis under a track, here either.
    expect(frame).toContain(timelineWindowLabel());
    // The failing hour is drawn, and the tally under it counts both.
    expect(frame).toContain(CRON_GLYPHS.error);
    expect(frame).toContain("23 Okay");
    expect(frame).toContain("2 Failed");
  } finally {
    await h.cleanup();
  }
});

test("the pane's track is wider than the column the row squeezes it into", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 1);
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.ok));

    // The whole point of the detail-pane timeline: the list caps the column at
    // `TIMELINE_MAX_WIDTH`, and the pane is not a column.
    expect(trackWidth(h.frame(), Object.values(CRON_GLYPHS))).toBeGreaterThan(TIMELINE_MAX_WIDTH);
  } finally {
    await h.cleanup();
  }
});

test("an uptime monitor's detail draws its own history", async () => {
  const h = await renderMonitors();
  try {
    await openRow(h, 2);
    await h.waitForFrame((f) => f.includes(UPTIME_GLYPHS.success));

    const frame = h.frame();
    expect(frame).toContain("▾ 2 Check-ins");
    expect(frame).toContain(UPTIME_GLYPHS.failure_incident);
  } finally {
    await h.cleanup();
  }
});

/**
 * A failed stats request must draw the unlit track, never the pending rail —
 * a pane that starts drawing the rail on an error never stops — and it has to
 * say so, because a degraded track is indistinguishable from a monitor that
 * has never checked in.
 */
test("a failed stats request degrades loudly, not into a permanent rail", async () => {
  const h = await renderMonitors(stubClient({ failStats: true }));
  try {
    await openRow(h, 1);
    await h.waitForFrame((f) => f.includes("check-in history unavailable"));

    const frame = h.frame();
    expect(frame).toContain("▾ 2 Check-ins");
    expect(frame).not.toContain(TIMELINE_PENDING_GLYPH.repeat(8));
    // And the sections around it are untouched.
    expect(frame).toContain("Configuration");
    expect(frame).toContain("Open Periods");
  } finally {
    await h.cleanup();
  }
});

test("a monitor with no check-in history has no Check-ins section at all", async () => {
  const h = await renderMonitors();
  try {
    // The metric monitor: nothing checks in, so the section would be a heading
    // over an empty track claiming it never had.
    await openRow(h);
    await h.waitForFrame((f) => f.includes("Configuration"));

    const frame = h.frame();
    expect(frame).not.toContain("Check-ins");
    // And the sections that do exist stay numbered from one, contiguously.
    expect(frame).toContain("▾ 1 Configuration");
    expect(frame).toContain("▾ 2 Open Periods");
    expect(frame).toContain("▾ 3 Connected Alerts");
    expect(frame).toContain("▾ 4 Details");
  } finally {
    await h.cleanup();
  }
});

test("a cron detector with no monitor behind it says so rather than drawing nothing", async () => {
  const sessionCleanup = detectorListFixture.find((detector) => detector.id === "6")!;
  const h = await renderMonitors(
    stubClient({
      detectors: [
        {
          ...sessionCleanup,
          dataSources: [{ id: "31", type: "cron_monitor", queryObj: null }],
        },
      ],
    }),
  );
  try {
    await h.waitForFrame((frame) => frame.includes("session-cleanup"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((f) => f.includes("Check-ins"));
    expect(h.frame()).toContain("no check-in source");
  } finally {
    await h.cleanup();
  }
});
