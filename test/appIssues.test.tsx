import { expect, test } from "bun:test";

import type { TestRendererSetup } from "@opentui/core/testing";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { groupFixture, groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

type MockInput = TestRendererSetup["mockInput"];

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

function stubClient(body: unknown = groupsFixture) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const payload = String(input).includes("issues-stats") ? {} : body;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

async function renderApp(client: SentryClient | null = stubClient()) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

test("issue stream is the default view and lists issues", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    const frame = h.frame();
    expect(frame).toContain("TypeError");
    expect(frame).toContain("ValueError");
    expect(frame).toContain("PUMP-STATION-1");
  } finally {
    await h.cleanup();
  }
});

test("phase-two counts reach the list even though the App owns the rows", async () => {
  let releaseStats!: () => void;
  const statsGate = new Promise<void>((r) => (releaseStats = r));

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("issues-stats")) {
      await statsGate;
      return new Response(JSON.stringify([{ id: "1", count: "4321", userCount: 77 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const list = groupsFixture.map(({ count: _c, userCount: _u, stats: _s, ...rest }) => rest);
    return new Response(JSON.stringify(list), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const h = await renderApp(new SentryClient({ auth, fetchImpl }));
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    expect(h.frame()).toContain("··");

    await h.press(() => releaseStats());
    await h.waitForFrame((f) => f.includes("4.3k"));
    expect(h.frame()).toContain("4.3k");
  } finally {
    await h.cleanup();
  }
});

test("status bar is blank once issues settle", async () => {
  const h = await renderApp();
  try {
    // Wait for the stream to finish loading so the status bar is idle.
    await h.waitForFrame((f) => f.includes("TypeError"));
    const frame = h.frame();
    // No issue count, no org slug — just the key hints on the right.
    expect(frame).not.toMatch(/\d+ issues/);
    expect(frame).not.toContain("Ready");
  } finally {
    await h.cleanup();
  }
});

test("j and k move the selection cursor within the list", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    // Content pane has focus by default.

    const rowOf = (frame: string, needle: string) =>
      frame.split("\n").findIndex((line) => line.includes(needle));

    const first = h.frame();
    expect(first.split("\n")[rowOf(first, "TypeError")]).toContain("▸");

    await h.press((i) => i.pressKey("j"));
    const second = h.frame();
    expect(second.split("\n")[rowOf(second, "ValueError")]).toContain("▸");
    expect(second.split("\n")[rowOf(second, "TypeError")]).not.toContain("▸");

    await h.press((i) => i.pressKey("k"));
    const back = h.frame();
    expect(back.split("\n")[rowOf(back, "TypeError")]).toContain("▸");
  } finally {
    await h.cleanup();
  }
});

test("G and g jump to the last and first rows", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    // Content pane has focus by default.

    await h.press((i) => i.pressKey("G", { shift: true }));
    const bottom = h.frame();
    const lastRow = bottom.split("\n").findIndex((line) => line.includes("Slow database query"));
    expect(bottom.split("\n")[lastRow]).toContain("▸");

    await h.press((i) => i.pressKey("g"));
    const top = h.frame();
    const firstRow = top.split("\n").findIndex((line) => line.includes("TypeError"));
    expect(top.split("\n")[firstRow]).toContain("▸");
  } finally {
    await h.cleanup();
  }
});

/** More rows than fit on screen, each with a title that identifies its index. */
const longList = Array.from({ length: 24 }, (_, i) => ({
  ...groupFixture,
  id: String(i + 1),
  shortId: `PUMP-STATION-${i + 1}`,
  metadata: { type: `RowError${i}`, value: `row ${i} failed` },
}));

test("the list scrolls to follow the cursor past the bottom of the viewport", async () => {
  const h = await renderApp(stubClient(longList));
  try {
    await h.waitForFrame((f) => f.includes("RowError0"));
    // The list is taller than the pane, so the tail starts off screen.
    expect(h.frame()).not.toContain("RowError23");

    await h.press((i) => i.pressKey("G", { shift: true }));
    await h.waitForFrame((f) => f.includes("RowError23"));

    const bottom = h.frame();
    const lastRow = bottom.split("\n").findIndex((line) => line.includes("RowError23"));
    expect(bottom.split("\n")[lastRow]).toContain("▸"); // cursor is on screen, not just the row
    expect(bottom).not.toContain("RowError0"); // the top scrolled away

    // And back up: the cursor pulls the viewport with it in both directions.
    await h.press((i) => i.pressKey("g"));
    await h.waitForFrame((f) => f.includes("RowError0"));
    expect(h.frame()).not.toContain("RowError23");
  } finally {
    await h.cleanup();
  }
});

