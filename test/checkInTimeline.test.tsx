/**
 * The check-in timeline as it actually reaches a terminal.
 *
 * `src/lib/checkInTimeline.test.ts` pins the folding arithmetic; this pins
 * what gets drawn: the row is exactly as wide as the column it was given, the
 * glyphs survive the renderer, and each status arrives wearing its own colour
 * rather than the one next to it.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { timelineStylesFor } from "~/core/checkInTimeline";
import { darkTheme } from "~/core/theme";
import {
  CRON_GLYPHS,
  TIMELINE_EMPTY_GLYPH,
  TIMELINE_PENDING_GLYPH,
  UPTIME_GLYPHS,
} from "~/lib/checkInTimeline";
import { CheckInTimeline } from "~/ui/components/CheckInTimeline";
import { selectEnvironment } from "~/api/monitorStats";
import { cronBuckets, uptimeBuckets, useCheckInStats } from "~/ui/hooks/useCheckInStats";
import { renderHarness } from "./helpers";

const { cron: CRON_TIMELINE_STYLE, uptime: UPTIME_TIMELINE_STYLE } = timelineStylesFor(darkTheme);
import {
  CHECKOUT_UPTIME_ID,
  DAY_SECONDS,
  NIGHTLY_ROLLUP_ID,
  SESSION_CLEANUP_ID,
  cronDay,
  monitorStatsFixture,
  uptimeDay,
  uptimeStatsFixture,
} from "./timeline-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const SINCE = 1_760_000_000;
const UNTIL = SINCE + DAY_SECONDS;
const HARNESS = { width: 60, height: 6 };

/** The one line the timeline drew, trimmed of the pane's padding. */
function row(frame: string): string {
  return frame.split("\n")[0]!.trimEnd();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

test("a healthy cron day draws one glyph per cell, all okay", async () => {
  const h = await renderHarness(
    <CheckInTimeline
      buckets={selectEnvironment(cronDay(SINCE))}
      style={CRON_TIMELINE_STYLE}
      width={24}
      since={SINCE}
      until={UNTIL}
    />,
    HARNESS,
  );
  try {
    expect(row(h.frame())).toBe(CRON_GLYPHS.ok.repeat(24));
  } finally {
    await h.cleanup();
  }
});

test("failures and timeouts spike out of the row, and only they fill the cell", async () => {
  const day = cronDay(SINCE, { failures: { 6: { ok: 0, error: 2 }, 14: { ok: 0, timeout: 1 } } });
  const h = await renderHarness(
    <CheckInTimeline
      buckets={selectEnvironment(day)}
      style={CRON_TIMELINE_STYLE}
      width={24}
      since={SINCE}
      until={UNTIL}
    />,
    HARNESS,
  );
  try {
    const drawn = row(h.frame());
    expect(drawn[6]).toBe(CRON_GLYPHS.error);
    expect(drawn[14]).toBe(CRON_GLYPHS.timeout);
    // Legible with the colour taken away: exactly one cell is full height.
    expect([...drawn].filter((glyph) => glyph === "█")).toHaveLength(1);
  } finally {
    await h.cleanup();
  }
});

test("each status reaches the terminal in its own colour", async () => {
  const day = cronDay(SINCE, { failures: { 6: { ok: 0, error: 2 }, 14: { ok: 0, timeout: 1 } } });
  const h = await renderHarness(
    <CheckInTimeline
      buckets={selectEnvironment(day)}
      style={CRON_TIMELINE_STYLE}
      width={24}
      since={SINCE}
      until={UNTIL}
    />,
    HARNESS,
  );
  try {
    const ok = h.spanContaining(CRON_GLYPHS.ok);
    const error = h.spanContaining(CRON_GLYPHS.error);
    const timeout = h.spanContaining(CRON_GLYPHS.timeout);

    expect(ok?.fg).toBeDefined();
    expect(error?.fg).not.toEqual(ok?.fg);
    expect(timeout?.fg).not.toEqual(ok?.fg);
    expect(timeout?.fg).not.toEqual(error?.fg);
  } finally {
    await h.cleanup();
  }
});

test("windows with no check-ins draw the unlit track, dimmer than a check-in", async () => {
  // One check-in at the start of the day, nothing after it.
  const h = await renderHarness(
    <CheckInTimeline
      buckets={selectEnvironment(cronDay(SINCE, { hours: 1 }))}
      style={CRON_TIMELINE_STYLE}
      width={20}
      since={SINCE}
      until={UNTIL}
    />,
    HARNESS,
  );
  try {
    expect(row(h.frame())).toBe(`${CRON_GLYPHS.ok}${TIMELINE_EMPTY_GLYPH.repeat(19)}`);
    expect(h.spanContaining(TIMELINE_EMPTY_GLYPH)?.fg).not.toEqual(
      h.spanContaining(CRON_GLYPHS.ok)?.fg,
    );
  } finally {
    await h.cleanup();
  }
});

test("stats still in flight draw a dashed rail of the same width", async () => {
  const h = await renderHarness(
    <CheckInTimeline
      buckets={undefined}
      style={CRON_TIMELINE_STYLE}
      width={18}
      since={SINCE}
      until={UNTIL}
    />,
    HARNESS,
  );
  try {
    expect(row(h.frame())).toBe(TIMELINE_PENDING_GLYPH.repeat(18));
  } finally {
    await h.cleanup();
  }
});

test("an uptime row draws its own vocabulary", async () => {
  const h = await renderHarness(
    <CheckInTimeline
      buckets={uptimeDay(SINCE, { failures: [9], incidents: [10, 11] })}
      style={UPTIME_TIMELINE_STYLE}
      width={24}
      since={SINCE}
      until={UNTIL}
    />,
    HARNESS,
  );
  try {
    const drawn = row(h.frame());
    expect(drawn[9]).toBe(UPTIME_GLYPHS.failure);
    expect(drawn[10]).toBe(UPTIME_GLYPHS.failure_incident);
    expect(drawn[11]).toBe(UPTIME_GLYPHS.failure_incident);
    expect(drawn[0]).toBe(UPTIME_GLYPHS.success);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Reflow
// ---------------------------------------------------------------------------

/**
 * The row is exactly the width it was given, at every width — which is what
 * lets it live in a fixed-width table cell without the column measuring it.
 */
for (const width of [1, 8, 24, 40] as const) {
  test(`the drawn row is exactly ${width} cells wide`, async () => {
    const h = await renderHarness(
      <CheckInTimeline
        buckets={selectEnvironment(cronDay(SINCE))}
        style={CRON_TIMELINE_STYLE}
        width={width}
        since={SINCE}
        until={UNTIL}
      />,
      { width: 60, height: 4 },
    );
    try {
      expect(row(h.frame())).toHaveLength(width);
    } finally {
      await h.cleanup();
    }
  });
}

test("a resize reflows the same day rather than clipping it", async () => {
  const day = selectEnvironment(cronDay(SINCE, { failures: { 12: { ok: 0, error: 1 } } }));

  for (const width of [12, 24, 48]) {
    const h = await renderHarness(
      <CheckInTimeline
        buckets={day}
        style={CRON_TIMELINE_STYLE}
        width={width}
        since={SINCE}
        until={UNTIL}
      />,
      { width: 60, height: 4 },
    );
    try {
      const drawn = row(h.frame());
      expect(drawn).toHaveLength(width);
      // Noon stays at noon: half way along, whatever the width.
      expect(drawn.indexOf(CRON_GLYPHS.error)).toBe(width / 2);
    } finally {
      await h.cleanup();
    }
  }
});

test("a zero-width column draws nothing rather than a stray character", async () => {
  const h = await renderHarness(
    <CheckInTimeline
      buckets={selectEnvironment(cronDay(SINCE))}
      style={CRON_TIMELINE_STYLE}
      width={0}
      since={SINCE}
      until={UNTIL}
    />,
    { width: 20, height: 3 },
  );
  try {
    expect(row(h.frame())).toBe("");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// useCheckInStats
// ---------------------------------------------------------------------------

interface ProbeProps {
  client: SentryClient | null;
  monitorIds?: string[];
  uptimeDetectorIds?: string[];
}

/** Mounts the hook and prints what a row would draw with what it returned. */
function StatsProbe({ client, monitorIds = [], uptimeDetectorIds = [] }: ProbeProps) {
  const status = useCheckInStats(client, {
    org: "acme",
    monitorIds,
    uptimeDetectorIds,
    width: 24,
  });
  const stats = status.state === "ready" ? status.value : undefined;

  return (
    <box style={{ flexDirection: "column" }}>
      <text>{`state:${status.state}`}</text>
      <CheckInTimeline
        buckets={cronBuckets(stats, monitorIds[0])}
        style={CRON_TIMELINE_STYLE}
        width={24}
        since={stats?.window.since ?? 0}
        until={stats?.window.until ?? 0}
      />
      <CheckInTimeline
        buckets={uptimeBuckets(stats, uptimeDetectorIds[0])}
        style={UPTIME_TIMELINE_STYLE}
        width={24}
        since={stats?.window.since ?? 0}
        until={stats?.window.until ?? 0}
      />
    </box>
  );
}

function statsClient(calls?: string[], { failUptime = false } = {}) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls?.push(url);
    const since = Number(new URL(url).searchParams.get("since"));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/monitors-stats/")) return json(monitorStatsFixture(since));
    if (url.includes("/uptime-stats/")) {
      return failUptime ? json({ detail: "nope" }, 500) : json(uptimeStatsFixture(since));
    }
    return json({});
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

test("one request per endpoint covers every row on the page", async () => {
  const calls: string[] = [];
  const h = await renderHarness(
    <StatsProbe
      client={statsClient(calls)}
      monitorIds={[NIGHTLY_ROLLUP_ID, SESSION_CLEANUP_ID]}
      uptimeDetectorIds={[CHECKOUT_UPTIME_ID]}
    />,
    { width: 40, height: 8 },
  );
  try {
    await h.waitForFrame((f) => f.includes("state:ready"));

    expect(calls.filter((url) => url.includes("/monitors-stats/"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/uptime-stats/"))).toHaveLength(1);
    // Both monitors travelled in the one request.
    const monitors = new URL(calls.find((u) => u.includes("/monitors-stats/"))!).searchParams;
    expect(monitors.getAll("monitor")).toHaveLength(2);
  } finally {
    await h.cleanup();
  }
});

test("the fetched stats reach the rows they belong to", async () => {
  const h = await renderHarness(
    <StatsProbe
      client={statsClient()}
      monitorIds={[SESSION_CLEANUP_ID]}
      uptimeDetectorIds={[CHECKOUT_UPTIME_ID]}
    />,
    { width: 40, height: 8 },
  );
  try {
    await h.waitForFrame((f) => f.includes(CRON_GLYPHS.error));

    const lines = h.frame().split("\n");
    const cron = lines[1]!.trimEnd();
    const uptime = lines[2]!.trimEnd();

    expect(cron).toHaveLength(24);
    expect(cron).toContain(CRON_GLYPHS.error);
    expect(cron).toContain(CRON_GLYPHS.timeout);

    expect(uptime).toHaveLength(24);
    expect(uptime).toContain(UPTIME_GLYPHS.failure_incident);
  } finally {
    await h.cleanup();
  }
});

test("no rows to draw means no request, and no resolved empty page either", async () => {
  const calls: string[] = [];
  const h = await renderHarness(<StatsProbe client={statsClient(calls)} />, {
    width: 40,
    height: 8,
  });
  try {
    // Idle, not ready: a resolved empty page is a value, and `startLoading`
    // would carry it into the first real load as though it were data.
    expect(h.frame()).toContain("state:idle");
    expect(calls).toEqual([]);
  } finally {
    await h.cleanup();
  }
});

test("a failing stats request leaves an error state, not a half-drawn page", async () => {
  const h = await renderHarness(
    <StatsProbe
      client={statsClient(undefined, { failUptime: true })}
      monitorIds={[NIGHTLY_ROLLUP_ID]}
      uptimeDetectorIds={[CHECKOUT_UPTIME_ID]}
    />,
    { width: 40, height: 8 },
  );
  try {
    await h.waitForFrame((f) => f.includes("state:error"));
    // Both rows fall back to the pending rail rather than claiming health.
    const lines = h.frame().split("\n");
    expect(lines[1]!.trimEnd()).toBe(TIMELINE_PENDING_GLYPH.repeat(24));
    expect(lines[2]!.trimEnd()).toBe(TIMELINE_PENDING_GLYPH.repeat(24));
  } finally {
    await h.cleanup();
  }
});

test("a client that is not signed in yet asks for nothing", async () => {
  const h = await renderHarness(<StatsProbe client={null} monitorIds={[NIGHTLY_ROLLUP_ID]} />, {
    width: 40,
    height: 8,
  });
  try {
    expect(h.frame()).toContain("state:idle");
  } finally {
    await h.cleanup();
  }
});
