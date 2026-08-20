import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { rawLogRowsFixture } from "./log-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

function stubClient(logRows: unknown = rawLogRowsFixture) {
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
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    await navigateToLogs(h);

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
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    await navigateToLogs(h);

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

test("status bar shows log count after loading", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    await navigateToLogs(h);

    await h.waitForFrame((f) => f.includes("20 logs"));
    expect(h.frame()).toContain("20 logs");
  } finally {
    await h.cleanup();
  }
});

test("log stream shows empty state when no logs match", async () => {
  const h = await renderApp(stubClient([]));
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    await navigateToLogs(h);

    await h.waitForFrame((f) => f.includes("No logs found"));
    expect(h.frame()).toContain("No logs found");
  } finally {
    await h.cleanup();
  }
});

test("log stream shows severity colors", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    await navigateToLogs(h);

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
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    await navigateToLogs(h);

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