test("moving within the visible rows does not scroll the list", async () => {
  const h = await renderApp(stubClient(longList));
  try {
    await h.waitForFrame((f) => f.includes("RowError0"));

    // Three rows down is still on screen, so the viewport must stay put rather
    // than re-centering the list under the cursor.
    for (let i = 0; i < 3; i++) await h.press((k) => k.pressKey("j"));

    const frame = h.frame();
    const rowOf = (needle: string) => frame.split("\n").findIndex((line) => line.includes(needle));
    expect(frame).toContain("RowError0"); // top of the list never moved
    expect(frame.split("\n")[rowOf("RowError3")]).toContain("▸");
  } finally {
    await h.cleanup();
  }
});

test("selecting a different nav group via secondary nav shows its content", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    // Tab to the nav rail, then move to Explore.
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressKey("j"));
    // Open secondary nav on Explore.
    await h.press((i) => i.pressEnter());
    // Select first Explore item (Traces).
    await h.press((i) => i.pressEnter());

    const frame = h.frame();
    expect(frame).toContain("Explore");
    expect(frame).toContain("Not implemented yet.");
    expect(frame).not.toContain("TypeError");
  } finally {
    await h.cleanup();
  }
});

test("selection survives a reload of the same list", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    // Content pane has focus by default.
    await h.press((i) => i.pressKey("j")); // select row 2

    const before = h.frame();
    const valueErrorRow = before.split("\n").findIndex((l) => l.includes("ValueError"));
    expect(before.split("\n")[valueErrorRow]).toContain("▸");

    await h.press((i) => i.pressKey("R", { shift: true }));
    await h.waitForFrame((f) => f.includes("ValueError"));

    const after = h.frame();
    const row = after.split("\n").findIndex((l) => l.includes("ValueError"));
    expect(after.split("\n")[row]).toContain("▸");
  } finally {
    await h.cleanup();
  }
});

/** A client whose issue list changes between fetches, so a refetch is visible. */
function reloadingClient(pages: unknown[]) {
  let listCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    // Only the list endpoint advances the page: the filter bar's project and
    // environment lookups share this stub and would otherwise consume a page.
    const isList = url.includes("/issues/") && !url.includes("issues-stats");
    const payload = isList
      ? (pages[Math.min(listCalls++, pages.length - 1)] ?? [])
      : url.includes("issues-stats")
        ? {}
        : [];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

const renamed = [{ ...groupFixture, metadata: { type: "FreshError", value: "after reload" } }];

test.each([
  ["ctrl+r", (i: MockInput) => i.pressKey("r", { ctrl: true })],
  ["R", (i: MockInput) => i.pressKey("R", { shift: true })],
])("%s refetches the issue list", async (_label, pressRefresh) => {
  const h = await renderApp(reloadingClient([groupsFixture, renamed]));
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    await h.press(pressRefresh);
    await h.waitForFrame((f) => f.includes("FreshError"));
    expect(h.frame()).toContain("FreshError");
  } finally {
    await h.cleanup();
  }
});

test("ctrl+r refetches the open issue's event", async () => {
  let eventCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/events/")) {
      eventCalls += 1;
      return new Response(JSON.stringify({ id: "e1", entries: [], tags: [], contexts: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const payload = url.includes("issues-stats") ? {} : groupsFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const h = await renderApp(new SentryClient({ auth, fetchImpl }));
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await h.press((i) => i.pressEnter()); // open the detail view
    await h.waitForFrame(() => eventCalls === 1);

    await h.press((i) => i.pressKey("r", { ctrl: true }));
    await h.waitForFrame(() => eventCalls === 2);
    expect(eventCalls).toBe(2);
  } finally {
    await h.cleanup();
  }
});

test("an empty result set clamps the cursor without crashing", async () => {
  const h = await renderApp(stubClient([]));
  try {
    await h.waitForFrame((f) => f.includes("No issues match"));
    // Content pane has focus by default.
    await h.press((i) => i.pressKey("j"));
    expect(h.frame()).toContain("No issues match");
  } finally {
    await h.cleanup();
  }
});
