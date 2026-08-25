import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import type { Detector } from "~/api/detectors";
import type { ScreenId } from "~/core/screens";
import { darkTheme } from "~/core/theme";
import { DataTable } from "~/ui/components/DataTable";
import { layoutColumns } from "~/ui/lib/tableLayout";
import {
  monitorColumns,
  MONITOR_MIN_FLEX,
  renderDetectorDetail,
} from "~/ui/screens/monitorColumns";
import { App } from "~/ui/App";
import { renderHarness } from "./helpers";
import { detectorListFixture, monitorProjectsFixture } from "./monitor-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

interface StubOptions {
  detectors?: unknown;
  /** Fail the list request, for the error state. */
  listStatus?: number;
  /** Every URL the client asked for, in order. */
  calls?: string[];
}

function stubClient({
  detectors = detectorListFixture,
  listStatus = 200,
  calls,
}: StubOptions = {}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls?.push(url);
    if (url.includes("/detectors/")) {
      if (listStatus !== 200) return json({ detail: "nope" }, listStatus);
      return json(detectors);
    }
    if (url.includes("/projects/")) return json(monitorProjectsFixture);
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

/** Mount straight onto a Monitors screen; the rail walk has its own test. */
async function renderMonitors(
  client: SentryClient | null = stubClient(),
  screen: ScreenId = "monitors.all",
) {
  return renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen={screen} />,
    { width: WIDTH, height: HEIGHT },
  );
}

/** The query string one detector request carried, decoded. */
function detectorQuery(calls: string[]): string {
  const url = calls.find((candidate) => candidate.includes("/detectors/"));
  return decodeURIComponent(new URL(url ?? "https://x/").searchParams.get("query") ?? "");
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("the Monitors sidebar reaches the detector table", async () => {
  const h = await renderMonitors(stubClient(), "issues.feed");
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));

    // Open the compact rail, then walk to Monitors and
    // take its first item.
    await h.openNav();
    // Issues → Explore → Dashboards → Seer → Monitors.
    for (let step = 0; step < 4; step++) await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("checkout p95 latency"));
    expect(h.frame()).toContain("All Monitors");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

test("All Monitors lists detectors with the web's columns", async () => {
  const h = await renderMonitors();
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));

    const frame = h.frame();
    expect(frame).toContain("Name");
    expect(frame).toContain("Type");
    expect(frame).toContain("Last Issue");
    expect(frame).toContain("Assignee");
    expect(frame).toContain("Alerts");

    expect(frame).toContain("nightly-billing-rollup");
    expect(frame).toContain("marketing site uptime");
    expect(frame).toContain("6 monitors");

    // Type labels, and the assignee of each row.
    expect(frame).toContain("Metric");
    expect(frame).toContain("Cron");
    expect(frame).toContain("Uptime");
    expect(frame).toContain("Ada Lovelace");
    expect(frame).toContain("#billing-team");
  } finally {
    await h.cleanup();
  }
});

test("the second line says what each kind of monitor watches", async () => {
  const h = await renderMonitors();
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));
    const frame = h.frame();

    // Metric: project, environment, aggregate, query, threshold.
    expect(frame).toContain("checkout │ production │ p95(span.duration)");
    // Cron: project and the crontab as a phrase.
    expect(frame).toContain("billing │ Every day at 09:00");
    // Uptime: project, url, interval.
    expect(frame).toContain("marketing │ https://example.com");
    expect(frame).toContain("Every 1m");
    // Mobile build: project, measurement and threshold type.
    expect(frame).toContain("mobile │ download_size absolute");
  } finally {
    await h.cleanup();
  }
});

test("a monitor with no last issue and no assignee draws em dashes, not blanks", async () => {
  const h = await renderMonitors();
  try {
    await h.waitForFrame((f) => f.includes("nightly-billing-rollup"));
    expect(h.frame()).toContain("—");
  } finally {
    await h.cleanup();
  }
});

