import { describe, expect, test } from "bun:test";

import type { Group } from "~/api/types";
import { theme } from "~/core/theme";
import { issueMessage, issueTitle } from "~/lib/issueText";
import { ITALIC } from "~/ui/lib/attributes";
import {
  IssueListHeader,
  IssueRow,
  IssueRowSkeleton,
  resolveRowLayout,
  ROW_HEIGHT,
} from "~/ui/components/IssueRow";
import { groupFixture, groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const WIDTH = 110;

const lines = (frame: string) => frame.split("\n").filter((line) => line.trim().length > 0);

describe("issue text", () => {
  test("splits the API's concatenated title back into type and value", () => {
    // `compute_title` builds "{type}: {value}", so the split comes from
    // metadata rather than from parsing the joined string.
    expect(issueTitle(groupFixture)).toBe("TypeError");
    expect(issueMessage(groupFixture)).toBe("Cannot read properties of undefined");
  });

  test("an issue without exception metadata keeps its whole title", () => {
    const perf = groupsFixture[2]!;
    expect(perf.metadata).toBeUndefined();
    expect(issueTitle(perf)).toBe("Slow database query on /api/orders");
    // No exception value, so the message line falls back to the culprit.
    expect(issueMessage(perf)).toBe("api/orders");
  });

  test("the culprit is not repeated when it is already the title", () => {
    const group = { title: "api/orders", culprit: "api/orders" };
    expect(issueMessage(group)).toBe("");
  });

  test("a multi-line exception value is flattened onto one line", () => {
    const group = {
      title: "Error: boom",
      metadata: { type: "Error", value: "line one\n  line two" },
    };
    expect(issueMessage(group)).toBe("line one line two");
  });
});

describe("empty values", () => {
  /** `captureSpans` reports colors as RGBA floats; compare against the theme. */
  const isColor = (span: { fg: { r: number; g: number; b: number } }, hex: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (["r", "g", "b"] as const).every(
      (key, i) => Math.round(span.fg[key] * 255) === channels[i],
    );
  };

  test("an issue with no exception value says so, dimmed and italic", async () => {
    // A `captureMessage("")` produces exactly this: metadata with a type but
    // no value, and a culprit that is already the title.
    const blank: Group = {
      ...groupFixture,
      title: "api/orders",
      culprit: "api/orders",
      metadata: { type: "api/orders", value: "" },
    };

    const h = await renderHarness(<IssueRow group={blank} selected={false} width={WIDTH} />, {
      width: WIDTH,
      height: ROW_HEIGHT + 1,
    });
    try {
      expect(h.frame()).toContain("(no error message)");

      // Styling has to reach the terminal, not just the text: `frame()`
      // flattens attributes away, so assert on the span itself.
      const span = h.spanContaining("(no error message)");
      expect(span).toBeDefined();
      expect(span!.attributes & ITALIC).toBe(ITALIC);
      expect(isColor(span!, theme.subText)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("a real message is neither dimmed nor italic", async () => {
    const h = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    try {
      const span = h.spanContaining("Cannot read properties");
      expect(span).toBeDefined();
      expect(span!.attributes & ITALIC).toBe(0);
      expect(isColor(span!, theme.muted)).toBe(true);
      expect(h.frame()).not.toContain("(no error message)");
    } finally {
      await h.cleanup();
    }
  });

  test("the placeholder holds the column width, so nothing shifts", async () => {
    const blank: Group = { ...groupFixture, metadata: { type: "Error", value: "" } };
    const withMessage = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    const filled = withMessage.frame().split("\n");
    await withMessage.cleanup();

    const withoutMessage = await renderHarness(
      <IssueRow group={blank} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    const empty = withoutMessage.frame().split("\n");
    await withoutMessage.cleanup();

    expect(empty.length).toBe(filled.length);
    for (let i = 0; i < filled.length; i++) {
      expect(empty[i]!.length).toBe(filled[i]!.length);
    }
  });

  test("a whitespace-only value counts as empty", async () => {
    const blank: Group = { ...groupFixture, metadata: { type: "Error", value: "   " } };
    const h = await renderHarness(<IssueRow group={blank} selected={false} width={WIDTH} />, {
      width: WIDTH,
      height: ROW_HEIGHT + 1,
    });
    try {
      expect(h.frame()).toContain("(no error message)");
    } finally {
      await h.cleanup();
    }
  });

  test("an issue with no title at all still names the gap", async () => {
    const untitled: Group = { ...groupFixture, title: "", metadata: undefined };
    const h = await renderHarness(<IssueRow group={untitled} selected={false} width={WIDTH} />, {
      width: WIDTH,
      height: ROW_HEIGHT + 1,
    });
    try {
      const span = h.spanContaining("(no title)");
      expect(span).toBeDefined();
      expect(span!.attributes & ITALIC).toBe(ITALIC);
    } finally {
      await h.cleanup();
    }
  });
});

describe("row layout", () => {
  test("sheds columns right-to-left rather than crushing the title", () => {
    const wide = resolveRowLayout(140);
    const narrow = resolveRowLayout(70);

    expect(wide.columns).toContain("assignee");
    expect(narrow.columns).not.toContain("assignee");
    // Events and Users are what the stream is scanned by, so they outlast the
    // decorative columns.
    expect(narrow.columns).toContain("events");
    expect(narrow.columns).toContain("users");
    expect(narrow.title).toBeGreaterThanOrEqual(16);
  });

  test("the title never falls below its floor, even absurdly narrow", () => {
    expect(resolveRowLayout(20).title).toBeGreaterThanOrEqual(16);
  });
});

describe("IssueRow", () => {
  test("renders type above message, with the meta line beneath", async () => {
    const h = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    try {
      const rows = lines(h.frame());

      // Line one: the short exception type plus the metric columns.
      expect(rows[0]).toContain("TypeError");
      expect(rows[0]).toContain("1.4k"); // 1428 events
      expect(rows[0]).not.toContain("Cannot read properties");

      // Line two: level bar then the exception value.
      expect(rows[1]).toContain("┃");
      expect(rows[1]).toContain("Cannot read properties of undefined");

      // Line three: short id, project, and the rest of the meta row.
      expect(rows[2]).toContain("PUMP-STATION-1");
      expect(rows[2]).toContain("javascript");
      expect(rows[2]).toContain("Unhandled");
    } finally {
      await h.cleanup();
    }
  });

  test("each row is bounded by a rule and padded inside it", async () => {
    const h = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    try {
      const rows = lines(h.frame());
      // The bottom border separates one row from the next.
      expect(rows.at(-1)).toMatch(/^─+\s*$/);
      // Content is inset from the left edge by the row padding.
      for (const row of rows.slice(0, 3)) {
        expect(row.startsWith(" ")).toBe(true);
      }
    } finally {
      await h.cleanup();
    }
  });

  test("the selection meets its rules half a cell in, neither short nor past", async () => {
    // Three rows, the middle one selected: the row above owns the rule that
    // closes the top edge of the band, the selected row the one below it.
    const h = await renderHarness(
      <box style={{ flexDirection: "column" }}>
        <IssueRow group={groupFixture} selected={false} selectionBelow={true} width={WIDTH} />
        <IssueRow group={{ ...groupFixture, id: "2" }} selected={true} width={WIDTH} />
        <IssueRow group={{ ...groupFixture, id: "3" }} selected={false} width={WIDTH} />
      </box>,
      { width: WIDTH, height: ROW_HEIGHT * 3 },
    );
    try {
      const captured = h.captureSpans().lines;
      // `captureSpans` reports colors as RGBA floats; compare against the theme.
      const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const isColor = (
        span: { fg: { r: number; g: number; b: number }; bg: { r: number; g: number; b: number } },
        layer: "fg" | "bg",
        hex: string,
      ) =>
        (["r", "g", "b"] as const).every(
          (key, i) => Math.round(span[layer][key] * 255) === channels(hex)[i],
        );
      const line = (index: number) => captured[index]!.spans;

      // The row's three text lines carry the highlight edge to edge — padding
      // columns included, so the band is the full width of the row.
      for (const index of [4, 5, 6]) {
        expect(line(index).every((span) => isColor(span, "bg", theme.selected))).toBe(true);
      }

      // The rules bounding it are half blocks in the selection colour, filled
      // on the side the selection is on: a rule is a hairline through the
      // middle of a whole cell, so a fully painted cell would carry the band
      // half a line past it and an unpainted one stop half a line short.
      const rule = (index: number) =>
        line(index)
          .map((span) => span.text)
          .join("");
      expect(rule(3)).toMatch(/^▄+$/); // above the selection: lower half filled
      expect(rule(7)).toMatch(/^▀+$/); // below it: upper half filled
      for (const index of [3, 7]) {
        expect(line(index).every((span) => isColor(span, "fg", theme.selected))).toBe(true);
        // Only the half meeting the band is painted; the other half is bare.
        expect(line(index).every((span) => isColor(span, "bg", theme.selected))).toBe(false);
      }

      // Rules away from the selection stay ordinary hairlines.
      expect(rule(11)).toMatch(/^─+$/);
    } finally {
      await h.cleanup();
    }
  });

  test("the header names the columns the rows fill", async () => {
    const h = await renderHarness(<IssueListHeader width={WIDTH} />, { width: WIDTH, height: 3 });
    try {
      const header = h.frame();
      for (const label of ["Issue", "Last Seen", "Age", "Trend", "Events", "Users"]) {
        expect(header).toContain(label);
      }
    } finally {
      await h.cleanup();
    }
  });

  test("header and row agree on where each column starts", async () => {
    const header = await renderHarness(<IssueListHeader width={WIDTH} />, {
      width: WIDTH,
      height: 3,
    });
    const headerLine = lines(header.frame())[0]!;
    await header.cleanup();

    const row = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    const rowLine = lines(row.frame())[0]!;
    await row.cleanup();

    // Right-aligned columns share a right edge, so the labels and values end
    // at the same cell: "Events" and "1.4k", "Users" and "92".
    expect(headerLine.indexOf("Events") + "Events".length).toBe(
      rowLine.indexOf("1.4k") + "1.4k".length,
    );
    expect(headerLine.indexOf("Users") + "Users".length).toBe(rowLine.indexOf("92") + 2);
  });

  test("a pending count shows a placeholder, never a fabricated zero", async () => {
    const { count: _c, userCount: _u, lastSeen: _l, ...pending } = groupFixture;
    const h = await renderHarness(
      <IssueRow group={pending as Group} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    try {
      const first = lines(h.frame())[0]!;
      expect(first).toContain("··");
      expect(first).not.toContain(" 0 ");
    } finally {
      await h.cleanup();
    }
  });

  test("an assignee's initials fill the Asgn column, unassigned shows a dot", async () => {
    const assigned: Group = {
      ...groupFixture,
      assignedTo: { id: "100", name: "Ada Lovelace", type: "user" },
    };

    const h = await renderHarness(<IssueRow group={assigned} selected={false} width={WIDTH} />, {
      width: WIDTH,
      height: ROW_HEIGHT + 1,
    });
    const withAssignee = lines(h.frame())[0]!;
    await h.cleanup();

    const bare = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    const unassigned = lines(bare.frame())[0]!;
    await bare.cleanup();

    expect(withAssignee.trimEnd().endsWith("AL")).toBe(true);
    expect(unassigned.trimEnd().endsWith("·")).toBe(true);
  });

  test("an avatar URL still renders initials where images would be mush", async () => {
    // The test renderer advertises no kitty or sixel support, which is the
    // same position a plain terminal is in: the cell must degrade to text
    // rather than leave the column blank.
    const assigned: Group = {
      ...groupFixture,
      assignedTo: { id: "100", name: "Ada Lovelace", type: "user" },
    };

    const h = await renderHarness(
      <IssueRow
        group={assigned}
        selected={false}
        width={WIDTH}
        assigneeAvatarUrl="https://sentry.io/avatar/aaaa1111/"
      />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    try {
      expect(lines(h.frame())[0]!.trimEnd().endsWith("AL")).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("skeleton occupies the same geometry as a real row", async () => {
    const real = await renderHarness(
      <IssueRow group={groupFixture} selected={false} width={WIDTH} />,
      { width: WIDTH, height: ROW_HEIGHT + 1 },
    );
    const realLines = real.frame().split("\n");
    await real.cleanup();

    const skeleton = await renderHarness(<IssueRowSkeleton width={WIDTH} seed={0} />, {
      width: WIDTH,
      height: ROW_HEIGHT + 1,
    });
    const skeletonLines = skeleton.frame().split("\n");
    await skeleton.cleanup();

    // Same number of rows, same cell width — no reflow when data lands.
    expect(skeletonLines.length).toBe(realLines.length);
    for (let i = 0; i < realLines.length; i++) {
      expect(skeletonLines[i]!.length).toBe(realLines[i]!.length);
    }
  });
});
