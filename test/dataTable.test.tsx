import { describe, expect, test } from "bun:test";

import { darkTheme as theme } from "~/core/theme";
import { padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { renderHarness } from "./helpers";

interface Row {
  id: string;
  name: string;
  time: string;
  project: string;
  env: string;
  extra: string;
}

/**
 * Values with no internal spaces, so each cell is one unbroken run of ink and
 * "where does this cell start" is a question the frame can answer.
 */
const ROWS: Row[] = Array.from({ length: 4 }, (_, i) => ({
  id: String(i),
  name: `row-${i}-name`,
  time: `12:0${i}:00`,
  project: `project-${i}`,
  env: `env-${i}`,
  extra: `extra-${i}`,
}));

function cell(value: string, width: number) {
  return <text fg={theme.text}>{padText(value, width)}</text>;
}

const COLUMNS: ReadonlyArray<Column<Row>> = [
  {
    key: "name",
    label: "Name",
    width: "flex",
    render: (row, _selected, width) => cell(row.name, width),
  },
  {
    key: "time",
    label: "Time",
    width: 12,
    render: (row, _selected, width) => cell(row.time, width),
  },
  {
    key: "project",
    label: "Project",
    width: 30,
    priority: 3,
    render: (row, _selected, width) => cell(row.project, width),
  },
  {
    key: "env",
    label: "Env",
    width: 30,
    priority: 2,
    render: (row, _selected, width) => cell(row.env, width),
  },
  {
    key: "extra",
    label: "Extra",
    width: 30,
    priority: 1,
    render: (row, _selected, width) => cell(row.extra, width),
  },
];

const VARIABLE_COLUMNS: ReadonlyArray<Column<Row>> = [
  {
    key: "name",
    label: "Name",
    width: "flex",
    render: (row, _selected, width) => (
      <box style={{ flexDirection: "column", width }}>
        {Array.from({ length: Number(row.id) + 1 }, (_, line) => (
          <text key={line} fg={theme.text}>
            {padText(`${row.name}-line-${line}`, width)}
          </text>
        ))}
      </box>
    ),
  },
  COLUMNS[1]!,
];

function renderTable(
  props: Partial<Parameters<typeof DataTable<Row>>[0]>,
  { width = 140, height = 20 } = {},
) {
  return renderHarness(
    <box style={{ width, height, flexDirection: "column" }}>
      <DataTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        width={width}
        selectedIndex={0}
        focused
        rowKey={(row) => row.id}
        empty={{ title: "Nothing here." }}
        {...props}
      />
    </box>,
    { width, height },
  );
}

/** Indices of the lines that have any ink on them. */
function inkLines(frame: string): number[] {
  return frame
    .split("\n")
    .map((line, i) => (line.trim() === "" ? -1 : i))
    .filter((i) => i >= 0);
}

/** Column at which each run of ink on a line begins. */
function inkStarts(line: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== " " && (i === 0 || line[i - 1] === " ")) starts.push(i);
  }
  return starts;
}

