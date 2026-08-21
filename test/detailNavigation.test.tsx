/**
 * Navigation while a view is on the stack.
 *
 * A pushed view used to make the nav panes inert: Tab moved focus into the rail
 * and painted its focus ring, then j/k/Enter did nothing, which reads as a hung
 * app rather than as a modal state. It also said nothing about Escape being the
 * way out — the status bar printed the ordinary list hints over an opened saved
 * query, and only the issue detail carried a breadcrumb, hand-rolled.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { DetailBackRow } from "~/ui/components/DetailBackRow";
import { eventFixture, groupsFixture } from "./fixtures";
import { renderHarness, type Harness } from "./helpers";
import { rawExploreSavedQueriesFixture, savedQueryResultRowsFixture } from "./saved-query-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

const PROJECTS = [{ id: "42", slug: "checkout", name: "Checkout", platform: "python" }];

function stubClient() {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("issues-stats")) return json({});
    if (url.includes("/events/")) {
      return json(url.includes("/issues/") ? eventFixture : { data: savedQueryResultRowsFixture });
    }
    if (url.includes("/explore/saved/")) return json(rawExploreSavedQueriesFixture);
    if (url.includes("/discover/saved/")) return json([]);
    if (url.includes("/projects/")) return json(PROJECTS);
    if (url.includes("/issues/")) return json(groupsFixture);
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

async function renderApp() {
  return renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

/** Issues › Feed → the first issue's detail. A view with no state of its own. */
async function openIssueDetail(): Promise<Harness> {
  const h = await renderApp();
  await h.waitForFrame((f) => f.includes("TypeError"));
  await h.press((i) => i.pressEnter());
  await h.waitForFrame((f) => f.includes("Issues › Feed › PUMP-STATION-1"));
  return h;
}

/**
 * Explore › All Queries → the first query's results. A view *with* a state
 * slice: rows, a cursor and a filter row, driven like a screen.
 */
async function openSavedQueryResults(): Promise<Harness> {
  const h = await renderApp();
  await h.waitForFrame((f) => f.includes("TypeError") || f.includes("No issues"));
  // Rail → Explore, then down the sidebar to All Queries (9 past Traces).
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  for (let n = 0; n < 9; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  await h.waitForFrame((f) => f.includes("Slow checkout spans"));
  await h.press((i) => i.pressEnter());
  await h.waitForFrame((f) => f.includes("Explore › All Queries › Slow checkout spans"));
  return h;
}

// ---------------------------------------------------------------------------
// The nav panes stay live
// ---------------------------------------------------------------------------

test("the nav rail answers j/k while a detail view is open", async () => {
  const h = await openIssueDetail();
  try {
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    // Enter on the rail's second group opens Explore's sidebar — proof the
    // cursor moved and that Enter was heard, neither of which used to happen.
    expect(h.frame()).toContain("Traces");
    // The view is still underneath: none of that navigated anywhere.
    expect(h.frame()).toContain("Issues › Feed › PUMP-STATION-1");
  } finally {
    await h.cleanup();
  }
});

test("the nav rail answers j/k over a view that has its own state slice", async () => {
  const h = await openSavedQueryResults();
  try {
    await h.press((i) => i.pressTab());
    // The rail is parked on Explore, where this view came from; `k` walks it
    // back up to Issues, whose sidebar is the proof the cursor moved.
    await h.press((i) => i.pressKey("k"));
    await h.press((i) => i.pressEnter());

    expect(h.frame()).toContain("Feed");
    expect(h.frame()).toContain("Explore › All Queries › Slow checkout spans");
  } finally {
    await h.cleanup();
  }
});

test("choosing a nav item from inside a detail view leaves it behind", async () => {
  const h = await openIssueDetail();
  try {
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.press((i) => i.pressEnter()); // Explore › Traces

    await h.waitForFrame((f) => !f.includes("PUMP-STATION-1"));
    // The stack is gone with it: no trail, no back control.
    expect(h.frame()).not.toContain("Issues › Feed ›");
    expect(h.frame()).not.toContain("back to");
  } finally {
    await h.cleanup();
  }
});

test("escape closes the secondary drawer before it pops the view", async () => {
  const h = await openIssueDetail();
  try {
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressEnter()); // Issues' own sidebar, over the view

    await h.pressEscape();
    // Drawer gone, view still there.
    expect(h.frame()).toContain("Issues › Feed › PUMP-STATION-1");

    await h.pressEscape();
    expect(h.frame()).not.toContain("PUMP-STATION-1 ─");
    await h.waitForFrame((f) => f.includes("TypeError") && !f.includes("back to Feed"));
  } finally {
    await h.cleanup();
  }
});

