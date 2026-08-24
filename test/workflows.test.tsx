/**
 * `Monitors › Alerts` — the automations (workflows) list.
 *
 * The screen is deliberately not the legacy alert rules list, so the first
 * test pins the endpoint it reads: getting that wrong is the failure mode the
 * issue was written to prevent.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { renderHarness, type Harness } from "./helpers";
import {
  workflowDetectorsFixture,
  workflowProjectsFixture,
  workflowsFixture,
} from "./workflow-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

/** Index of "Alerts" in the flattened Monitors nav item list. */
const ALERTS_INDEX = 7;
/** Index of the Monitors group in the nav rail, counting from Issues. */
const MONITORS_GROUP_INDEX = 4;

interface StubOptions {
  workflows?: unknown;
  detectors?: unknown;
  projects?: unknown;
  /** Fail the workflows request, for the error state. */
  listStatus?: number;
  /** Every URL the client asked for, in order. */
  calls?: string[];
}

function stubClient({
  workflows = workflowsFixture,
  detectors = workflowDetectorsFixture,
  projects = workflowProjectsFixture,
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
    if (url.includes("/workflows/")) {
      if (listStatus !== 200) return json({ detail: "nope" }, listStatus);
      return json(workflows);
    }
    if (url.includes("/detectors/")) {
      // The lookup asks for exactly the ids it needs; answer with those.
      const wanted = new Set(new URL(url).searchParams.getAll("id"));
      const all = detectors as Array<{ id: string }>;
      return json(Array.isArray(all) ? all.filter((d) => wanted.has(d.id)) : all);
    }
    if (url.includes("/projects/")) return json(projects);
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

/** Mount straight onto the screen, skipping the rail walk. */
async function renderAlerts(client: SentryClient | null = stubClient(), width = WIDTH) {
  return renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen="monitors.alerts" />,
    { width, height: HEIGHT },
  );
}

/** Walk the nav rail to Monitors › Alerts, the way a user gets there. */
async function navigateToAlerts(h: Harness) {
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await h.press((i) => i.pressTab());
  for (let n = 0; n < MONITORS_GROUP_INDEX; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  for (let n = 0; n < ALERTS_INDEX; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test("Alerts reads the workflows endpoint, not the legacy alert rules", async () => {
  const calls: string[] = [];
  const h = await renderAlerts(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));

    expect(calls.some((url) => url.includes("/organizations/acme/workflows/"))).toBe(true);
    expect(calls.some((url) => url.includes("/alert-rules/"))).toBe(false);
    expect(calls.some((url) => url.includes("/combined-rules/"))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

test("the nav rail routes Monitors › Alerts to the workflows list", async () => {
  const h = await renderAlerts(stubClient());
  await h.cleanup();

  const walked = await renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await navigateToAlerts(walked);
    await walked.waitForFrame((f) => f.includes("Page on-call"));
    // The placeholder pane is what an unregistered screen renders.
    expect(walked.frame()).not.toContain("Coming soon");
  } finally {
    await walked.cleanup();
  }
});

test("the table shows the web's columns and one row per workflow", async () => {
  const h = await renderAlerts();
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));

    const frame = h.frame();
    expect(frame).toContain("Name");
    expect(frame).toContain("Last Triggered");
    expect(frame).toContain("Actions");
    expect(frame).toContain("Projects");
    expect(frame).toContain("Monitors");

    expect(frame).toContain("Page on-call for checkout");
    expect(frame).toContain("Archive noisy warnings");
    expect(frame).toContain("Jira ticket per new issue");
    expect(frame).toContain("3 alerts");
  } finally {
    await h.cleanup();
  }
});

test("the Actions cell names the distinct integrations, deduplicated", async () => {
  const h = await renderAlerts();
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));

    const frame = h.frame();
    // Two Slack actions and one email on the first workflow: one entry each.
    expect(frame).toContain("Slack, Email");
    expect(frame).toContain("JIRA");
  } finally {
    await h.cleanup();
  }
});

test("the Monitors cell counts connected detectors, agreeing in number", async () => {
  const h = await renderAlerts();
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));

    const frame = h.frame();
    expect(frame).toContain("2 monitors");
    expect(frame).toContain("1 monitor ");
  } finally {
    await h.cleanup();
  }
});