test("a disabled monitor renders muted", async () => {
  const h = await renderMonitors();
  try {
    await h.waitForFrame((f) => f.includes("android download size"));

    const disabled = h.spanContaining("android download size");
    const enabled = h.spanContaining("marketing site uptime");
    expect(String(disabled?.fg)).toBe(rgbaOf(darkTheme.muted));
    expect(String(enabled?.fg)).not.toBe(rgbaOf(darkTheme.muted));
  } finally {
    await h.cleanup();
  }
});

test("a data source that came back without its query still renders its row", async () => {
  const h = await renderMonitors();
  try {
    // The sixth fixture is a cron detector with `queryObj: null`: it keeps its
    // name and its project and simply has no schedule to show.
    await h.waitForFrame((f) => f.includes("session-cleanup"));
    expect(h.frame()).not.toContain("Failed to load monitors");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The seven queries
// ---------------------------------------------------------------------------

const QUERY_CASES: Array<[ScreenId, string]> = [
  ["monitors.all", "!type:issue_stream"],
  ["monitors.mine", "!type:issue_stream assignee:[me,my_teams]"],
  ["monitors.error", "!type:issue_stream type:error"],
  ["monitors.metric", "!type:issue_stream type:metric_issue"],
  ["monitors.cron", "!type:issue_stream type:monitor_check_in_failure"],
  ["monitors.uptime", "!type:issue_stream type:uptime_domain_failure"],
  ["monitors.mobile-build", "!type:issue_stream type:preprod_size_analysis"],
];

for (const [screen, query] of QUERY_CASES) {
  test(`${screen} asks the endpoint for ${query}`, async () => {
    const calls: string[] = [];
    const h = await renderMonitors(stubClient({ calls }), screen);
    try {
      await h.waitForFrame((f) => f.includes("checkout p95 latency"));
      expect(detectorQuery(calls)).toBe(query);
    } finally {
      await h.cleanup();
    }
  });
}

/**
 * The seven screens share a state slice and, because they are one component in
 * one position, a component instance too — so a load that carried its rows
 * forward would open Metric on Cron's detectors. A refresh or a search still
 * carries them: only the screen changing drops them.
 */
test("switching screens drops the previous screen's rows rather than showing them", async () => {
  let detectorCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/detectors/")) {
      detectorCalls += 1;
      if (detectorCalls > 1) return new Promise<Response>(() => {});
      return json(detectorListFixture);
    }
    return json([]);
  }) as unknown as typeof fetch;

  const h = await renderMonitors(new SentryClient({ auth, fetchImpl, maxRetries: 0 }));
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));

    await h.press((i) => i.pressKey("k", { ctrl: true }));
    await h.press((i) => i.pressKey("metric"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Thresholds and anomalies"));

    expect(h.frame()).not.toContain("checkout p95 latency");
  } finally {
    await h.cleanup();
  }
});

test("a submitted search narrows within the screen's own filter", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }), "monitors.cron");
  try {
    await h.waitForFrame((f) => f.includes("nightly-billing-rollup"));

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("billing"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame(() => calls.filter((url) => url.includes("/detectors/")).length > 1);
    const last = calls.filter((url) => url.includes("/detectors/")).at(-1)!;
    expect(decodeURIComponent(new URL(last).searchParams.get("query") ?? "")).toBe(
      "!type:issue_stream type:monitor_check_in_failure billing",
    );
  } finally {
    await h.cleanup();
  }
});

test("the list is sorted by the most recently fired monitor, as the web is", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));
    const url = calls.find((candidate) => candidate.includes("/detectors/"))!;
    expect(new URL(url).searchParams.get("sortBy")).toBe("-latestGroup");
  } finally {
    await h.cleanup();
  }
});