test("escape pops the view from the nav rail too", async () => {
  const h = await openIssueDetail();
  try {
    await h.press((i) => i.pressTab());
    await h.pressEscape();

    await h.waitForFrame((f) => !f.includes("back to Feed"));
    expect(h.frame()).not.toContain("Issues › Feed › PUMP-STATION-1");
  } finally {
    await h.cleanup();
  }
});

test("triage keys stay with the content pane, detail view included", async () => {
  const h = await openIssueDetail();
  try {
    await h.press((i) => i.pressTab()); // focus the rail
    await h.press((i) => i.pressKey("r"));

    // `r` on the rail is not a resolve: nothing was written, and the header
    // still says what it said.
    expect(h.frame()).not.toContain("resolving");
    expect(h.frame()).toContain("unresolved");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Saying where you are and how to leave
// ---------------------------------------------------------------------------

test("a stateful view prints the trail, the back control and the back hint", async () => {
  const h = await openSavedQueryResults();
  try {
    const frame = h.frame();
    const lines = frame.split("\n");

    // The trail rides the pane's top border, out of the content's way…
    const border = lines.find((line) => line.includes("Explore › All Queries ›")) ?? "";
    expect(border).toContain("┌─ Explore › All Queries › Slow checkout spans ");

    // …and the row under it carries what Escape costs, flush right.
    const row = lines.find((line) => line.includes("(esc)")) ?? "";
    expect(row).toContain("back to All Queries (esc)");
    expect(row.replace(/[│ ]+$/, "")).toEndWith("(esc)");
    expect(lines.indexOf(border)).toBeLessThan(lines.indexOf(row));

    // …and the status bar agrees, which it used not to for a view like this.
    expect(frame).toContain("back");
  } finally {
    await h.cleanup();
  }
});

test("the back control is trimmed rather than overrunning a narrow pane", async () => {
  // Rendered directly: a pane this narrow only happens in a terminal too small
  // to drive the app through, but the control still must not paint over the
  // border beside it.
  const h = await renderHarness(<DetailBackRow parent="All Dashboards" width={20} />, {
    width: 20,
    height: 1,
  });
  try {
    const row = h.frame().split("\n")[0] ?? "";
    expect(row).toContain("…");
    expect(row).toContain("(esc)");
    expect(row.length).toBeLessThanOrEqual(20);
  } finally {
    await h.cleanup();
  }
});

test("a screen at the top level has no trail and no back control", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    const frame = h.frame();
    expect(frame).not.toContain("back to");
    expect(frame).not.toContain("Issues › Feed ›");
    // Quit keeps its place in the hint row while there is nowhere to go back to.
    expect(frame).toContain("quit");
  } finally {
    await h.cleanup();
  }
});

test("the hint row sheds quit rather than outgrowing a narrow terminal", async () => {
  const h = await openIssueDetail();
  try {
    // `.at(-2)`: the captured frame ends with a trailing newline.
    const bar = h.frame().split("\n").at(-2) ?? "";
    expect(bar).toContain("back");
    expect(bar).not.toContain("quit");
  } finally {
    await h.cleanup();
  }
});

test("the trail sheds its ancestors rather than overrunning a narrow pane", async () => {
  const h = await renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
    width: 60,
    height: 20,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("back to Feed"));

    for (const line of h.frame().split("\n").filter(Boolean)) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
    // The leaf is the segment worth the cells: it says *which* issue this is.
    expect(h.frame()).toContain("PUMP-STATION-1");
  } finally {
    await h.cleanup();
  }
});
