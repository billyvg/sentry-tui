import { describe, expect, test } from "bun:test";

import type { Group } from "~/api/types";
import { issueMessage, issueTitle } from "~/lib/issueText";
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
      expect(rows[1]).toContain("│");
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
