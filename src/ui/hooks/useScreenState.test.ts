import { expect, test } from "bun:test";

import { rowsOf, type ScreenState } from "~/ui/hooks/useScreenState";

test("rowsOf names both screens when a shared slice holds a sibling's rows", () => {
  const state = {
    key: "explore.events",
    source: "explore.logs",
    entriesSource: "explore.traces",
    entries: [],
  } as unknown as ScreenState;

  expect(() => rowsOf(state)).toThrow(
    'Screen "explore.logs" cannot read rows written by "explore.traces" from shared state "explore.events"',
  );
});

test("rowsOf accepts rows written by the active screen", () => {
  const entries = [{ id: "row" }];
  const state = {
    key: "explore.events",
    source: "explore.logs",
    entriesSource: "explore.logs",
    entries,
  } as unknown as ScreenState;

  expect(rowsOf<{ id: string }>(state)).toBe(entries);
});
