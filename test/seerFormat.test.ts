import { expect, test } from "bun:test";

import { isSessionSettled, isSessionStale, type SeerBlock } from "~/api/seer";
import { getNavGroup, navItems, soleNavItem } from "~/core/nav";
import { describeToolCalls, getBlockStatus } from "~/core/seer";
import { wrapText } from "~/lib/text";
import {
  assistantBlockFixture,
  failedToolBlockFixture,
  seerProcessingSessionFixture,
  seerSessionFixture,
  toolBlockFixture,
} from "./seer-fixtures";

test("Seer has one destination, so the rail opens it directly", () => {
  expect(navItems(getNavGroup("seer"))).toEqual(["Ask Seer"]);
  expect(soleNavItem(getNavGroup("seer"))).toBe("Ask Seer");
});

test("groups with several destinations keep their secondary list", () => {
  for (const id of ["issues", "explore", "dashboards", "monitors"] as const) {
    expect(soleNavItem(getNavGroup(id))).toBeUndefined();
  }
});

test("wrapText breaks on spaces and keeps lines within the width", () => {
  const lines = wrapText("the quick brown fox jumps over the lazy dog", 12);
  expect(lines.every((line) => line.length <= 12)).toBe(true);
  expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
});

test("wrapText hard-splits a word too long to fit", () => {
  expect(wrapText("supercalifragilistic", 6)).toEqual(["superc", "alifra", "gilist", "ic"]);
});

test("wrapText preserves blank lines between paragraphs", () => {
  expect(wrapText("one\n\ntwo", 10)).toEqual(["one", "", "two"]);
});

test("a loading block outranks its tool status", () => {
  expect(getBlockStatus({ ...toolBlockFixture, loading: true })).toBe("loading");
});

test("a block with no tool calls is content", () => {
  expect(getBlockStatus(assistantBlockFixture)).toBe("content");
});

test("tool status is success, failure, or mixed by how many links errored", () => {
  expect(getBlockStatus(toolBlockFixture)).toBe("success");
  expect(getBlockStatus(failedToolBlockFixture)).toBe("failure");

  const mixed: SeerBlock = {
    ...toolBlockFixture,
    tool_links: [
      { kind: "a", params: { is_error: true } },
      { kind: "b", params: {} },
    ],
  };
  expect(getBlockStatus(mixed)).toBe("mixed");
});

test("a tool awaiting approval reads as pending", () => {
  const pending: SeerBlock = {
    ...toolBlockFixture,
    tool_links: [{ kind: "code_file_edit", params: { pending_approval: true } }],
  };
  expect(getBlockStatus(pending)).toBe("pending");
});

test("tool calls are phrased in present tense while loading and past tense when done", () => {
  expect(describeToolCalls({ ...toolBlockFixture, loading: true })).toEqual([
    "Reading checkout.py from store…",
  ]);
  expect(describeToolCalls(toolBlockFixture)).toEqual(["Read checkout.py from store"]);
});

test("an unknown tool still produces a readable line", () => {
  const unknown: SeerBlock = {
    ...toolBlockFixture,
    message: {
      role: "tool_use",
      content: null,
      tool_calls: [{ function: "brand_new_tool", id: "c", args: "{}" }],
    },
  };
  expect(describeToolCalls(unknown)).toEqual(["Used brand_new_tool tool"]);
});

test("malformed tool arguments fall back rather than throwing", () => {
  const broken: SeerBlock = {
    ...toolBlockFixture,
    message: {
      role: "tool_use",
      content: null,
      tool_calls: [{ function: "code_search", id: "c", args: "not json" }],
    },
  };
  expect(describeToolCalls(broken)).toEqual(["Searched code in the codebase"]);
});

test("a session is settled only when it is done and nothing is loading", () => {
  expect(isSessionSettled(seerSessionFixture)).toBe(true);
  expect(isSessionSettled(seerProcessingSessionFixture)).toBe(false);
  expect(isSessionSettled(null)).toBe(false);
});

test("staleness is measured from updated_at, which the API sends as naive UTC", () => {
  const session = { ...seerSessionFixture, updated_at: "2026-08-20T12:00:00.000000" };
  const updatedAt = Date.parse("2026-08-20T12:00:00.000Z");
  expect(isSessionStale(session, updatedAt + 1_000)).toBe(false);
  expect(isSessionStale(session, updatedAt + 130_000)).toBe(true);
});
