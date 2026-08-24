import { describe, expect, test } from "bun:test";

import { COMMANDS } from "~/core/commands";
import { NAV_GROUPS } from "~/core/nav";
import {
  buildPaletteActions,
  filterPaletteActions,
  flattenPaletteRows,
  groupPaletteResults,
  rowIndexOfResult,
  SECTION_LIMIT,
  type PaletteContext,
} from "~/core/palette";
import { findTriageAction } from "~/core/triage";

const EVERYTHING: PaletteContext = { streamView: true, hasIssue: true, updateReady: true };
const BARE: PaletteContext = { streamView: false, hasIssue: false, updateReady: false };

const labels = (context: PaletteContext) => buildPaletteActions(context).map((a) => a.label);

describe("buildPaletteActions", () => {
  test("ids are unique", () => {
    const ids = buildPaletteActions(EVERYTHING).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every nav destination is reachable", () => {
    const navActions = buildPaletteActions(BARE).filter((a) => a.target.kind === "nav");
    const expected = NAV_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.items));
    expect(navActions.length).toBe(expected.length);
    expect(navActions.every((a) => a.section === "Go to")).toBe(true);
  });

  test("nav destinations carry their group as the detail column", () => {
    const logs = buildPaletteActions(BARE).find((a) => a.id === "nav:explore:Logs");
    expect(logs?.detail).toBe("Explore");
  });

  test("context gates the scoped commands", () => {
    // Triage needs an issue; search and the filters need a stream on screen.
    expect(labels(BARE)).not.toContain("Resolve");
    expect(labels(BARE)).not.toContain("Search");
    expect(labels({ ...BARE, streamView: true })).toContain("Search");
    expect(labels({ ...BARE, streamView: true })).not.toContain("Resolve");
    expect(labels({ ...BARE, hasIssue: true })).toContain("Resolve");
  });

  test("the update command is offered only once a build is waiting", () => {
    // Nothing downloaded means restarting would do nothing, and the palette
    // lists only what you can act on now.
    expect(labels(BARE)).not.toContain("Restart into the update");
    expect(labels({ ...BARE, updateReady: true })).toContain("Restart into the update");
  });

  test("unscoped commands are never offered", () => {
    const offered = labels(EVERYTHING);
    // Cursor movement has no meaning without a key press behind it.
    expect(offered).not.toContain("Move down");
    expect(offered).not.toContain("Next pane");
    // Opening the palette from inside the palette would be a no-op.
    expect(offered).not.toContain("Command palette");
  });

  test("commands show their primary chord", () => {
    const refresh = buildPaletteActions(BARE).find((a) => a.id === "command:sentry.app.refresh");
    expect(refresh?.detail).toBe("ctrl+r");
    expect(refresh?.section).toBe("Commands");
  });

  test("every issue-scoped command has a triage handler behind it", () => {
    // The palette must not advertise an action that silently does nothing.
    for (const command of COMMANDS) {
      if (command.palette !== "issue") continue;
      expect({ id: command.id, handled: Boolean(findTriageAction(command.id)) }).toEqual({
        id: command.id,
        handled: true,
      });
    }
  });
});

