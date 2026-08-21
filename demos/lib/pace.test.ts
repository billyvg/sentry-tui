import { describe, expect, test } from "bun:test";

import { parseNarration } from "./narration.ts";
import {
  countSyllables,
  countWordSyllables,
  MAX_TEMPO,
  MIN_TEMPO,
  planPacing,
  TARGET_ARTICULATION,
  TARGET_OVERALL,
} from "./pace.ts";

describe("countWordSyllables", () => {
  test("counts vowel groups", () => {
    expect(countWordSyllables("terminal")).toBe(3);
    expect(countWordSyllables("keyboard")).toBe(2);
    expect(countWordSyllables("dashboards")).toBe(2);
  });

  test("drops a silent final e, but not a spoken one", () => {
    expect(countWordSyllables("profile")).toBe(2);
    expect(countWordSyllables("stride")).toBe(1);
    expect(countWordSyllables("simple")).toBe(2);
  });

  test("counts -ed only where it is said", () => {
    expect(countWordSyllables("ported")).toBe(2);
    expect(countWordSyllables("browsed")).toBe(1);
  });

  test("a plural -s is only a syllable after a sibilant", () => {
    expect(countWordSyllables("profiles")).toBe(2);
    expect(countWordSyllables("dashboards")).toBe(2);
    expect(countWordSyllables("releases")).toBe(3);
    expect(countWordSyllables("interfaces")).toBe(4);
  });

  test("spells out the tokens that are spelled out", () => {
    expect(countWordSyllables("UI")).toBe(2);
    expect(countWordSyllables("npx")).toBe(3);
    expect(countWordSyllables("n")).toBe(1);
  });

  test("never returns zero for something that gets said", () => {
    expect(countWordSyllables("rhythm")).toBeGreaterThan(0);
    expect(countWordSyllables("")).toBe(0);
  });
});

describe("countSyllables", () => {
  test("splits hyphenated words into their parts", () => {
    expect(countSyllables("Control-K")).toBe(3);
    expect(countSyllables("Thirty-five")).toBe(3);
  });

  test("ignores an em dash, which is a pause rather than a word", () => {
    expect(countSyllables("Sentry — in your terminal")).toBe(
      countSyllables("Sentry in your terminal"),
    );
  });
});

const beats = parseNarration(
  await Bun.file(new URL("../narration.md", import.meta.url).pathname).text(),
);

describe("planPacing", () => {
  /** A beat read at the target speed, with a comfortable amount of pause in it. */
  const onTarget = {
    syllables: 20,
    voicedSeconds: 20 / TARGET_ARTICULATION,
    gaps: [0.3, 0.3, 0.35],
  };

  /** What the plan says the beat will run to, end of speech. */
  const runsTo = (input: Parameters<typeof planPacing>[0], plan: ReturnType<typeof planPacing>) =>
    input.voicedSeconds / plan.tempo +
    input.gaps.reduce((sum, gap) => sum + Math.min(0.6, Math.max(0.12, gap * plan.pauseScale)), 0);

  test("leaves a beat that is already right alone", () => {
    const plan = planPacing(onTarget);
    expect(plan.tempo).toBeCloseTo(1, 1);
    expect(plan.clamped).toBe(false);
  });

  test("lands every beat on the overall rate, however it was read", () => {
    const cases = [
      onTarget,
      // Raced, and comma-heavy.
      { syllables: 26, voicedSeconds: 4, gaps: [0.5, 0.4, 0.6] },
      // Draggy, and read in one breath.
      { syllables: 13, voicedSeconds: 4.4, gaps: [0.08, 0.08] },
      // No pause at all to work with.
      { syllables: 12, voicedSeconds: 2.4, gaps: [] },
    ];
    for (const input of cases) {
      const rate = input.syllables / runsTo(input, planPacing(input));
      expect(rate).toBeGreaterThan(TARGET_OVERALL * 0.93);
      expect(rate).toBeLessThan(TARGET_OVERALL * 1.07);
    }
  });

  test("a line read in one breath is slowed rather than given pauses it never had", () => {
    const plan = planPacing({ syllables: 13, voicedSeconds: 2.7, gaps: [0.08, 0.08] });
    // The breaths grow, but not into something that reads as punctuation…
    expect(plan.pauseScale).toBeLessThanOrEqual(2.2);
    // …so the speech takes the rest, below the articulation target.
    expect(plan.articulation).toBeLessThan(TARGET_ARTICULATION);
    expect(plan.articulation).toBeGreaterThan(TARGET_ARTICULATION * 0.85);
  });

  test("a comma-heavy line keeps its speech on target and loses the padding", () => {
    const plan = planPacing({
      syllables: 16,
      voicedSeconds: 16 / TARGET_ARTICULATION,
      gaps: [0.7, 0.8],
    });
    expect(plan.pauseScale).toBeLessThan(1);
    expect(plan.articulation).toBeCloseTo(TARGET_ARTICULATION, 1);
  });

  test("emphasis moves one beat off the script's pace, both parts of it", () => {
    const slower = planPacing({ ...onTarget, emphasis: 0.9 });
    expect(slower.tempo).toBeLessThan(1);
    expect(slower.articulation).toBeCloseTo(TARGET_ARTICULATION * 0.9, 1);
  });

  test("flags a take too far off to correct without it showing", () => {
    const plan = planPacing({ syllables: 40, voicedSeconds: 4, gaps: [0.2] });
    expect(plan.tempo).toBe(MIN_TEMPO);
    expect(plan.clamped).toBe(true);
  });
});

describe("the real narration", () => {
  test("every beat has syllables to pace against", () => {
    for (const beat of beats) expect(countSyllables(beat.text)).toBeGreaterThan(3);
  });

  // Pace is corrected after synthesis, so a beat only needs an Emphasis when it
  // should deliberately sit apart from the rest — and the correction can only
  // move a take so far before the resampling is audible.
  test("any Emphasis stays inside what the tempo clamp can deliver", () => {
    for (const beat of beats) {
      if (beat.emphasis === undefined) continue;
      expect(beat.emphasis).toBeGreaterThanOrEqual(MIN_TEMPO);
      expect(beat.emphasis).toBeLessThanOrEqual(MAX_TEMPO);
    }
  });
});
