import type { ReactNode } from "react";

import type { TimelineStyle } from "~/core/checkInTimeline";
import {
  TIMELINE_PENDING_GLYPH,
  foldCheckIns,
  type StatsBucket,
  type TimelineCell,
} from "~/lib/checkInTimeline";

export interface CheckInTimelineProps<S extends string> {
  /**
   * Buckets from the stats endpoint.
   *
   * `undefined` draws the pending rail, an empty array draws the unlit track:
   * "we haven't heard yet" and "nothing checked in" are different claims about
   * a monitor, and a row must not make the wrong one. A caller whose fetch
   * *failed* wants the track, not the rail — pass `[]` there, or the row says
   * "loading" for the rest of the session.
   */
  buckets: readonly StatsBucket<S>[] | undefined;
  /** Glyphs, precedence, and colours for this kind of monitor. */
  style: TimelineStyle<S>;
  /** Cells the row occupies. The output is always exactly this wide. */
  width: number;
  /** The window drawn, unix seconds — the same one the stats were asked for. */
  since: number;
  until: number;
}

/**
 * One monitor's check-in history as a row of characters.
 *
 * The whole of the layout is in `foldCheckIns`; this only turns cells into
 * spans, coalescing adjacent cells that share a colour so a forty-cell row is
 * a handful of spans rather than forty. Renders inside a fixed-width table
 * cell without measuring: the row is exactly `width` characters, always.
 *
 * Pass `buckets={undefined}` for the pending state — it draws a dashed rail of
 * the same width, so nothing reflows when the stats land.
 */
export function CheckInTimeline<S extends string>({
  buckets,
  style,
  width,
  since,
  until,
}: CheckInTimelineProps<S>) {
  const cells = Math.max(0, Math.floor(width));
  if (cells === 0) return null;

  if (buckets === undefined) {
    return <text fg={style.trackColor}>{TIMELINE_PENDING_GLYPH.repeat(cells)}</text>;
  }

  const folded = foldCheckIns(buckets, { width: cells, since, until, config: style.config });
  return <text>{coalesce(folded, style)}</text>;
}

/**
 * Group runs of same-coloured cells into one span each.
 *
 * A healthy day is one span; the interesting rows are the ones that aren't.
 */
function coalesce<S extends string>(
  cells: readonly TimelineCell<S>[],
  style: TimelineStyle<S>,
): ReactNode[] {
  const spans: ReactNode[] = [];
  let run = "";
  let runColor = "";

  const flush = () => {
    if (!run) return;
    spans.push(
      <span key={spans.length} fg={runColor}>
        {run}
      </span>,
    );
    run = "";
  };

  for (const cell of cells) {
    const color = cell.status === null ? style.trackColor : style.colors[cell.status];
    if (color !== runColor) {
      flush();
      runColor = color;
    }
    run += cell.glyph;
  }
  flush();

  return spans;
}
