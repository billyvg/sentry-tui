/**
 * Keeping the picture with the voice when the voice doesn't fit.
 *
 * The tape holds each action for as long as its narration ran *at the time it
 * was recorded*. Re-render the narration and those lengths move: a line the
 * synthesizer reads a second longer than last time would start while the
 * previous one is still talking, and every beat after it drifts further out.
 *
 * The old answer was to make the audio fit — resample it to the length the tape
 * expected. That is the wrong side of the problem to solve, because it is the
 * side a listener can hear. The picture can absorb it instead: hold the frame,
 * let the line finish, carry on. A terminal recording is mostly still anyway, so
 * a held frame is invisible in a way that a stretched voice never is.
 *
 * This works out where to hold and for how long. It is deliberately pure — no
 * ffmpeg, no files — because the arithmetic is the part worth testing.
 */

export interface BeatTiming {
  id: string;
  /** Where the beat's action happens in the recording, in milliseconds. */
  atMs: number;
  /** How long its narration runs, in seconds. */
  seconds: number;
}

export interface Placement {
  id: string;
  /** Where the beat's audio goes in the finished cut. */
  atMs: number;
}

export interface Freeze {
  /** Where to hold, in the *source* recording's timeline. */
  atMs: number;
  holdMs: number;
}

/**
 * A breath between one line ending and the next beginning.
 *
 * Not silence for its own sake: two lines that touch exactly sound like one
 * run-on sentence, and the synthesizer's own trailing pause is not reliably
 * long enough to serve as the gap.
 */
export const BREATH_MS = 180;

export interface Sync {
  placements: Placement[];
  freezes: Freeze[];
  /** Total time added to the picture. */
  addedMs: number;
}

/**
 * Place every beat's audio, holding the picture wherever a line needs the room.
 *
 * Beats are laid down in tape order, each at the point its action happens —
 * unless the line before it is still going, in which case the picture freezes at
 * that point for the difference and everything after it shifts along.
 *
 * A beat is never pulled *earlier* than its action, even when its narration got
 * shorter. The alternative is cutting picture the tape asked for, and the tape
 * asked for it because something is happening on screen.
 */
export function syncToAudio(beats: BeatTiming[], breathMs = BREATH_MS): Sync {
  const placements: Placement[] = [];
  const freezes: Freeze[] = [];

  let shiftMs = 0;
  let previousEndMs = -Infinity;

  for (const beat of beats) {
    const earliest = previousEndMs + breathMs;
    let atMs = beat.atMs + shiftMs;

    if (atMs < earliest) {
      const holdMs = Math.round(earliest - atMs);
      freezes.push({ atMs: beat.atMs, holdMs });
      shiftMs += holdMs;
      atMs += holdMs;
    }

    placements.push({ id: beat.id, atMs: Math.round(atMs) });
    previousEndMs = atMs + beat.seconds * 1000;
  }

  return { placements, freezes, addedMs: shiftMs };
}
