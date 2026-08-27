/**
 * The check-in timeline, as characters.
 *
 * The web's version (`components/checkInTimeline/checkInTimeline.tsx`) is
 * already a grid of one-status-per-slot ticks — it just draws them as
 * absolutely positioned `<div>`s four pixels wide. A terminal cell is the same
 * object with the pixel arithmetic taken out, so this module is the whole of
 * it: fold the buckets an endpoint returned onto the cells a column has, and
 * pick the glyph each cell draws.
 *
 * Two rules the web has that this keeps:
 *
 * - **Precedence, not majority.** A cell holding one failure among ninety-nine
 *   successes draws the failure — `getAggregateStatus` takes the first status
 *   in the precedence order with a non-zero count, and a timeline exists to
 *   show you the bad minute.
 * - **Empty is not a status.** A window with no check-ins in it draws the
 *   unlit track rather than borrowing its neighbour's colour.
 *
 * Colour is deliberately *not* here: `src/lib` is dependency-free, so a cell
 * carries its status and `ui/components/CheckInTimeline.tsx` is what knows
 * which theme token that status wears. The glyphs are here, though, and they
 * are chosen so the row survives without colour at all — see `CRON_GLYPHS`.
 */

/**
 * One bucket as both stats endpoints return it: `[unixSeconds, countsByStatus]`.
 *
 * Declared structurally rather than imported from `~/api/monitorStats` so this
 * stays a dependency-free leaf — `api` imports `lib`, never the other way.
 */
export type StatsBucket<S extends string> = readonly [
  timestamp: number,
  counts: Readonly<Partial<Record<S, number>>>,
];

/** The statuses one kind of monitor reports, and how each one draws. */
export interface TimelineStatusConfig<S extends string> {
  /**
   * Highest priority first: the first status with a non-zero count wins the
   * cell. Copied from the web's `statusPrecedent` arrays, whose comment says
   * "ascending" but whose consumer is `Array.find`.
   */
  readonly precedence: readonly S[];
  readonly glyphs: Readonly<Record<S, string>>;
  readonly labels: Readonly<Record<S, string>>;
}

/** A single cell of the drawn timeline. */
export interface TimelineCell<S extends string> {
  /** The status that won the cell, or `null` when nothing landed in it. */
  status: S | null;
  /** The character to draw. Always exactly one cell wide. */
  glyph: string;
  /** Check-ins folded into this cell, across every status. */
  total: number;
  /** Per-status counts, for a tooltip or a summary line. */
  counts: Partial<Record<S, number>>;
  /** Window the cell covers, in unix seconds; `end` is exclusive. */
  start: number;
  end: number;
}

/**
 * A window with no check-ins in it.
 *
 * Drawn rather than left blank: the gaps in a daily cron's day are most of the
 * row, and a run of spaces reads as a column that failed to render. A dim dot
 * reads as track.
 *
 * **Do not fill these in from the neighbouring cell.** An hourly cron in a
 * sixty-cell row lights about twenty-four of them, and the plan's sketch shows
 * a solid bar, so a comb reads as a bug — it is not. Holding a check-in's
 * status forward until the next one would paint "healthy" across a window in
 * which the monitor may have silently missed, which is the exact failure a
 * check-in timeline exists to reveal. The web does not do it either: an empty
 * bucket ends the previous tick (`mergeBuckets`) rather than extending its
 * colour. A monitor that checks in often enough gets the solid bar for free.
 */
export const TIMELINE_EMPTY_GLYPH = "·";

/**
 * Check-ins arrived but none of them matched a status this build knows.
 *
 * Sentry adds check-in statuses server-side, and a cell that silently drew
 * "empty" for one would be a lie about a monitor's health. Deliberately the
 * same glyph the cron vocabulary gives its own `unknown`, because it means the
 * same thing to whoever is reading the row.
 */
export const TIMELINE_UNRECOGNISED_GLYPH = "?";

/** Drawn while stats are in flight, so the column doesn't reflow when they land. */
export const TIMELINE_PENDING_GLYPH = "╌";

/**
 * Cron check-in statuses — `CheckInStatus` in
 * `views/insights/crons/types.tsx:26-33`.
 */
export type CronCheckInStatus = "ok" | "error" | "in_progress" | "missed" | "timeout" | "unknown";

/**
 * Uptime check statuses — `CheckStatus` in
 * `views/alerts/rules/uptime/types.tsx:73-78`.
 */
export type UptimeCheckStatus = "success" | "failure" | "failure_incident" | "missed_window";