test("the Projects cell resolves connected detectors to project slugs", async () => {
  const calls: string[] = [];
  const h = await renderAlerts(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("backend"));

    const frame = h.frame();
    expect(frame).toContain("backend, frontend");
    // A workflow on the org-wide detector covers every project and says so
    // rather than listing them.
    expect(frame).toContain("All Projects");

    // One detector request, carrying exactly the ids the rows reference.
    const detectorCalls = calls.filter((url) => url.includes("/detectors/"));
    expect(detectorCalls).toHaveLength(1);
    const ids = new URL(detectorCalls[0]!).searchParams.getAll("id");
    expect(ids.sort()).toEqual(["501", "502", "900"]);
  } finally {
    await h.cleanup();
  }
});

test("a workflow with nothing connected shows an em dash, not a zero", async () => {
  const h = await renderAlerts();
  try {
    await h.waitForFrame((f) => f.includes("Archive noisy"));
    // The disabled fixture has no actions, no detectors, and has never fired.
    expect(h.frame()).toContain("—");
    expect(h.frame()).not.toContain("0 monitors");
  } finally {
    await h.cleanup();
  }
});

test("a disabled workflow's name is faded rather than accented", async () => {
  const h = await renderAlerts();
  try {
    await h.waitForFrame((f) => f.includes("Archive noisy"));

    const disabled = h.spanContaining("Archive noisy warnings");
    const enabled = h.spanContaining("Jira ticket per new issue");
    // The row count line is drawn in `theme.subText` — the faded token — so
    // it is what "faded" is compared against without restating a hex value.
    const faded = h.spanContaining("3 alerts");
    expect(disabled?.fg).toEqual(faded?.fg);
    expect(enabled?.fg).not.toEqual(faded?.fg);
  } finally {
    await h.cleanup();
  }
});

test("the list is read-only: no key on it writes", async () => {
  const calls: string[] = [];
  const h = await renderAlerts(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));

    const before = h.frame();
    // Enter has nothing to open, and neither of the web's row actions exists.
    await h.press((i) => i.pressEnter());
    await h.press((i) => i.pressKey("e"));
    await h.press((i) => i.pressKey("d"));
    expect(h.frame()).toBe(before);
    expect(calls.every((url) => url.includes("/organizations/acme/"))).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("j and k move the cursor through the alerts", async () => {
  const h = await renderAlerts();
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));

    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));

    const frame = h.frame();
    expect(frame).toContain("Page on-call for checkout");
    expect(frame).toContain("Jira ticket per new issue");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Search, empty, error
// ---------------------------------------------------------------------------

