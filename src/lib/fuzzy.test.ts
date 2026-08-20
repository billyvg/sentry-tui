import { describe, expect, test } from "bun:test";

import { fuzzyMatch } from "~/lib/fuzzy";

/** Score only, for the ranking assertions. */
const score = (text: string, query: string) => fuzzyMatch(text, query)?.score ?? null;

describe("fuzzyMatch", () => {
  test("an empty query matches everything at zero", () => {
    expect(fuzzyMatch("Feed", "")).toEqual({ score: 0, positions: [] });
  });

  test("a non-subsequence does not match", () => {
    expect(fuzzyMatch("Feed", "xyz")).toBeNull();
    // Order matters: the characters are all present but not in sequence.
    expect(fuzzyMatch("Feed", "deef")).toBeNull();
  });

  test("matching is case-insensitive and reports the matched indices", () => {
    expect(fuzzyMatch("Feed", "fee")?.positions).toEqual([0, 1, 2]);
    expect(fuzzyMatch("All Dashboards", "dash")?.positions).toEqual([4, 5, 6, 7]);
  });

  test("the backward pass picks the tightest window", () => {
    // A greedy forward-only match would take the leading `a` of "Alerts" and
    // stretch the highlight across the whole label.
    expect(fuzzyMatch("All Monitors", "mon")?.positions).toEqual([4, 5, 6]);
  });

  test("a prefix outranks a match buried mid-word", () => {
    expect(score("Logs", "log")!).toBeGreaterThan(score("Backlog", "log")!);
  });

  test("a word-boundary match outranks a scattered one", () => {
    expect(score("All Views", "av")!).toBeGreaterThan(score("Java", "av")!);
  });

  test("consecutive characters outrank gapped ones", () => {
    expect(score("Traces", "trac")!).toBeGreaterThan(score("Triage cases", "trac")!);
  });

  test("an exact match outranks a longer label that merely contains it", () => {
    expect(score("Feed", "feed")!).toBeGreaterThan(score("Feedback", "feed")!);
  });
});
