import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import {
  dashboardDetailFixture,
  dashboardListFixture,
  widgetBarRowsFixture,
  widgetCountRowsFixture,
  widgetTableRowsFixture,
  widgetTimeseriesFixture,
} from "./dashboard-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
/** Tall enough that most of the widget stack is on screen at once. */
const HEIGHT = 44;

interface StubOptions {
  detail?: unknown;
  detailStatus?: number;
  /** Every URL the client asked for, in order. */
  calls?: string[];
}

function stubClient({
  detail = dashboardDetailFixture,
  detailStatus = 200,
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

    if (url.includes("/dashboards/starred/")) return json([]);
    if (/\/dashboards\/\d+\//.test(url)) {
      return detailStatus === 200 ? json(detail) : json({ detail: "nope" }, detailStatus);
    }
    if (url.includes("/dashboards/")) return json(dashboardListFixture);

    if (url.includes("/events-stats/")) return json({ data: widgetTimeseriesFixture });
    if (url.includes("/events/")) {
      if (url.includes("browser.name")) return json({ data: widgetBarRowsFixture });
      if (url.includes("transaction")) return json({ data: widgetTableRowsFixture });
      return json({ data: widgetCountRowsFixture });
    }
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

/**
 * Mount straight onto All Dashboards.
 *
 * `dashboards.test.tsx` covers the rail walk to get here; repeating it in
 * every test cost a render pass per keystroke for a route these tests are
 * not about.
 */
async function renderApp(
  client: SentryClient = stubClient(),
  initialProjectsByOrg: Readonly<Record<string, readonly string[]>> = {},
) {
  return renderHarness(
    <App
      onQuit={() => {}}
      client={client}
      org="acme"
      initialScreen="dashboards.all"
      initialProjectsByOrg={initialProjectsByOrg}
    />,
    { width: WIDTH, height: HEIGHT },
  );
}

/** Open the first dashboard row — the interaction these tests are about. */
async function openDashboard(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.waitForFrame((f) => f.includes("Checkout Health"));
  await h.press((i) => i.pressEnter());
  await h.waitForFrame((f) => f.includes("Errors Today"));
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

test("enter on a dashboard opens its widgets, stacked in layout order", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);

    const frame = h.frame();
    // The fixture's response order is not its layout order; the grid sorts by
    // `y` then `x`.
    const order = ["Errors Today", "Error Rate", "Slowest Transactions", "Errors by Browser"];
    const positions = order.map((title) => frame.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(frame).toContain("widget 1 of 6");
  } finally {
    await h.cleanup();
  }
});

test("a dashboard keeps its own project scope instead of the remembered org default", async () => {
  const calls: string[] = [];
  const h = await renderApp(stubClient({ calls }), { acme: ["remembered-default"] });
  try {
    await openDashboard(h);
    await h.waitForFrame(() => calls.some((url) => url.includes("/events/")));

    const widgetCalls = calls.filter(
      (url) => url.includes("/events/") || url.includes("/events-stats/"),
    );
    expect(widgetCalls.length).toBeGreaterThan(0);
    for (const url of widgetCalls) {
      expect(new URL(url).searchParams.getAll("project")).toEqual(["-1"]);
    }
  } finally {
    await h.cleanup();
  }
});

test("a big number widget draws its value in block glyphs", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);
    await h.waitForFrame((f) => f.includes("count()"));

    const frame = h.frame();
    // 41234 formats as `41.2k`: the digits are drawn large, the suffix isn't.
    expect(frame).toMatch(/█/);
    expect(frame).toContain("k");
    expect(frame).toContain("count()");
  } finally {
    await h.cleanup();
  }
});

test("a series widget draws a block chart with an axis", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);
    await h.waitForFrame((f) => f.includes("Error Rate"));
    // Block glyphs, and the aggregate named down the left of the axis row.
    await h.waitForFrame((f) => /[▁▂▃▄▅▆▇█]/.test(f));
    expect(h.frame()).toContain("Error Rate");
  } finally {
    await h.cleanup();
  }
});

test("a table widget draws its columns, using the author's aliases", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);
    await h.waitForFrame((f) => f.includes("/checkout"));

    const frame = h.frame();
    expect(frame).toContain("transaction");
    // `fieldAliases` renames the aggregate column.
    expect(frame).toContain("p95");
    expect(frame).toContain("/checkout");
    expect(frame).toContain("/api/orders");
  } finally {
    await h.cleanup();
  }
});

test("a categorical widget draws labelled horizontal bars", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);
    // The fourth widget is beyond the initial fetch window; walk the cursor to it.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.waitForFrame((f) => f.includes("Chrome"));

    const frame = h.frame();
    expect(frame).toContain("Chrome");
    expect(frame).toContain("Safari");
    expect(frame).toMatch(/█/);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The two fallbacks