test("S changes the monitor sort using the screen's own options", async () => {
  const calls: string[] = [];
  const h = await renderMonitors(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));

    await h.press((i) => i.pressKey("S"));
    await h.waitForFrame((frame) => frame.includes("Sort By"));
    expect(h.frame()).toContain("Latest Issue (newest)");
    expect(h.frame()).toContain("Name (A-Z)");

    // Newest → oldest → Name (A-Z).
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame(() =>
      calls
        .filter((url) => url.includes("/detectors/"))
        .some((url) => new URL(url).searchParams.get("sortBy") === "name"),
    );

    expect(h.frame()).toContain("S Name (A-Z)");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

test("an empty list names the feature rather than saying 'no results'", async () => {
  const h = await renderMonitors(stubClient({ detectors: [] }), "monitors.uptime");
  try {
    await h.waitForFrame((f) => f.includes("No uptime monitors found"));
    expect(h.frame()).toContain("may not have uptime monitoring enabled");
  } finally {
    await h.cleanup();
  }
});

test("a failed list request shows the error state", async () => {
  const h = await renderMonitors(stubClient({ listStatus: 500 }));
  try {
    await h.waitForFrame((f) => f.includes("Failed to load monitors"));
    expect(h.frame()).toContain("Failed to load monitors");
  } finally {
    await h.cleanup();
  }
});

test("the skeleton holds the table's geometry while the list is in flight", async () => {
  const pending = new SentryClient({
    auth,
    maxRetries: 0,
    fetchImpl: (async (input: RequestInfo | URL) => {
      if (String(input).includes("/detectors/")) return new Promise<Response>(() => {});
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  const h = await renderMonitors(pending);
  try {
    await h.waitForFrame((f) => f.includes("Last Issue"));

    const frame = h.frame();
    expect(frame).toContain("All Monitors");
    expect(frame).toContain("Alerts");
    expect(frame).not.toContain("No monitors found");
    expect(frame).not.toContain("Failed to load monitors");
    expect(frame).toContain("─");
    expect(frame.split("\n").filter(Boolean)).toHaveLength(HEIGHT);
  } finally {
    await h.cleanup();
  }
});

/**
 * `P` / `E` / `D` must not be able to wedge the keyboard.
 *
 * The router opens a filter dropdown for any list screen and only `Dropdown`
 * closes one, so a screen with no filter row has to close it itself — see the
 * same test on the dashboards list.
 */
for (const key of ["P", "E", "D"]) {
  test(`${key} is a no-op on the monitor list, not a keyboard lock`, async () => {
    const h = await renderMonitors();
    try {
      await h.waitForFrame((f) => f.includes("checkout p95 latency"));

      await h.press((i) => i.pressKey(key, { shift: true }));
      // The keyboard still answers: the cursor moves.
      await h.press((i) => i.pressKey("j"));
      expect(h.frame()).toContain("checkout p95 latency");
      expect(h.frame()).not.toContain("Project");
    } finally {
      await h.cleanup();
    }
  });
}

test("the screen fits an 80-column terminal without wrapping", async () => {
  const h = await renderHarness(
    <App onQuit={() => {}} client={stubClient()} org="acme" initialScreen="monitors.all" />,
    { width: 80, height: 24 },
  );
  try {
    await h.waitForFrame((f) => f.includes("checkout p95 latency"));
    for (const line of h.frame().split("\n")) expect(line.length).toBeLessThanOrEqual(80);
    // The pane is ~57 cells wide there, so the row has shed down to the two
    // columns that identify it — and both are still readable.
    expect(h.frame()).toContain("nightly-billing-rollup");
    expect(h.frame()).toContain("Cron");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Row geometry, at the widths a terminal is actually used at
// ---------------------------------------------------------------------------

const PROJECT_SLUGS = new Map(monitorProjectsFixture.map((p) => [p.id, p.slug]));

function renderRows(rows: Detector[] | undefined, width: number, loading = false) {
  return renderHarness(
    <box style={{ width, height: 24, flexDirection: "column" }}>
      <DataTable<Detector>
        rows={rows}
        columns={monitorColumns(darkTheme)}
        width={width}
        minFlex={MONITOR_MIN_FLEX}
        selectedIndex={0}
        focused
        rowKey={(detector) => detector.id}
        loading={loading}
        skeletonRows={detectorListFixture.length}
        renderDetail={(detector, _selected, detailWidth) =>
          renderDetectorDetail(detector, detailWidth, {
            projectSlugs: PROJECT_SLUGS,
            theme: darkTheme,
          })
        }
      />
    </box>,
    { width, height: 24 },
  );
}

/** Indices of the lines that have any ink on them. */
function inkLines(frame: string): number[] {
  return frame
    .split("\n")
    .map((line, i) => (line.trim() === "" ? -1 : i))
    .filter((i) => i >= 0);
}

test("a skeleton row holds the two-line row's geometry exactly", async () => {
  // One renderer at a time: two live harnesses share OpenTUI's globals.
  const real = await renderRows(detectorListFixture, WIDTH);
  const realFrame = real.frame();
  await real.cleanup();

  const skeleton = await renderRows(undefined, WIDTH, true);
  const skeletonFrame = skeleton.frame();
  await skeleton.cleanup();

  // Same lines carry content: the header, its rule, and two lines per row.
  expect(inkLines(skeletonFrame)).toEqual(inkLines(realFrame));

  const realLines = realFrame.split("\n");
  const skeletonLines = skeletonFrame.split("\n");

  // And on the line that carries the columns, every left-aligned cell begins
  // in the same column in both. Only left-aligned ones: a right-aligned cell
  // is padding first, and how much depends on the value. Ink *runs* can't be
  // compared the way `dataTable.test.tsx` compares them either — a real
  // monitor name has spaces in it and a skeleton bar does not.
  const resolved = layoutColumns(monitorColumns(darkTheme), WIDTH - 2, {
    gap: 1,
    minFlex: MONITOR_MIN_FLEX,
  });
  const leftOffsets = resolved
    .filter(({ column }) => (column.align ?? "left") === "left")
    .map(({ offset }) => offset);

  // Header on line 0, its rule on line 1, then two lines per row.
  const columnLines = detectorListFixture.map((_, index) => 2 + index * 2);
  for (const line of [0, ...columnLines]) {
    for (const offset of leftOffsets) {
      expect({ line, offset, ink: skeletonLines[line]?.[offset] !== " " }).toEqual({
        line,
        offset,
        ink: realLines[line]?.[offset] !== " ",
      });
    }
  }
});

const SHEDDING_CASES = [
  { width: 140, present: ["Name", "Type", "Last Issue", "Assignee", "Alerts"], gone: [] },
  { width: 100, present: ["Name", "Type", "Last Issue", "Assignee", "Alerts"], gone: [] },
  { width: 80, present: ["Name", "Type", "Assignee"], gone: ["Alerts", "Last Issue"] },
];

for (const { width, present, gone } of SHEDDING_CASES) {
  test(`sheds the web's columns in the web's order at ${width} columns`, async () => {
    const h = await renderRows(detectorListFixture, width);
    try {
      const frame = h.frame();
      for (const label of present) expect(frame).toContain(label);
      for (const label of gone) expect(frame).not.toContain(label);
      // Nothing may overflow the pane, at any width.
      for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(width);
      // And the name is still readable rather than squeezed to an ellipsis.
      expect(frame).toContain("nightly-billing-rollup");
    } finally {
      await h.cleanup();
    }
  });
}

/**
 * A theme color as OpenTUI prints it back — `rgba(r, g, b, a)` with each
 * channel a fraction. `spanContaining` hands back the parsed color, so an
 * assertion against a hex string has to meet it here.
 */
function rgbaOf(hex: string): string {
  const channel = (at: number) => (Number.parseInt(hex.slice(at, at + 2), 16) / 255).toFixed(2);
  return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, 1.00)`;
}