/**
 * Glyphs for a cron row.
 *
 * The original sketch drew both `ok` and `error` as `█`, which makes the two
 * states that matter most indistinguishable the moment colour is gone — a
 * mono terminal, a screenshot, a colour-blind reader. The fix is to spend the
 * *ink*, not the hue: severity climbs with how much of the cell is filled, and
 * only a failure is allowed to fill it.
 *
 * ```text
 * ▄  ok           a low baseline; a healthy row is a flat green rule
 * ░  missed       faint — the check-in never arrived
 * ▒  timeout      denser than missed, lighter than a hard failure
 * ▓  in_progress  nearly filled — it is still running
 * █  error        the only full-height cell, so failures spike out of the row
 * ?  unknown      not a bar at all, because the answer isn't a level
 * ```
 *
 * Reading `▄▄▄█▄▄▒▄▄` without colour still says "one hard failure and one
 * timeout"; reading `███████` with `ok` and `error` sharing a glyph says
 * nothing. The closest pair left is `▒` and `▓` — a shade apart, and two
 * statuses that are neither adjacent in meaning nor commonly adjacent in a row.
 *
 * **The invariant:** severity climbs with ink, and `█` belongs to the failure
 * alone. Giving `ok` the full block back would break the "legible without
 * colour" requirement. `src/lib/checkInTimeline.test.ts` fails if the two
 * collide.
 */
export const CRON_GLYPHS: Readonly<Record<CronCheckInStatus, string>> = {
  ok: "▄",
  missed: "░",
  timeout: "▒",
  in_progress: "▓",
  error: "█",
  unknown: TIMELINE_UNRECOGNISED_GLYPH,
};

/** `statusToText` — `views/insights/crons/utils.tsx:40-47`. */
export const CRON_LABELS: Readonly<Record<CronCheckInStatus, string>> = {
  ok: "Okay",
  error: "Failed",
  in_progress: "In Progress",
  missed: "Missed",
  timeout: "Timed Out",
  unknown: "Unknown",
};

/** `checkInStatusPrecedent` — `views/insights/crons/utils.tsx:31-38`. */
export const CRON_TIMELINE: TimelineStatusConfig<CronCheckInStatus> = {
  precedence: ["unknown", "error", "timeout", "missed", "ok", "in_progress"],
  glyphs: CRON_GLYPHS,
  labels: CRON_LABELS,
};

/**
 * Glyphs for an uptime row, on the same principle as `CRON_GLYPHS`: a healthy
 * check sits low, and only a failure fills the cell.
 *
 * The web separates a failing check (`failure`) from one inside a declared
 * incident (`failure_incident`) by drawing the first with a cross-hatch and
 * the second solid. Here that is a shade apart in the same danger colour —
 * both read as "down" at a glance, which is the important part, and the
 * severity difference is still visible.
 */
export const UPTIME_GLYPHS: Readonly<Record<UptimeCheckStatus, string>> = {
  success: "▄",
  missed_window: TIMELINE_UNRECOGNISED_GLYPH,
  failure: "▓",
  failure_incident: "█",
};

/** `statusToText` — `views/insights/uptime/timelineConfig.tsx:17-22`. */
export const UPTIME_LABELS: Readonly<Record<UptimeCheckStatus, string>> = {
  success: "Uptime",
  failure: "Failure",
  failure_incident: "Downtime",
  missed_window: "Unknown",
};

/** `checkStatusPrecedent` — `views/insights/uptime/timelineConfig.tsx:10-15`. */
export const UPTIME_TIMELINE: TimelineStatusConfig<UptimeCheckStatus> = {
  precedence: ["failure_incident", "failure", "success", "missed_window"],
  glyphs: UPTIME_GLYPHS,
  labels: UPTIME_LABELS,
};

/**
 * Finest bucket worth asking either stats endpoint for.
 *
 * Both take an arbitrary `resolution` — they pass `restrict_rollups=False` —
 * so nothing server-side stops a one-second bucket, and nothing server-side
 * would enjoy it either. A minute is below every cron schedule and every
 * uptime interval Sentry offers.
 */
export const MIN_RESOLUTION_SECONDS = 60;

/**
 * The `resolution` to ask for so one bucket lands in roughly one cell.
 *
 * This is the half of the reflow that happens *before* the request: a column
 * 40 cells wide over a day wants 36-minute buckets, and the same column at 90
 * cells wants 16-minute ones. Asking for a fixed resolution and throwing away
 * the excess is how a timeline ends up clipped on a narrow terminal.
 *
 * @param windowSeconds Length of the time window being drawn.
 * @param width Cells the column has to draw it in.
 * @returns Whole seconds per bucket, never finer than `MIN_RESOLUTION_SECONDS`.
 */
