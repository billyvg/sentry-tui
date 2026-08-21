import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import {
  dashboardListFixture,
  prebuiltDashboardsFixture,
  starredDashboardsFixture,
} from "./dashboard-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

interface StubOptions {
  dashboards?: unknown;
  prebuilt?: unknown;
  starred?: unknown;
  /** Fail the list request, for the error state. */
  listStatus?: number;
  /** Every URL the client asked for, in order. */
  calls?: string[];
}

function stubClient({
  dashboards = dashboardListFixture,
  prebuilt = prebuiltDashboardsFixture,
  starred = starredDashboardsFixture,
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
    // Checked before the generic list route, whose path is a prefix of this one.
    if (url.includes("/dashboards/starred/")) return json(starred);
    if (url.includes("/dashboards/")) {
      if (listStatus !== 200) return json({ detail: "nope" }, listStatus);
      return json(url.includes("filter=onlyPrebuilt") ? prebuilt : dashboards);
    }
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

async function renderApp(client: SentryClient | null = stubClient()) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

/** Open the Dashboards sidebar without committing to an item. */
async function openDashboardsNav(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  // Content has focus by default; tab to the nav rail, then Issues → Explore →
  // Dashboards.
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

/** Navigate to Dashboards › All Dashboards. */
async function navigateToDashboards(h: Awaited<ReturnType<typeof renderHarness>>) {
  await openDashboardsNav(h);
  await h.press((i) => i.pressEnter());
}

/** Navigate to Dashboards › Sentry Built, the second item in the sidebar. */
async function navigateToSentryBuilt(h: Awaited<ReturnType<typeof renderHarness>>) {
  await openDashboardsNav(h);
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

// ---------------------------------------------------------------------------
// All Dashboards
// ---------------------------------------------------------------------------

test("All Dashboards lists the org's dashboards with the web's columns", async () => {
  const h = await renderApp();
  try {
    await navigateToDashboards(h);
    await h.waitForFrame((f) => f.includes("Checkout Health"));

    const frame = h.frame();
    expect(frame).toContain("Name");
    expect(frame).toContain("Widgets");
    expect(frame).toContain("Owner");
    expect(frame).toContain("Access");
    expect(frame).toContain("Created");
    expect(frame).toContain("Last Visited");

    expect(frame).toContain("Checkout Health");
    expect(frame).toContain("Mobile Crash Rates");
    expect(frame).toContain("API Latency");
    expect(frame).toContain("3 dashboards");
  } finally {
    await h.cleanup();
  }
});

test("the row shows widget count, owner, and access", async () => {
  const h = await renderApp();
  try {
    await navigateToDashboards(h);
    await h.waitForFrame((f) => f.includes("Checkout Health"));

    const frame = h.frame();
    expect(frame).toContain("Ada Lovelace");
    expect(frame).toContain("Grace Hopper");
    // A dashboard with no creator is Sentry's own.
    expect(frame).toContain("Sentry");
    // Open to everyone vs. restricted to the creator and two teams.
    expect(frame).toContain("All");
    expect(frame).toContain("Creator +2");
  } finally {
    await h.cleanup();
  }
});

test("the star column shows starred state and nothing can change it", async () => {
  const h = await renderApp();
  try {
    await navigateToDashboards(h);
    await h.waitForFrame((f) => f.includes("Checkout Health"));

    // One starred fixture, two unstarred.
    expect(h.frame()).toContain("★");
    expect(h.frame()).toContain("☆");

    // The list is read-only: no key on this screen writes, so the frame after
    // trying to act on a row is the frame before it.
    const before = h.frame();
    await h.press((i) => i.pressKey("s"));
    expect(h.frame()).toBe(before);
  } finally {
    await h.cleanup();
  }
});

test("j and k move the cursor through the dashboards", async () => {
  const h = await renderApp();
  try {
    await navigateToDashboards(h);
    await h.waitForFrame((f) => f.includes("Checkout Health"));

    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));

    const frame = h.frame();
    expect(frame).toContain("Checkout Health");
    expect(frame).toContain("API Latency");
  } finally {
    await h.cleanup();
  }
});

test("an empty list says the org may not have the feature rather than 'no results'", async () => {
  const h = await renderApp(stubClient({ dashboards: [] }));
  try {
    await navigateToDashboards(h);
    await h.waitForFrame((f) => f.includes("No dashboards found"));
    expect(h.frame()).toContain("may not have dashboards enabled");
  } finally {
    await h.cleanup();
  }
});

test("a failed list request shows the error state", async () => {
  const h = await renderApp(stubClient({ listStatus: 500 }));
  try {
    await navigateToDashboards(h);
    await h.waitForFrame((f) => f.includes("Failed to load dashboards"));
    expect(h.frame()).toContain("Failed to load dashboards");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Sentry Built
// ---------------------------------------------------------------------------

test("Sentry Built asks the endpoint for prebuilt dashboards and shows descriptions", async () => {
  const calls: string[] = [];
  const h = await renderApp(stubClient({ calls }));
  try {
    await navigateToSentryBuilt(h);
    await h.waitForFrame((f) => f.includes("Frontend Overview"));

    const frame = h.frame();
    expect(frame).toContain("Description");
    expect(frame).toContain("Web Vitals");
    // The prebuilt layout drops the three columns a prebuilt dashboard has no
    // values for.
    expect(frame).not.toContain("Owner");
    expect(frame).not.toContain("Access");

    expect(calls.some((url) => url.includes("filter=onlyPrebuilt"))).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("an empty Sentry Built list blames the missing feature, not the data", async () => {
  const h = await renderApp(stubClient({ prebuilt: [] }));
  try {
    await navigateToSentryBuilt(h);
    await h.waitForFrame((f) => f.includes("No Sentry Built dashboards"));
    expect(h.frame()).toContain("may not have prebuilt dashboards enabled");
  } finally {
    await h.cleanup();
  }
});

test("the skeleton holds the table's geometry while the list is in flight", async () => {
  // A request that never settles, so the screen stays on its first load.
  const pending = new SentryClient({
    auth,
    maxRetries: 0,
    fetchImpl: (async (input: RequestInfo | URL) => {
      if (String(input).includes("/dashboards/")) return new Promise<Response>(() => {});
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  const h = await renderApp(pending);
  try {
    await navigateToDashboards(h);
    await h.waitForFrame((f) => f.includes("Last Visited"));

    const frame = h.frame();
    // The header and the heading are already in their final positions, and
    // neither the empty nor the error state has claimed the pane.
    expect(frame).toContain("All Dashboards");
    expect(frame).toContain("Last Visited");
    expect(frame).not.toContain("No dashboards found");
    expect(frame).not.toContain("Failed to load dashboards");
    // Skeleton rows, drawn from the same resolved columns as a real row.
    expect(frame).toContain("─");
    expect(h.frame().split("\n").filter(Boolean)).toHaveLength(HEIGHT);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Narrow terminals
// ---------------------------------------------------------------------------

/**
 * Column shedding at the three widths the plan calls out.
 *
 * `layoutColumns` guarantees the arithmetic; what this pins is the *order* —
 * a dashboard's title has to survive every width, and Access is the first
 * thing worth giving up.
 */
const ALL_COLUMNS = ["Name", "Widgets", "Owner", "Access", "Created", "Last Visited"];

for (const { width, kept, shed } of [
  { width: 80, kept: ["Name", "Widgets", "Owner", "Last Visited"], shed: ["Access", "Created"] },
  { width: 100, kept: ALL_COLUMNS, shed: [] },
  { width: 140, kept: ALL_COLUMNS, shed: [] },
]) {
  test(`the dashboards table sheds columns and never wraps at ${width} columns`, async () => {
    const h = await renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
      width,
      height: HEIGHT,
    });
    try {
      await navigateToDashboards(h);
      // Not the full title: at these widths the flex column truncates it — see
      // the `minFlex` test below.
      await h.waitForFrame((f) => f.includes("Checkout"));

      const lines = h.frame().split("\n").filter(Boolean);
      // A row that overflowed its pane would push the frame wider; one that
      // wrapped would add a line the layout never budgeted for.
      expect(lines).toHaveLength(HEIGHT);
      expect([...new Set(lines.map((line) => line.length))]).toEqual([width]);

      for (const header of kept) expect(h.frame()).toContain(header);
      for (const header of shed) expect(h.frame()).not.toContain(header);
      // The title is what identifies a row, so something of it always survives.
      expect(h.frame()).toContain("Checkout");
    } finally {
      await h.cleanup();
    }
  });
}

/**
 * The title column is squeezed at moderate widths, and this pins how badly.
 *
 * `layoutColumns` sheds a column only once the flex column would go below
 * `minFlex`, whose default is 8 — so at 100 columns every metadata column
 * survives and the dashboard title, the only thing identifying a row, is left
 * with fewer cells than it gets at 80. `DataTable` grows an optional `minFlex`
 * on two other branches; passing `minFlex={24}` here is the fix, and this test
 * is what should change when it lands.
 */
test("the title column is narrower at 100 columns than at 80 — pending DataTable minFlex", async () => {
  const widths: Record<number, number> = {};

  for (const width of [80, 100]) {
    const h = await renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
      width,
      height: HEIGHT,
    });
    try {
      await navigateToDashboards(h);
      await h.waitForFrame((f) => f.includes("Checkout"));
      // Cells between the start of the Name header and the Widgets header
      // beside it, minus the gap.
      const header = h
        .frame()
        .split("\n")
        .find((line) => line.includes("★ Name"))!;
      widths[width] = header.indexOf("Widgets") - header.indexOf("Name") - 1;
    } finally {
      await h.cleanup();
    }
  }

  // Both are too narrow for a real dashboard title, and 100 is the worse of
  // the two. Neither should survive the `minFlex` adoption.
  expect(widths[80]).toBeLessThan(20);
  expect(widths[100]).toBeLessThanOrEqual(widths[80]!);
});

// ---------------------------------------------------------------------------
// Starred Dashboards nav section
// ---------------------------------------------------------------------------

test("the sidebar shows a Starred Dashboards section", async () => {
  const h = await renderApp();
  try {
    await openDashboardsNav(h);
    await h.waitForFrame((f) => f.includes("Starred"));

    const frame = h.frame();
    expect(frame).toContain("All Dashboards");
    expect(frame).toContain("Sentry Built");
    expect(frame).toContain("Starred");
    expect(frame).toContain("Checkout Health");
  } finally {
    await h.cleanup();
  }
});

test("the starred section is hidden when nothing is starred", async () => {
  const h = await renderApp(stubClient({ starred: [] }));
  try {
    await openDashboardsNav(h);
    await h.waitForFrame((f) => f.includes("Sentry Built"));
    expect(h.frame()).not.toContain("Starred");
  } finally {
    await h.cleanup();
  }
});

test("a starred item opens the list that contains it", async () => {
  const h = await renderApp();
  try {
    await openDashboardsNav(h);
    await h.waitForFrame((f) => f.includes("Starred"));

    // Past All Dashboards and Sentry Built, onto the one starred entry.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("Every dashboard in this organization"));
    expect(h.frame()).toContain("Checkout Health");
  } finally {
    await h.cleanup();
  }
});

test("the starred section is only fetched for the Dashboards sidebar", async () => {
  const calls: string[] = [];
  const h = await renderApp(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    expect(calls.some((url) => url.includes("/dashboards/starred/"))).toBe(false);

    await openDashboardsNav(h);
    await h.waitForFrame((f) => f.includes("Starred"));
    expect(calls.some((url) => url.includes("/dashboards/starred/"))).toBe(true);
  } finally {
    await h.cleanup();
  }
});
