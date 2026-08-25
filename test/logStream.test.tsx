import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { logTimeseriesFixture, rawLogRowsFixture } from "./log-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

function stubClient(
  logRows: unknown = rawLogRowsFixture,
  timeseries: unknown = logTimeseriesFixture,
) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    // Issues endpoints return empty data (we navigate away from issues).
    if (url.includes("issues-stats")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/issues/")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Log volume timeseries via events-stats endpoint.
    if (url.includes("/events-stats/") && url.includes("dataset=logs")) {
      return new Response(JSON.stringify({ data: timeseries }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Logs via Discover events endpoint with dataset=logs.
    if (url.includes("/events/") && url.includes("dataset=logs")) {
      return new Response(JSON.stringify({ data: logRows }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

/** Navigate to Explore > Logs. */
async function navigateToLogs(h: Awaited<ReturnType<typeof renderHarness>>) {
  // Expand and focus the compact nav rail first.
  await h.openNav();
  // Move rail cursor to Explore (j once from Issues).
  await h.press((i) => i.pressKey("j"));
  // Open secondary nav.
  await h.press((i) => i.pressEnter());
  // Logs is the second item in Explore > [Traces, Logs, …].
  await h.press((i) => i.pressKey("j"));
  // Select Logs.
  await h.press((i) => i.pressEnter());
}

async function renderApp(client: SentryClient | null = stubClient()) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

/**
 * Mount straight onto the log stream.
 *
 * Walking the rail costs a render pass per keystroke; only the routing test
 * below does it, and the rest start where they mean to test.
 */
async function renderLogs(client: SentryClient | null = stubClient()) {
  return renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen="explore.logs" />,
    { width: WIDTH, height: HEIGHT },
  );
}

test("navigating to Explore > Logs shows the log stream", async () => {
  const h = await renderApp();
  try {
    // Wait for initial issues view to load.
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));

    await navigateToLogs(h);

    await h.waitForFrame((f) => f.includes("Search logs"));
    const frame = h.frame();
    expect(frame).toContain("Search logs");
    // Column headers.
    expect(frame).toContain("Time");
    expect(frame).toContain("Level");
    expect(frame).toContain("Message");
  } finally {
    await h.cleanup();
  }
});

test("log entries are rendered with severity and message", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));
    const frame = h.frame();
    expect(frame).toContain("card declined");
    expect(frame).toContain("ERROR");
    expect(frame).toContain("billing");
  } finally {
    await h.cleanup();
  }
});

test("j and k navigate log entries", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    // Focus is already on content after selecting from secondary nav.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));

    // Selection moved, frame still shows log entries.
    const frame = h.frame();
    expect(frame).toContain("card declined");
    expect(frame).toContain("Rate limit");
  } finally {
    await h.cleanup();
  }
});

test("the log list scrolls to follow the cursor past the bottom of the viewport", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    // 20 fixture rows against a pane shortened by the volume chart, so the
    // tail of the list starts off screen.
    expect(h.frame()).not.toContain("GET /api/v2/users");

    await h.press((i) => i.pressKey("G", { shift: true }));
    await h.waitForFrame((f) => f.includes("GET /api/v2/users"));
    expect(h.frame()).not.toContain("card declined"); // the top scrolled away

    await h.press((i) => i.pressKey("g"));
    await h.waitForFrame((f) => f.includes("card declined"));
    expect(h.frame()).not.toContain("GET /api/v2/users");
  } finally {
    await h.cleanup();
  }
});

test("the footer shows the log count after loading", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("20 logs"));
    expect(h.frame()).toContain("20 logs");
  } finally {
    await h.cleanup();
  }
});

test("log stream shows empty state when no logs match", async () => {
  const h = await renderLogs(stubClient([]));
  try {
    await h.waitForFrame((f) => f.includes("No logs found"));
    expect(h.frame()).toContain("No logs found");
  } finally {
    await h.cleanup();
  }
});

test("log stream shows severity colors", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));
    const frame = h.frame();
    // Multiple severity levels should be visible.
    expect(frame).toContain("ERROR");
    expect(frame).toContain("WARN");
    expect(frame).toContain("INFO");
  } finally {
    await h.cleanup();
  }
});