describe("DataTable geometry", () => {
  // `SENTRY_TUI_LATENCY=3000` is how this is checked by hand; asserting it
  // once here is what stops every screen having to be checked by hand.
  test("a skeleton row holds the exact geometry of a real row", async () => {
    for (const detail of [false, true]) {
      const renderDetail = detail
        ? (row: Row, _selected: boolean, width: number) => cell(row.name, width)
        : undefined;

      // One renderer at a time: two live harnesses share OpenTUI's globals.
      const real = await renderTable({ rows: ROWS, renderDetail });
      const realFrame = real.frame();
      await real.cleanup();

      const skeleton = await renderTable({
        rows: undefined,
        loading: true,
        skeletonRows: ROWS.length,
        renderDetail,
      });
      const skeletonFrame = skeleton.frame();
      await skeleton.cleanup();

      // Same lines carry content: header, then one row's worth of lines per
      // row, with nothing extra and nothing missing.
      expect(inkLines(skeletonFrame)).toEqual(inkLines(realFrame));

      // And on every one of them, every cell begins in the same column.
      const realLines = realFrame.split("\n");
      const skeletonLines = skeletonFrame.split("\n");
      for (const line of inkLines(realFrame)) {
        expect({ line, starts: inkStarts(skeletonLines[line]!) }).toEqual({
          line,
          starts: inkStarts(realLines[line]!),
        });
      }
    }
  });

  test("rows can give their column cells different heights", async () => {
    const clicks: Array<[number, string]> = [];
    const h = await renderTable(
      {
        columns: VARIABLE_COLUMNS,
        rowContentHeight: (row) => Number(row.id) + 1,
        renderDetail: (row, _selected, width) => cell(`${row.name}-detail`, width),
        onRowClick: (index, row) => clicks.push([index, row.name]),
      },
      { height: 30 },
    );
    try {
      const frame = h.frame();
      expect(frame).toContain("row-0-name-line-0");
      expect(frame).toContain("row-3-name-line-3");
      expect(frame).toContain("row-3-name-detail");
      // Header + rule, ten column lines, and one detail line per row.
      expect(inkLines(frame)).toHaveLength(2 + 10 + ROWS.length);

      const lastLine = frame.split("\n").findIndex((line) => line.includes("row-3-name-line-3"));
      await h.click(2, lastLine);
      expect(clicks).toEqual([[3, "row-3-name"]]);
    } finally {
      await h.cleanup();
    }
  });

  test("a skeleton can reserve a multi-line column area", async () => {
    const h = await renderTable(
      {
        rows: undefined,
        loading: true,
        skeletonRows: 2,
        skeletonContentHeight: 3,
        renderDetail: (row, _selected, width) => cell(row.name, width),
      },
      { height: 20 },
    );
    try {
      // Header + rule, then two skeleton rows of three column lines and one
      // detail line each.
      expect(inkLines(h.frame())).toHaveLength(2 + 2 * 4);
    } finally {
      await h.cleanup();
    }
  });
});

describe("DataTable narrow widths", () => {
  const CASES = [
    { width: 140, columns: ["Name", "Time", "Project", "Env", "Extra"], gone: [] },
    { width: 100, columns: ["Name", "Time", "Project", "Env"], gone: ["Extra"] },
    { width: 80, columns: ["Name", "Time", "Project"], gone: ["Env", "Extra"] },
  ];

  for (const { width, columns, gone } of CASES) {
    test(`sheds by priority at ${width} columns`, async () => {
      const h = await renderTable({}, { width });
      try {
        const frame = h.frame();
        for (const label of columns) expect(frame).toContain(label);
        for (const label of gone) expect(frame).not.toContain(label);
      } finally {
        await h.cleanup();
      }
    });

    test(`nothing overflows or wraps at ${width} columns`, async () => {
      const h = await renderTable({}, { width });
      try {
        const lines = h.frame().split("\n").filter(Boolean);
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(width);
        // Header, its rule, and one line per row: a wrapped cell would show
        // up here as a row that took two.
        expect(inkLines(h.frame())).toHaveLength(2 + ROWS.length);
      } finally {
        await h.cleanup();
      }
    });
  }
});

describe("DataTable states", () => {
  test("an empty result says so in the caller's words", async () => {
    const h = await renderTable({
      rows: [],
      empty: { title: "No widgets found.", lines: ["Try a wider time range."] },
    });
    try {
      expect(h.frame()).toContain("No widgets found.");
      expect(h.frame()).toContain("Try a wider time range.");
    } finally {
      await h.cleanup();
    }
  });

  test("a failed first load shows the error and how to retry", async () => {
    const h = await renderTable({
      rows: undefined,
      error: { message: "HTTP 500", retryable: true },
      errorTitle: "Failed to load widgets",
    });
    try {
      const frame = h.frame();
      expect(frame).toContain("Failed to load widgets");
      expect(frame).toContain("HTTP 500");
      expect(frame).toContain("R to retry");
    } finally {
      await h.cleanup();
    }
  });

  test("clicking a row reports its index and its row", async () => {
    const clicks: Array<[number, string]> = [];
    const h = await renderTable({
      onRowClick: (index, row) => clicks.push([index, row.name]),
    });
    try {
      // Row 0 sits below the header and its rule.
      const rowLine = h
        .frame()
        .split("\n")
        .findIndex((line) => line.includes("row-0-name"));
      await h.click(2, rowLine);
      expect(clicks).toEqual([[0, "row-0-name"]]);
    } finally {
      await h.cleanup();
    }
  });
});