export function resolutionForWidth(windowSeconds: number, width: number): number {
  if (!Number.isFinite(windowSeconds) || !Number.isFinite(width)) return MIN_RESOLUTION_SECONDS;
  if (windowSeconds <= 0 || width <= 0) return MIN_RESOLUTION_SECONDS;
  return Math.max(MIN_RESOLUTION_SECONDS, Math.ceil(windowSeconds / Math.floor(width)));
}

export interface FoldOptions<S extends string> {
  /** Cells available. The result is always exactly this long. */
  width: number;
  /** Start of the window, unix seconds. */
  since: number;
  /** End of the window, unix seconds. */
  until: number;
  config: TimelineStatusConfig<S>;
}

/**
 * Fold the buckets an endpoint returned onto exactly `width` cells.
 *
 * Each bucket is placed by *timestamp* rather than by index, which is the
 * other half of the reflow: the response can carry more buckets than the
 * column has cells (the resolution was computed for a wider pane and the
 * terminal has since been resized), fewer (a monitor created midway through
 * the window), or edges that don't line up (`monitors-stats/` floors `since`
 * to a multiple of the rollup and then emits one bucket past `until`). All
 * three land correctly, and none of them can produce a row of the wrong width.
 *
 * @returns One cell per column position, oldest first.
 */
export function foldCheckIns<S extends string>(
  buckets: readonly StatsBucket<S>[] | undefined,
  { width, since, until, config }: FoldOptions<S>,
): Array<TimelineCell<S>> {
  const cellCount = Math.max(0, Math.floor(width));
  if (cellCount === 0) return [];

  // A window that isn't one still has to yield a row of the right width, or
  // the column it draws into changes size when the clock does.
  const span = until > since ? until - since : 0;
  const cellSpan = span / cellCount;

  const cells: Array<TimelineCell<S>> = Array.from({ length: cellCount }, (_, index) => ({
    status: null,
    glyph: TIMELINE_EMPTY_GLYPH,
    total: 0,
    counts: {},
    start: since + Math.round(index * cellSpan),
    end: since + Math.round((index + 1) * cellSpan),
  }));

  if (span > 0) {
    for (const bucket of buckets ?? []) {
      const timestamp = bucket?.[0];
      const counts = bucket?.[1];
      if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || !counts) continue;
      // The endpoints round the window outwards, so a bucket may sit just
      // before `since` or exactly on `until`. Both belong to the row's end
      // cells rather than to nothing.
      const index = Math.min(
        cellCount - 1,
        Math.max(0, Math.floor(((timestamp - since) / span) * cellCount)),
      );
      addCounts(cells[index]!, counts);
    }
  }

  for (const cell of cells) resolveCell(cell, config);
  return cells;
}

/** The drawn row, as a string of exactly one character per cell. */
export function timelineGlyphs<S extends string>(cells: readonly TimelineCell<S>[]): string {
  return cells.map((cell) => cell.glyph).join("");
}

/** A placeholder row of the right width, for while the request is in flight. */
export function pendingTimeline(width: number): string {
  const cells = Math.max(0, Math.floor(width));
  return TIMELINE_PENDING_GLYPH.repeat(cells);
}

/**
 * How many check-ins of each status a whole row holds — the summary a caller
 * puts beside the timeline ("142 okay · 3 failed").
 */
export function summariseTimeline<S extends string>(
  cells: readonly TimelineCell<S>[],
  config: TimelineStatusConfig<S>,
): Array<{ status: S; label: string; count: number }> {
  return config.precedence
    .map((status) => ({
      status,
      label: config.labels[status],
      count: cells.reduce((sum, cell) => sum + (cell.counts[status] ?? 0), 0),
    }))
    .filter((entry) => entry.count > 0);
}

/** Add one bucket's counts into the cell it landed in. */
function addCounts<S extends string>(
  cell: TimelineCell<S>,
  counts: Readonly<Partial<Record<S, number>>>,
): void {
  for (const [status, count] of Object.entries(counts) as Array<[S, unknown]>) {
    // A count the endpoint sent as null, a string, or a negative number is not
    // evidence of a check-in, and must not be able to light a cell.
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
    cell.counts[status] = (cell.counts[status] ?? 0) + count;
    cell.total += count;
  }
}

/** Decide the status and glyph a filled cell draws. */
function resolveCell<S extends string>(
  cell: TimelineCell<S>,
  config: TimelineStatusConfig<S>,
): void {
  if (cell.total === 0) return;
  const status = config.precedence.find((candidate) => (cell.counts[candidate] ?? 0) > 0);
  if (status === undefined) {
    // Real check-ins under a status this build has never heard of.
    cell.glyph = TIMELINE_UNRECOGNISED_GLYPH;
    return;
  }
  cell.status = status;
  cell.glyph = config.glyphs[status] ?? TIMELINE_UNRECOGNISED_GLYPH;
}
