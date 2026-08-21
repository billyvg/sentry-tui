import { describe, expect, test } from "bun:test";

import { parseNarration } from "./narration.ts";
import { countSyllables, countWordSyllables, MAX_TEMPO, MIN_TEMPO } from "./pace.ts";

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