test("the search box sends its committed query to the endpoint", async () => {
  const calls: string[] = [];
  const h = await renderAlerts(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.typeText("jira"));
    // Nothing is requested while the query is still being typed.
    expect(calls.some((url) => url.includes("query=jira"))).toBe(false);

    await h.press((i) => i.pressEnter());
    await h.waitForFrame(() => calls.some((url) => url.includes("query=jira")));
    expect(calls.some((url) => url.includes("query=jira"))).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("an empty list names the feature rather than saying 'no results'", async () => {
  const h = await renderAlerts(stubClient({ workflows: [] }));
  try {
    await h.waitForFrame((f) => f.includes("No alerts found"));

    const frame = h.frame();
    expect(frame).toContain("automations that run when a monitor fires");
    expect(frame).toContain("may not have the new alerts and monitors enabled");
  } finally {
    await h.cleanup();
  }
});

test("a search that matched nothing blames the query, not the feature flag", async () => {
  const h = await renderAlerts(stubClient({ workflows: [] }));
  try {
    await h.waitForFrame((f) => f.includes("No alerts found"));

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.typeText("nope"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes('matches "nope"'));

    expect(h.frame()).not.toContain("may not have the new alerts and monitors enabled");
  } finally {
    await h.cleanup();
  }
});

test("a failed list request shows the error state", async () => {
  const h = await renderAlerts(stubClient({ listStatus: 500 }));
  try {
    await h.waitForFrame((f) => f.includes("Failed to load alerts"));
    expect(h.frame()).toContain("Failed to load alerts");
  } finally {
    await h.cleanup();
  }
});

test("a failed detector lookup costs the Projects column, not the list", async () => {
  const failing = new SentryClient({
    auth,
    maxRetries: 0,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.includes("/workflows/")) return json(workflowsFixture);
      if (url.includes("/detectors/")) return json({ detail: "nope" }, 500);
      if (url.includes("/projects/")) return json(workflowProjectsFixture);
      return json([]);
    }) as unknown as typeof fetch,
  });

  const h = await renderAlerts(failing);
  try {
    await h.waitForFrame((f) => f.includes("Page on-call"));
    expect(h.frame()).not.toContain("Failed to load alerts");
    // The rest of the row is intact; only the projects are unknown.
    expect(h.frame()).toContain("2 monitors");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Loading geometry
// ---------------------------------------------------------------------------

test("the skeleton holds the table's geometry while the list is in flight", async () => {
  const pending = new SentryClient({
    auth,
    maxRetries: 0,
    fetchImpl: (async (input: RequestInfo | URL) => {
      if (String(input).includes("/workflows/")) return new Promise<Response>(() => {});
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  const h = await renderAlerts(pending);
  try {
    await h.waitForFrame((f) => f.includes("Last Triggered"));

    const frame = h.frame();
    // The heading and header row are already in their final positions, and
    // neither the empty nor the error state has claimed the pane.
    expect(frame).toContain("Alerts");
    expect(frame).toContain("Last Triggered");
    expect(frame).not.toContain("No alerts found");
    expect(frame).not.toContain("Failed to load alerts");
    // Skeleton rows, drawn from the same resolved columns as a real row.
    expect(frame).toContain("─");
    expect(frame.split("\n").filter(Boolean)).toHaveLength(HEIGHT);
  } finally {
    await h.cleanup();
  }
});

test("the header sits at the same offsets in the skeleton as under real rows", async () => {
  const headerOf = (frame: string) => frame.split("\n").find((line) => line.includes("Name"))!;

  const pending = new SentryClient({
    auth,
    maxRetries: 0,
    fetchImpl: (async (input: RequestInfo | URL) => {
      if (String(input).includes("/workflows/")) return new Promise<Response>(() => {});
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
  });

  const loading = await renderAlerts(pending);
  let skeletonHeader: string;
  try {
    await loading.waitForFrame((f) => f.includes("Last Triggered"));
    skeletonHeader = headerOf(loading.frame());
  } finally {
    await loading.cleanup();
  }

  const settled = await renderAlerts();
  try {
    await settled.waitForFrame((f) => f.includes("Page on-call"));
    expect(headerOf(settled.frame())).toBe(skeletonHeader);
  } finally {
    await settled.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Narrow terminals
// ---------------------------------------------------------------------------

/**
 * Column shedding at the three widths the plan calls out.
 *
 * `layoutColumns` guarantees the arithmetic; what this pins is the *order* —
 * the web's container queries add Projects first and Monitors last
 * (`automationListTable/index.tsx:227-274`), so they come off in the reverse
 * order, and the name survives every width.
 */
for (const { width, kept, shed } of [
  { width: 80, kept: ["Name", "Projects"], shed: ["Monitors", "Last Triggered", "Actions"] },
  {
    width: 100,
    // The nav rail and its filter chips shed 2 cells apiece when their keys
    // stopped wearing parens, so 100 columns now has room for one more
    // column than it used to.
    kept: ["Name", "Projects", "Actions", "Last Triggered"],
    shed: ["Monitors"],
  },
  {
    width: 140,
    kept: ["Name", "Projects", "Actions", "Last Triggered", "Monitors"],
    shed: [],
  },
]) {
  test(`the alerts table sheds columns and never wraps at ${width} columns`, async () => {
    const h = await renderAlerts(stubClient(), width);
    try {
      await h.waitForFrame((f) => f.includes("Page on-call"));

      const lines = h.frame().split("\n").filter(Boolean);
      // A row that overflowed its pane would push the frame wider; one that
      // wrapped would add a line the layout never budgeted for.
      expect(lines).toHaveLength(HEIGHT);
      expect([...new Set(lines.map((line) => line.length))]).toEqual([width]);

      const header = h
        .frame()
        .split("\n")
        .find((line) => line.includes("Name"))!;
      for (const label of kept) expect(header).toContain(label);
      for (const label of shed) expect(header).not.toContain(label);
      // The name is what identifies a row, so it is never shed away.
      expect(h.frame()).toContain("Page on-call");
    } finally {
      await h.cleanup();
    }
  });
}

/**
 * `P` / `E` / `D` must not be able to wedge the keyboard.
 *
 * The router opens a filter dropdown for any list screen, and only a mounted
 * `Dropdown` closes one. This screen renders no filter row, so it closes the
 * dropdown itself — see the effect in `WorkflowList`.
 */
for (const key of ["P", "E", "D"]) {
  test(`${key} is a no-op on the alerts list, not a keyboard lock`, async () => {
    const h = await renderAlerts();
    try {
      await h.waitForFrame((f) => f.includes("Page on-call"));

      await h.press((i) => i.pressKey(key, { shift: true }));
      expect(h.frame()).not.toContain("Date Range");

      await h.press((i) => i.pressKey("?", { shift: true }));
      expect(h.frame()).toContain("Keyboard");
    } finally {
      await h.cleanup();
    }
  });
}