test("G and g jump to bottom and top of log list", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    // Jump to bottom.
    await h.press((i) => i.pressKey("G", { shift: true }));
    // Jump back to top.
    await h.press((i) => i.pressKey("g"));

    // Still showing logs, no crash.
    const frame = h.frame();
    expect(frame).toContain("card declined");
  } finally {
    await h.cleanup();
  }
});

test("log volume bar chart is rendered above the log list", async () => {
  const h = await renderLogs();
  try {
    // The chart header "count(logs)" should appear.
    await h.waitForFrame((f) => f.includes("count(logs)"));
    const frame = h.frame();
    expect(frame).toContain("count(logs)");
    // Y-axis should show the zero label.
    expect(frame).toContain("0");
    // Bar characters should be present (Unicode blocks).
    expect(frame).toMatch(/[▁▂▃▄▅▆▇█]/);
  } finally {
    await h.cleanup();
  }
});

test("bar chart is hidden when timeseries data is empty", async () => {
  const h = await renderLogs(stubClient(rawLogRowsFixture, []));
  try {
    // Logs should appear without the chart.
    await h.waitForFrame((f) => f.includes("card declined"));
    const frame = h.frame();
    expect(frame).not.toContain("count(logs)");
    expect(frame).toContain("card declined");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------

test("log stream shows the search bar with placeholder", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("Search logs"));
    const frame = h.frame();
    expect(frame).toContain("Search logs");
    // The / prefix should be visible.
    expect(frame).toContain("/");
  } finally {
    await h.cleanup();
  }
});

test("/ focuses the log search bar and shows submit/cancel hints", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    // Press / to focus the search bar.
    await h.press((i) => i.pressKey("/"));

    const frame = h.frame();
    expect(frame).toContain("submit");
    expect(frame).toContain("cancel");
  } finally {
    await h.cleanup();
  }
});

test("Escape reverts log search to the empty query", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    // Focus search and type something.
    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("hello"));

    // Cancel with Escape.
    await h.pressEscape();

    const frame = h.frame();
    // Should revert to placeholder (empty query).
    expect(frame).toContain("Search logs");
    expect(frame).not.toContain("submit");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Filter bar (shared FilterBar component)
// ---------------------------------------------------------------------------

test("log stream shows filter chips for project, env, and period", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    const frame = h.frame();
    expect(frame).toContain("all projects");
    expect(frame).toContain("all envs");
    expect(frame).toContain("1h");
  } finally {
    await h.cleanup();
  }
});

test("D opens the date range selector on the logs view", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    // Press D to open the date dropdown.
    await h.press((i) => i.pressKey("D", { shift: true }));

    const frame = h.frame();
    expect(frame).toContain("Date Range");
    // Should list date options.
    expect(frame).toContain("1 hour");
    expect(frame).toContain("24 hours");
  } finally {
    await h.cleanup();
  }
});

test("enter opens a detail panel for the selected log", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    expect(h.frame()).not.toContain("Log Details");

    await h.press((i) => i.pressEnter());

    const frame = h.frame();
    expect(frame).toContain("Log Details");
    // The first fixture row: severity, project and trace all come from it.
    expect(frame).toContain("Severity: error");
    expect(frame).toContain("Project: billing");
    expect(frame).toContain("Trace: abc123def456");
  } finally {
    await h.cleanup();
  }
});

test("the detail panel follows the cursor while it is open", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Severity: error");

    // j still moves the cursor with the panel open, and the panel redraws for
    // the row it lands on — the second fixture row is a warning.
    await h.press((i) => i.pressKey("j"));

    const frame = h.frame();
    expect(frame).toContain("Log Details");
    expect(frame).toContain("Severity: warn");
    expect(frame).not.toContain("Severity: error");
  } finally {
    await h.cleanup();
  }
});

test("enter again and escape both close the detail panel", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Log Details");

    // Enter toggles.
    await h.press((i) => i.pressEnter());
    expect(h.frame()).not.toContain("Log Details");

    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Log Details");

    // So does escape.
    await h.pressEscape();
    expect(h.frame()).not.toContain("Log Details");
    // Closing the panel must not also pop the whole view.
    expect(h.frame()).toContain("card declined");
  } finally {
    await h.cleanup();
  }
});

test("the status bar names what enter will do to the detail panel", async () => {
  const h = await renderLogs();
  try {
    await h.waitForFrame((f) => f.includes("card declined"));

    expect(h.frame()).toContain("details");

    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("close");
  } finally {
    await h.cleanup();
  }
});
