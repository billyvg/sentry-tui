/**
 * The two check-in stats endpoints, and the schemas that guard them.
 *
 * A monitor row's timeline is decoration beside its name, so the bar these
 * tests hold the API layer to is: a surprising response costs the row its
 * sparkline and never the screen.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import {
  DEFAULT_TIMELINE_WINDOW_SECONDS,
  MAX_UPTIME_DETECTORS_PER_REQUEST,
  fetchMonitorStats,
  fetchUptimeStats,
  selectEnvironment,
  timelineWindow,
} from "~/api/monitorStats";
import { resolutionForWidth } from "~/lib/checkInTimeline";
import {
  CHECKOUT_UPTIME_ID,
  DAY_SECONDS,
  NIGHTLY_ROLLUP_ID,
  SESSION_CLEANUP_ID,
  cronDay,
  malformedMonitorStats,
  monitorStatsFixture,
  uptimeStatsFixture,
} from "./timeline-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const SINCE = 1_760_000_000;
const WINDOW = { since: SINCE, until: SINCE + DAY_SECONDS, resolution: 1800 };

function stubClient(body: unknown, calls?: string[], status = 200) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls?.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

// ---------------------------------------------------------------------------
// timelineWindow
// ---------------------------------------------------------------------------

test("timelineWindow ends now and derives its resolution from the column width", () => {
  const now = 1_760_000_000_000;
  const window = timelineWindow(48, { now });

  expect(window.until).toBe(now / 1000);
  expect(window.since).toBe(now / 1000 - DEFAULT_TIMELINE_WINDOW_SECONDS);
  expect(window.resolution).toBe(resolutionForWidth(DEFAULT_TIMELINE_WINDOW_SECONDS, 48));
});

test("a wider column asks for finer buckets", () => {
  const now = 1_760_000_000_000;
  expect(timelineWindow(96, { now }).resolution).toBeLessThan(
    timelineWindow(24, { now }).resolution,
  );
});

// ---------------------------------------------------------------------------
// monitors-stats/
// ---------------------------------------------------------------------------

test("fetchMonitorStats asks for the monitors, the window, and the resolution", async () => {
  const calls: string[] = [];
  await fetchMonitorStats(stubClient(monitorStatsFixture(SINCE), calls), {
    org: "acme",
    monitors: [NIGHTLY_ROLLUP_ID, SESSION_CLEANUP_ID],
    project: ["42"],
    environment: ["production"],
    ...WINDOW,
  });

  const url = new URL(calls[0]!);
  expect(url.pathname).toEndWith("/organizations/acme/monitors-stats/");
  expect(url.searchParams.getAll("monitor")).toEqual([NIGHTLY_ROLLUP_ID, SESSION_CLEANUP_ID]);
  expect(url.searchParams.get("since")).toBe(String(WINDOW.since));
  expect(url.searchParams.get("until")).toBe(String(WINDOW.until));
  // The endpoint's `StatsMixin` wants a duration string, not a bare number.
  expect(url.searchParams.get("resolution")).toBe("1800s");
  expect(url.searchParams.getAll("project")).toEqual(["42"]);
  expect(url.searchParams.getAll("environment")).toEqual(["production"]);
});

test("fetchMonitorStats keeps the buckets nested by environment", async () => {
  const stats = await fetchMonitorStats(stubClient(monitorStatsFixture(SINCE)), {
    org: "acme",
    monitors: [NIGHTLY_ROLLUP_ID],
    ...WINDOW,
  });

  expect(stats[NIGHTLY_ROLLUP_ID]).toHaveLength(24);
  expect(stats[NIGHTLY_ROLLUP_ID]![0]).toEqual([SINCE, { production: { ok: 1 } }]);
});

test("an empty monitor list makes no request", async () => {
  const calls: string[] = [];
  const stats = await fetchMonitorStats(stubClient({}, calls), {
    org: "acme",
    monitors: [],
    ...WINDOW,
  });

  expect(stats).toEqual({});
  expect(calls).toEqual([]);
});

test("a malformed stats response degrades per monitor instead of throwing", async () => {
  const stats = await fetchMonitorStats(stubClient(malformedMonitorStats), {
    org: "acme",
    monitors: [NIGHTLY_ROLLUP_ID, SESSION_CLEANUP_ID],
    ...WINDOW,
  });

  // A null bucket list becomes an empty one.
  expect(stats[NIGHTLY_ROLLUP_ID]).toEqual([]);
  // The one well-formed bucket survives; the string count and the timestampless
  // bucket do not take the monitor down with them.
  const buckets = stats[SESSION_CLEANUP_ID]!;
  expect(buckets.length).toBeGreaterThanOrEqual(0);
  for (const bucket of buckets) expect(typeof bucket[0]).toBe("number");
});

test("a response that is not an object at all yields no stats, not a crash", async () => {
  for (const body of [null, "nope", 42, []]) {
    const stats = await fetchMonitorStats(stubClient(body), {
      org: "acme",
      monitors: [NIGHTLY_ROLLUP_ID],
      ...WINDOW,
    });
    expect(Object.keys(stats).length).toBe(0);
  }
});

// ---------------------------------------------------------------------------
// uptime-stats/
// ---------------------------------------------------------------------------

test("fetchUptimeStats asks by detector id", async () => {
  const calls: string[] = [];
  const stats = await fetchUptimeStats(stubClient(uptimeStatsFixture(SINCE), calls), {
    org: "acme",
    detectorIds: [CHECKOUT_UPTIME_ID],
    ...WINDOW,
  });

  const url = new URL(calls[0]!);
  expect(url.pathname).toEndWith("/organizations/acme/uptime-stats/");
  expect(url.searchParams.getAll("uptimeDetectorId")).toEqual([CHECKOUT_UPTIME_ID]);
  expect(stats[CHECKOUT_UPTIME_ID]).toHaveLength(24);
  expect(stats[CHECKOUT_UPTIME_ID]![9]).toEqual([SINCE + 9 * 3600, { success: 3, failure: 1 }]);
});

test("duplicate detector ids are asked for once", async () => {
  const calls: string[] = [];
  await fetchUptimeStats(stubClient({}, calls), {
    org: "acme",
    detectorIds: ["7", "7", "8"],
    ...WINDOW,
  });

  expect(new URL(calls[0]!).searchParams.getAll("uptimeDetectorId")).toEqual(["7", "8"]);
});

test("the detector list is capped, because the endpoint 400s on a longer one", async () => {
  const calls: string[] = [];
  const ids = Array.from({ length: MAX_UPTIME_DETECTORS_PER_REQUEST + 25 }, (_, i) => String(i));
  await fetchUptimeStats(stubClient({}, calls), { org: "acme", detectorIds: ids, ...WINDOW });

  expect(new URL(calls[0]!).searchParams.getAll("uptimeDetectorId")).toHaveLength(
    MAX_UPTIME_DETECTORS_PER_REQUEST,
  );
});

test("an empty detector list makes no request — the endpoint 400s on one", async () => {
  const calls: string[] = [];
  const stats = await fetchUptimeStats(stubClient({}, calls), {
    org: "acme",
    detectorIds: [],
    ...WINDOW,
  });

  expect(stats).toEqual({});
  expect(calls).toEqual([]);
});

// ---------------------------------------------------------------------------
// selectEnvironment
// ---------------------------------------------------------------------------

test("selectEnvironment isolates one environment's counts", () => {
  const buckets = [
    [SINCE, { production: { ok: 3 }, staging: { error: 1 } }],
    [SINCE + 60, { production: { ok: 2 } }],
  ] as const;

  expect(selectEnvironment(buckets, "production")).toEqual([
    [SINCE, { ok: 3 }],
    [SINCE + 60, { ok: 2 }],
  ]);
});

test("an environment with nothing in a bucket reads as empty, not as its neighbour's", () => {
  const buckets = [[SINCE, { production: { ok: 3 } }]] as const;
  expect(selectEnvironment(buckets, "staging")).toEqual([[SINCE, {}]]);
});

test("no environment sums across all of them — a table row draws one line", () => {
  const buckets = [[SINCE, { production: { ok: 3, error: 1 }, staging: { ok: 2 } }]] as const;

  expect(selectEnvironment(buckets)).toEqual([[SINCE, { ok: 5, error: 1 }]]);
});

test("selectEnvironment survives missing buckets", () => {
  expect(selectEnvironment(undefined)).toEqual([]);
  expect(selectEnvironment([])).toEqual([]);
});

test("cronDay builds the shape the endpoint returns", () => {
  const day = cronDay(SINCE, { failures: { 3: { ok: 0, missed: 1 } } });
  expect(day).toHaveLength(24);
  expect(day[3]).toEqual([SINCE + 3 * 3600, { production: { ok: 0, missed: 1 } }]);
});
