import { describe, expect, test } from "bun:test";

import { BREATH_MS, syncToAudio } from "./sync.ts";

/** Where a line ends, in ms. */
const endOf = (atMs: number, seconds: number) => atMs + seconds * 1000;

describe("syncToAudio", () => {
  test("leaves audio where the tape put it when it fits", () => {
    const { placements, freezes, addedMs } = syncToAudio([
      { id: "B01", atMs: 0, seconds: 3 },
      { id: "B02", atMs: 4000, seconds: 2 },
      { id: "B03", atMs: 9000, seconds: 3 },
    ]);
    expect(placements.map((beat) => beat.atMs)).toEqual([0, 4000, 9000]);
    expect(freezes).toEqual([]);
    expect(addedMs).toBe(0);
  });

  test("holds the picture when a line outruns the room left for it", () => {
    // B01's audio now runs to 5s, but B02's action is at 4s.
    const { placements, freezes } = syncToAudio([
      { id: "B01", atMs: 0, seconds: 5 },
      { id: "B02", atMs: 4000, seconds: 2 },
    ]);
    expect(placements[1]?.atMs).toBe(5000 + BREATH_MS);
    expect(freezes).toEqual([{ atMs: 4000, holdMs: 1000 + BREATH_MS }]);
  });

  test("freezes at the point in the source recording, not the finished cut", () => {
    // Two overruns in a row: the second freeze is still expressed in the
    // recording's own timeline, or ffmpeg would cut the wrong frame.
    const { freezes } = syncToAudio([
      { id: "B01", atMs: 0, seconds: 5 },
      { id: "B02", atMs: 4000, seconds: 5 },
      { id: "B03", atMs: 8000, seconds: 1 },
    ]);
    expect(freezes.map((freeze) => freeze.atMs)).toEqual([4000, 8000]);
  });

  test("never leaves two lines overlapping, however far it has to shift", () => {
    const beats = [
      { id: "B01", atMs: 0, seconds: 6 },
      { id: "B02", atMs: 2000, seconds: 6 },
      { id: "B03", atMs: 4000, seconds: 6 },
    ];
    const { placements } = syncToAudio(beats);
    for (let i = 1; i < placements.length; i++) {
      const previous = endOf(placements[i - 1]!.atMs, beats[i - 1]!.seconds);
      expect(placements[i]!.atMs).toBeGreaterThanOrEqual(previous + BREATH_MS);
    }
  });

  test("never pulls a line earlier than the action it belongs to", () => {
    // A beat whose narration got shorter leaves a gap. Closing it would mean
    // cutting picture the tape asked for, and it asked for a reason.
    const { placements, addedMs } = syncToAudio([
      { id: "B01", atMs: 0, seconds: 0.5 },
      { id: "B02", atMs: 8000, seconds: 1 },
    ]);
    expect(placements[1]?.atMs).toBe(8000);
    expect(addedMs).toBe(0);
  });

  test("carries an earlier shift through to every later beat", () => {
    const { placements } = syncToAudio([
      { id: "B01", atMs: 0, seconds: 5 },
      { id: "B02", atMs: 4000, seconds: 1 },
      { id: "B03", atMs: 20_000, seconds: 1 },
    ]);
    expect(placements[2]?.atMs).toBe(20_000 + 1000 + BREATH_MS);
  });
});
