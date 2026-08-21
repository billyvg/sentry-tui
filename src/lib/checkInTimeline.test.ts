import { describe, expect, test } from "bun:test";

import {
  CRON_GLYPHS,
  CRON_TIMELINE,
  MIN_RESOLUTION_SECONDS,
  TIMELINE_EMPTY_GLYPH,
  TIMELINE_PENDING_GLYPH,
  TIMELINE_UNRECOGNISED_GLYPH,
  UPTIME_GLYPHS,
  UPTIME_TIMELINE,
  foldCheckIns,
  pendingTimeline,
  resolutionForWidth,
  summariseTimeline,
  timelineGlyphs,
  type CronCheckInStatus,
  type StatsBucket,
  type TimelineStatusConfig,
} from "~/lib/checkInTimeline";
import { measureTextWidth } from "~/lib/text";

const HOUR = 3600;
const DAY = 24 * HOUR;
const SINCE = 1_760_000_000;
const UNTIL = SINCE + DAY;

/** A cron bucket, `[timestamp, counts]`, at `offset` seconds into the window. */
function bucket(
  offset: number,
  counts: Partial<Record<CronCheckInStatus, number>>,
): StatsBucket<CronCheckInStatus> {
  return [SINCE + offset, counts];
}

/** Fold a cron window at the given width and return the drawn row. */
function draw(
  buckets: ReadonlyArray<StatsBucket<CronCheckInStatus>>,
  width: number,
  window: { since?: number; until?: number } = {},
): string {
  return timelineGlyphs(
    foldCheckIns(buckets, {
      width,
      since: window.since ?? SINCE,
      until: window.until ?? UNTIL,
      config: CRON_TIMELINE,
    }),
  );
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

describe("glyphs", () => {
  test("every status draws a distinct character, so colour is never the only signal", () => {
    for (const glyphs of [CRON_GLYPHS, UPTIME_GLYPHS]) {
      const drawn = Object.values(glyphs);
      expect(new Set(drawn).size).toBe(drawn.length);
    }
  });

  test("ok and error are the pair that must never collide", () => {
    expect(CRON_GLYPHS.ok).not.toBe(CRON_GLYPHS.error);
    expect(UPTIME_GLYPHS.success).not.toBe(UPTIME_GLYPHS.failure);
    expect(UPTIME_GLYPHS.success).not.toBe(UPTIME_GLYPHS.failure_incident);
  });

  test("only a failure fills the cell, so a bad minute spikes out of a healthy row", () => {
    expect(CRON_GLYPHS.error).toBe("█");
    expect(UPTIME_GLYPHS.failure_incident).toBe("█");
    for (const [status, glyph] of Object.entries(CRON_GLYPHS)) {
      if (status !== "error") expect(glyph).not.toBe("█");
    }
  });

  test("no glyph collides with the empty track or the pending placeholder", () => {
    for (const glyphs of [CRON_GLYPHS, UPTIME_GLYPHS]) {
      for (const [status, glyph] of Object.entries(glyphs)) {
        expect(glyph).not.toBe(TIMELINE_EMPTY_GLYPH);
        expect(glyph).not.toBe(TIMELINE_PENDING_GLYPH);
        // `unknown` deliberately *is* the unrecognised glyph — same meaning.
        if (status !== "unknown" && status !== "missed_window") {
          expect(glyph).not.toBe(TIMELINE_UNRECOGNISED_GLYPH);
        }
      }
    }
  });

  /**
   * Display width, not code-point count — that is the property the row's
   * alignment rests on. `foldCheckIns` emits one glyph per cell and the caller
   * pads nothing, so a glyph that measured two cells would push every column
   * to its right off the pane. Box-drawing characters are width 1 everywhere,
   * but a future "clearer" glyph could easily not be.
   */
  test("every glyph occupies exactly one terminal cell", () => {
    const all = [
      ...Object.values(CRON_GLYPHS),
      ...Object.values(UPTIME_GLYPHS),
      TIMELINE_EMPTY_GLYPH,
      TIMELINE_UNRECOGNISED_GLYPH,
      TIMELINE_PENDING_GLYPH,
    ];
    for (const glyph of all) {
      expect([...glyph]).toHaveLength(1);
      expect(measureTextWidth(glyph)).toBe(1);
    }
  });

  test("a folded row measures exactly as many cells as it was given", () => {
    const buckets = [bucket(0, { ok: 1 }), bucket(HOUR, { error: 1 }), bucket(2 * HOUR, {})];
    for (const width of [1, 7, 24, 61]) {
      expect(measureTextWidth(draw(buckets, width))).toBe(width);
    }
  });

  test("every status in the precedence order has a glyph and a label", () => {
    const configs: Array<TimelineStatusConfig<string>> = [CRON_TIMELINE, UPTIME_TIMELINE];
    for (const config of configs) {
      for (const status of config.precedence) {
        expect(config.glyphs[status]).toBeString();
        expect(config.labels[status]).toBeString();
      }
      // And nothing has a glyph the precedence order forgot, which would make
      // it unreachable.
      expect([...config.precedence].sort()).toEqual(Object.keys(config.glyphs).sort());
    }
  });
});

// ---------------------------------------------------------------------------
// resolutionForWidth
// ---------------------------------------------------------------------------

describe("resolutionForWidth", () => {
  test("asks for about one bucket per cell", () => {
    expect(resolutionForWidth(DAY, 40)).toBe(Math.ceil(DAY / 40));
    expect(resolutionForWidth(DAY, 90)).toBe(Math.ceil(DAY / 90));
  });

  test("a wider column asks for finer buckets", () => {
    expect(resolutionForWidth(DAY, 90)).toBeLessThan(resolutionForWidth(DAY, 40));
  });

  test("never asks for anything finer than a minute", () => {
    expect(resolutionForWidth(HOUR, 600)).toBe(MIN_RESOLUTION_SECONDS);
    expect(resolutionForWidth(30, 30)).toBe(MIN_RESOLUTION_SECONDS);
  });

  test("a nonsense window or width falls back rather than dividing by zero", () => {
    expect(resolutionForWidth(DAY, 0)).toBe(MIN_RESOLUTION_SECONDS);
    expect(resolutionForWidth(0, 40)).toBe(MIN_RESOLUTION_SECONDS);
    expect(resolutionForWidth(Number.NaN, 40)).toBe(MIN_RESOLUTION_SECONDS);
    expect(resolutionForWidth(DAY, Number.POSITIVE_INFINITY)).toBe(MIN_RESOLUTION_SECONDS);
  });

  test("always returns whole seconds — the param is serialised as `{n}s`", () => {
    for (const width of [7, 13, 40, 97]) {
      expect(Number.isInteger(resolutionForWidth(DAY, width))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Width reflow
// ---------------------------------------------------------------------------

describe("width reflow", () => {
  const hourly: Array<StatsBucket<CronCheckInStatus>> = Array.from({ length: 24 }, (_, i) =>
    bucket(i * HOUR, { ok: 1 }),
  );

  test("the row is exactly as wide as the column, whatever the bucket count", () => {
    for (const width of [1, 8, 24, 40, 137]) {
      expect(draw(hourly, width)).toHaveLength(width);
    }
  });

  test("more buckets than cells fold together rather than clipping", () => {
    // 24 buckets into 6 cells: four hours each, all okay.
    expect(draw(hourly, 6)).toBe(CRON_GLYPHS.ok.repeat(6));
  });

  test("a failure survives being folded in with successes", () => {
    const withFailure = hourly.map((b, i) =>
      i === 13 ? bucket(i * HOUR, { ok: 5, error: 1 }) : b,
    );
    // Precedence, not majority: the cell holding hour 13 goes red.
    const row = draw(withFailure, 6);
    expect(row).toBe(`${CRON_GLYPHS.ok.repeat(3)}${CRON_GLYPHS.error}${CRON_GLYPHS.ok.repeat(2)}`);
  });

  test("fewer buckets than cells leaves the rest as unlit track", () => {
    const row = draw([bucket(0, { ok: 1 })], 8);
    expect(row).toBe(`${CRON_GLYPHS.ok}${TIMELINE_EMPTY_GLYPH.repeat(7)}`);
  });

  test("buckets land in the cell their timestamp falls in, not their index", () => {
    // One check-in three quarters of the way through the day.
    const row = draw([bucket(Math.floor(DAY * 0.75), { ok: 1 })], 8);
    expect(row).toBe(`${TIMELINE_EMPTY_GLYPH.repeat(6)}${CRON_GLYPHS.ok}${TIMELINE_EMPTY_GLYPH}`);
  });

  test("a resize moves the same check-in to the proportionally same place", () => {
    const midday = [bucket(DAY / 2, { error: 1 })];
    for (const width of [10, 20, 40]) {
      expect(draw(midday, width).indexOf(CRON_GLYPHS.error)).toBe(width / 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Empty and partial windows
// ---------------------------------------------------------------------------

describe("empty and partial windows", () => {
  test("no data at all is a full row of unlit track", () => {
    expect(draw([], 12)).toBe(TIMELINE_EMPTY_GLYPH.repeat(12));
  });

  test("undefined stats read the same as none — a pane can render before a fetch", () => {
    const cells = foldCheckIns(undefined, {
      width: 5,
      since: SINCE,
      until: UNTIL,
      config: CRON_TIMELINE,
    });
    expect(timelineGlyphs(cells)).toBe(TIMELINE_EMPTY_GLYPH.repeat(5));
  });

  test("a bucket the endpoint returned with all-zero counts is empty, not okay", () => {
    expect(draw([bucket(0, { ok: 0, error: 0 })], 4)).toBe(TIMELINE_EMPTY_GLYPH.repeat(4));
  });

  test("a bucket floored just before the window still draws, in the first cell", () => {
    // `monitors-stats/` floors `since` to a multiple of the rollup.
    const row = draw([bucket(-HOUR, { ok: 1 })], 8);
    expect(row.startsWith(CRON_GLYPHS.ok)).toBe(true);
  });

  test("a bucket landing exactly on `until` draws in the last cell", () => {
    // The same endpoint emits one bucket past the end (`while ts <= end`).
    const row = draw([bucket(DAY, { error: 1 })], 8);
    expect(row).toBe(`${TIMELINE_EMPTY_GLYPH.repeat(7)}${CRON_GLYPHS.error}`);
  });

  test("a zero-width column draws nothing rather than throwing", () => {
    expect(draw([bucket(0, { ok: 1 })], 0)).toBe("");
    expect(draw([bucket(0, { ok: 1 })], -4)).toBe("");
  });

  test("a window with no duration still yields a row of the right width", () => {
    expect(draw([bucket(0, { ok: 1 })], 6, { until: SINCE })).toBe(TIMELINE_EMPTY_GLYPH.repeat(6));
  });

  test("cells tile the window without gaps or overlap", () => {
    const cells = foldCheckIns([], { width: 7, since: SINCE, until: UNTIL, config: CRON_TIMELINE });
    expect(cells[0]!.start).toBe(SINCE);
    expect(cells.at(-1)!.end).toBe(UNTIL);
    for (let i = 1; i < cells.length; i++) expect(cells[i]!.start).toBe(cells[i - 1]!.end);
  });
});

// ---------------------------------------------------------------------------
// Malformed data
// ---------------------------------------------------------------------------

describe("malformed data", () => {
  test("a status this build has never heard of still lights the cell", () => {
    const row = draw([bucket(0, { teleported: 3 } as never)], 4);
    expect(row).toBe(`${TIMELINE_UNRECOGNISED_GLYPH}${TIMELINE_EMPTY_GLYPH.repeat(3)}`);
  });

  test("a known status wins over an unknown one in the same bucket", () => {
    const row = draw([bucket(0, { teleported: 9, error: 1 } as never)], 4);
    expect(row.startsWith(CRON_GLYPHS.error)).toBe(true);
  });

  test("counts that are not positive numbers cannot light a cell", () => {
    const junk = { ok: null, error: "3", missed: -2, timeout: Number.NaN } as never;
    expect(draw([bucket(0, junk)], 4)).toBe(TIMELINE_EMPTY_GLYPH.repeat(4));
  });

  test("a malformed bucket is skipped rather than taking down the row", () => {
    const buckets = [
      undefined as never,
      [null, { ok: 1 }] as never,
      ["nope", { ok: 1 }] as never,
      bucket(0, { ok: 1 }),
    ];
    expect(draw(buckets, 4)).toBe(`${CRON_GLYPHS.ok}${TIMELINE_EMPTY_GLYPH.repeat(3)}`);
  });
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

describe("precedence", () => {
  test("cron precedence matches the web's, worst first", () => {
    expect(CRON_TIMELINE.precedence).toEqual([
      "unknown",
      "error",
      "timeout",
      "missed",
      "ok",
      "in_progress",
    ]);
  });

  test("one failure among a hundred successes still draws the failure", () => {
    expect(draw([bucket(0, { ok: 100, error: 1 })], 1)).toBe(CRON_GLYPHS.error);
  });

  test("uptime prefers an incident over a bare failure", () => {
    const cells = foldCheckIns([[SINCE, { failure: 4, failure_incident: 1, success: 20 }]], {
      width: 1,
      since: SINCE,
      until: UNTIL,
      config: UPTIME_TIMELINE,
    });
    expect(cells[0]!.status).toBe("failure_incident");
    expect(cells[0]!.glyph).toBe(UPTIME_GLYPHS.failure_incident);
  });
});

// ---------------------------------------------------------------------------
// Cell contents and summary
// ---------------------------------------------------------------------------

describe("cell contents", () => {
  test("a cell keeps every count folded into it, not just the winner", () => {
    const cells = foldCheckIns([bucket(0, { ok: 10, error: 2 }), bucket(60, { ok: 5 })], {
      width: 1,
      since: SINCE,
      until: UNTIL,
      config: CRON_TIMELINE,
    });
    expect(cells[0]!.counts).toEqual({ ok: 15, error: 2 });
    expect(cells[0]!.total).toBe(17);
    expect(cells[0]!.status).toBe("error");
  });

  test("summariseTimeline totals the row in precedence order, dropping empties", () => {
    const cells = foldCheckIns(
      [bucket(0, { ok: 10, error: 2 }), bucket(DAY / 2, { ok: 5, missed: 1 })],
      { width: 8, since: SINCE, until: UNTIL, config: CRON_TIMELINE },
    );
    expect(summariseTimeline(cells, CRON_TIMELINE)).toEqual([
      { status: "error", label: "Failed", count: 2 },
      { status: "missed", label: "Missed", count: 1 },
      { status: "ok", label: "Okay", count: 15 },
    ]);
  });
});

describe("pendingTimeline", () => {
  test("fills the column so nothing reflows when the stats land", () => {
    expect(pendingTimeline(6)).toBe(TIMELINE_PENDING_GLYPH.repeat(6));
    expect(pendingTimeline(0)).toBe("");
    expect(pendingTimeline(-3)).toBe("");
  });
});