// ---------------------------------------------------------------------------

test("a display type the terminal can't draw says so instead of rendering blank", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);
    for (let i = 0; i < 4; i++) await h.press((i2) => i2.pressKey("j"));
    await h.waitForFrame((f) => f.includes("Traffic Wheel"));

    const frame = h.frame();
    expect(frame).toContain("Traffic Wheel");
    expect(frame).toContain("not renderable in the terminal");
  } finally {
    await h.cleanup();
  }
});

test("a widget on a dataset this client can't read says that, and asks for nothing", async () => {
  const calls: string[] = [];
  const h = await renderApp(stubClient({ calls }));
  try {
    await openDashboard(h);
    await h.press((i) => i.pressKey("G", { shift: true }));
    await h.waitForFrame((f) => f.includes("Unresolved Issues"));

    expect(h.frame()).toContain("not read through the events API");
    // The issue widget's own conditions were never sent to the events endpoint.
    const eventCalls = calls.filter((url) => url.includes("/events"));
    expect(eventCalls.some((url) => url.includes("is%3Aunresolved"))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Cursor, requests, and going back
// ---------------------------------------------------------------------------

test("j and k step between widgets", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);
    expect(h.frame()).toContain("widget 1 of 6");

    await h.press((i) => i.pressKey("j"));
    expect(h.frame()).toContain("widget 2 of 6");

    await h.press((i) => i.pressKey("j"));
    expect(h.frame()).toContain("widget 3 of 6");

    await h.press((i) => i.pressKey("k"));
    expect(h.frame()).toContain("widget 2 of 6");

    await h.press((i) => i.pressKey("G", { shift: true }));
    expect(h.frame()).toContain("widget 6 of 6");

    await h.press((i) => i.pressKey("g"));
    expect(h.frame()).toContain("widget 1 of 6");
  } finally {
    await h.cleanup();
  }
});

test("opening a dashboard does not fire one request per widget", async () => {
  const calls: string[] = [];
  const h = await renderApp(stubClient({ calls }));
  try {
    await openDashboard(h);
    await h.waitForFrame((f) => f.includes("/checkout"));

    const widgetCalls = calls.filter(
      (url) => url.includes("/events/") || url.includes("/events-stats/"),
    );
    // Six widgets; two of them need nothing, and the rest are fetched a
    // window at a time as the cursor moves.
    expect(widgetCalls.length).toBeLessThanOrEqual(3);
    expect(calls.filter((url) => /\/dashboards\/\d+\//.test(url))).toHaveLength(1);
  } finally {
    await h.cleanup();
  }
});

test("a widget already fetched is not fetched again when the cursor returns", async () => {
  const calls: string[] = [];
  const h = await renderApp(stubClient({ calls }));
  try {
    await openDashboard(h);
    // Walk to the end so every fetchable widget has been asked for once.
    await h.press((i) => i.pressKey("G", { shift: true }));
    await h.waitForFrame((f) => f.includes("Chrome"));
    const before = calls.filter((url) => url.includes("/events")).length;
    // Four widgets have data; the other two need nothing.
    expect(before).toBe(4);

    await h.press((i) => i.pressKey("g"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("k"));
    await h.press((i) => i.pressKey("G", { shift: true }));

    expect(calls.filter((url) => url.includes("/events")).length).toBe(before);
  } finally {
    await h.cleanup();
  }
});

test("escape pops back to the list with its cursor where it was left", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("Mobile Crash Rates"));

    // Move to the second row, open it, come back.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Errors Today"));

    await h.pressEscape();
    await h.waitForFrame((f) => f.includes("Every dashboard in this organization"));

    // The list is back, and Enter opens the row the cursor was left on.
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Errors Today"));
    expect(h.frame()).toContain("Checkout Health");
  } finally {
    await h.cleanup();
  }
});

test("a failed dashboard request shows the error rather than an empty grid", async () => {
  const h = await renderApp(stubClient({ detailStatus: 500 }));
  try {
    await h.waitForFrame((f) => f.includes("Checkout Health"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("Failed to load dashboard"));
    expect(h.frame()).toContain("Failed to load dashboard");
  } finally {
    await h.cleanup();
  }
});

test("a dashboard with no widgets says so", async () => {
  const h = await renderApp(stubClient({ detail: { ...dashboardDetailFixture, widgets: [] } }));
  try {
    await h.waitForFrame((f) => f.includes("Checkout Health"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("no widgets"));
    expect(h.frame()).toContain("This dashboard has no widgets");
  } finally {
    await h.cleanup();
  }
});

test("a Sentry Built dashboard says why the API has no widgets for it", async () => {
  // Prebuilt dashboards keep their widgets in the web app's own
  // `prebuiltConfigs`, so the detail endpoint answers with the shell alone —
  // which must not read as "somebody emptied this dashboard".
  const h = await renderApp(
    stubClient({
      detail: { ...dashboardDetailFixture, widgets: [], prebuiltId: "ai-agents-overview" },
    }),
  );
  try {
    await h.waitForFrame((f) => f.includes("Checkout Health"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("Sentry Built dashboards have no widgets"));
    expect(h.frame()).toContain("defined in the web app");
    expect(h.frame()).not.toContain("Add one on sentry.io");
  } finally {
    await h.cleanup();
  }
});

/**
 * The grid renders the filter row, so the keys that open a dropdown have one.
 *
 * A pushed `stateKey` view is driven by the app's key router exactly as a
 * screen is, which includes `P` / `E` / `D` — and a dropdown with nothing
 * mounted to close it swallows every later key. The widget queries take these
 * filters, so the row belongs here anyway.
 */
test("P opens a real filter dropdown on the grid, and escape closes it", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);

    await h.press((i) => i.pressKey("P", { shift: true }));
    expect(h.frame()).toContain("Project");

    await h.pressEscape();
    expect(h.frame()).not.toContain("Project");
    // The keyboard is still live.
    await h.press((i) => i.pressKey("?", { shift: true }));
    expect(h.frame()).toContain("Keyboard");
  } finally {
    await h.cleanup();
  }
});

test("/ on the grid focuses nothing it cannot give back", async () => {
  const h = await renderApp();
  try {
    await openDashboard(h);
    // The grid has no search box; `/` still arms the search state, and Escape
    // has to be able to disarm it or the keys stay captured.
    await h.press((i) => i.pressKey("/"));
    await h.pressEscape();

    await h.press((i) => i.pressKey("?", { shift: true }));
    expect(h.frame()).toContain("Keyboard");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

for (const width of [80, 100, 140]) {
  test(`the widget grid fits ${width} columns without wrapping`, async () => {
    const h = await renderHarness(
      <App onQuit={() => {}} client={stubClient()} org="acme" initialScreen="dashboards.all" />,
      {
        width,
        height: HEIGHT,
      },
    );
    try {
      await openDashboard(h);
      // Walk the whole stack so every widget kind is drawn at this width.
      for (let i = 0; i < 6; i++) {
        await h.press((input) => input.pressKey("j"));
        const lines = h.frame().split("\n").filter(Boolean);
        expect(lines).toHaveLength(HEIGHT);
        expect([...new Set(lines.map((line) => line.length))]).toEqual([width]);
      }
    } finally {
      await h.cleanup();
    }
  });
}

/**
 * The filter row stays one line tall.
 *
 * The row is wider than the pane below about 90 cells. Left to wrap, its sort
 * label becomes a column of one- and two-character fragments eight lines deep
 * and shoves the widget stack down out of the pane — which is what the pane
 * did before `FilterBar` learned to keep itself on one line. Short terminal on
 * purpose: at 44 rows there is enough slack to hide it.
 */
test("the filter row does not push the widget stack off a short 80-column terminal", async () => {
  const h = await renderHarness(
    <App onQuit={() => {}} client={stubClient()} org="acme" initialScreen="dashboards.all" />,
    {
      width: 80,
      height: 30,
    },
  );
  try {
    await openDashboard(h);
    const lines = h.frame().split("\n");
    // Heading, the three-line filter row, the card border, then the title.
    expect(lines.findIndex((line) => line.includes("Errors Today"))).toBeLessThanOrEqual(7);
  } finally {
    await h.cleanup();
  }
});

test("the grid holds its geometry before the dashboard has arrived", async () => {
  // The detail request never settles, so the grid stays on the widget shapes
  // the list row already told it about.
  const pending = new SentryClient({
    auth,
    maxRetries: 0,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/dashboards\/\d+\//.test(url)) return new Promise<Response>(() => {});
      if (url.includes("/dashboards/starred/")) {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/dashboards/")) {
        return new Response(JSON.stringify(dashboardListFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  const h = await renderApp(pending);
  try {
    await h.waitForFrame((f) => f.includes("Checkout Health"));
    await h.press((i) => i.pressEnter());

    // `widgetDisplay` on the list row is three widgets, so three cards are
    // drawn at their real heights with their display types named.
    await h.waitForFrame((f) => f.includes("big_number"));
    const frame = h.frame();
    expect(frame).toContain("big_number");
    expect(frame).toContain("line");
    expect(frame).toContain("table");
    expect(frame).toContain("widget 1 of 3");
    expect(frame.split("\n").filter(Boolean)).toHaveLength(HEIGHT);
  } finally {
    await h.cleanup();
  }
});