describe("filterPaletteActions", () => {
  const actions = buildPaletteActions(EVERYTHING);

  test("an empty query keeps the catalog whole and in order", () => {
    const results = filterPaletteActions(actions, "");
    expect(results.length).toBe(actions.length);
    expect(results[0]?.action.id).toBe(actions[0]?.id);
  });

  test("a query ranks the best match first", () => {
    expect(filterPaletteActions(actions, "logs")[0]?.action.id).toBe("nav:explore:Logs");
    expect(filterPaletteActions(actions, "resolve")[0]?.action.id).toBe(
      "command:sentry.issue.resolve",
    );
  });

  test("acronyms find multi-word destinations", () => {
    expect(filterPaletteActions(actions, "ad")[0]?.action.id).toBe("nav:dashboards:All Dashboards");
  });

  test("a keyword matches without being printed", () => {
    // "escalates" only appears in the archive command's description.
    const results = filterPaletteActions(actions, "escalates");
    expect(results[0]?.action.id).toBe("command:sentry.issue.archive");
    // Nothing to highlight: the match was not on the label.
    expect(results[0]?.positions).toEqual([]);
  });

  test("a group name pulls its destinations up, via the keyword not the detail", () => {
    const results = filterPaletteActions(actions, "monitors");
    expect(results.some((r) => r.action.id === "nav:monitors:All Monitors")).toBe(true);
  });

  test("a one-letter query does not jump to a command whose chord is that letter", () => {
    // `E` is bound to the environment filter. Scoring the chord column would
    // make that an exact match and float it above every label starting in "e".
    const first = filterPaletteActions(actions, "e")[0]?.action;
    expect(first?.id).not.toBe("command:sentry.view.filterEnv");
    expect(first?.label.toLowerCase().startsWith("e")).toBe(true);
  });

  test("a query with no subsequence match yields nothing", () => {
    expect(filterPaletteActions(actions, "zzzzq")).toEqual([]);
  });

  test("label matches report highlight positions", () => {
    const feed = filterPaletteActions(actions, "feed").find((r) => r.action.label === "Feed");
    expect(feed?.positions).toEqual([0, 1, 2, 3]);
  });
});

describe("grouping and rows", () => {
  const actions = buildPaletteActions(EVERYTHING);

  test("an unfiltered list leads with destinations", () => {
    const groups = groupPaletteResults(filterPaletteActions(actions, ""));
    expect(groups.map((g) => g.section)).toEqual(["Go to", "Issue", "Commands"]);
  });

  test("the section holding the best match floats to the top", () => {
    const groups = groupPaletteResults(filterPaletteActions(actions, "resolve"));
    expect(groups[0]?.section).toBe("Issue");
  });

  test("rows interleave headings and number only the selectable rows", () => {
    const rows = flattenPaletteRows(
      groupPaletteResults(filterPaletteActions(actions, "unresolve")),
    );
    expect(rows[0]).toEqual({ kind: "heading", section: "Issue" });
    const results = rows.filter((r) => r.kind === "result");
    expect(results.map((r) => r.index)).toEqual(results.map((_, i) => i));
  });

  test("rowIndexOfResult locates a cursor position among the headings", () => {
    const rows = flattenPaletteRows(groupPaletteResults(filterPaletteActions(actions, "")));
    // Cursor 0 is the first result, which sits just below the first heading.
    expect(rowIndexOfResult(rows, 0)).toBe(1);
    expect(rowIndexOfResult(rows, 999)).toBe(-1);
  });

  test("no limit means no section is trimmed", () => {
    const groups = groupPaletteResults(filterPaletteActions(actions, ""));
    expect(groups.every((g) => g.hidden === 0)).toBe(true);
  });

  test("a limit caps each section and counts what it cut", () => {
    // "re" is a subsequence of "Explore", so every Explore destination matches
    // on its detail column and would otherwise flood the frame.
    const results = filterPaletteActions(actions, "re");
    const uncapped = groupPaletteResults(results);
    const capped = groupPaletteResults(results, SECTION_LIMIT);

    const goTo = capped.find((g) => g.section === "Go to")!;
    expect(goTo.results.length).toBe(SECTION_LIMIT);
    expect(goTo.hidden).toBe(
      uncapped.find((g) => g.section === "Go to")!.results.length - SECTION_LIMIT,
    );
    // Capping is what keeps the other sections on screen at all.
    expect(capped.map((g) => g.section)).toContain("Issue");
  });

  test("a capped section prints a tally row that the cursor skips", () => {
    const rows = flattenPaletteRows(
      groupPaletteResults(filterPaletteActions(actions, "re"), SECTION_LIMIT),
    );
    const more = rows.find((r) => r.kind === "more");
    expect(more).toBeDefined();
    // Row indices still run 0..n-1 over the selectable rows only.
    const results = rows.filter((r) => r.kind === "result");
    expect(results.map((r) => r.index)).toEqual(results.map((_, i) => i));
  });
});
