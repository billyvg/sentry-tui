import { expect, test } from "bun:test";

import type { TestRendererSetup } from "@opentui/core/testing";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { NAV_RAIL_WIDTH } from "~/ui/components/NavRail";
import { SECONDARY_NAV_WIDTH } from "~/ui/components/SecondaryNav";
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

/** Screen row of the line carrying `needle`, for aiming a click at it. */
const rowOf = (frame: string, needle: string) =>
  frame.split("\n").findIndex((line) => line.includes(needle));

/** The line `needle` sits on, to check whether it wears the cursor. */
const lineWith = (frame: string, needle: string) => frame.split("\n")[rowOf(frame, needle)];

/**
 * A column inside the title, clear of the metric columns — and of both nav
 * panes, so the same aim works whether or not the secondary drawer is open.
 * Derived from the pane widths: a literal starts landing on the drawer's border
 * the next time either one grows.
 */
const ROW_CLICK_X = NAV_RAIL_WIDTH + SECONDARY_NAV_WIDTH + 4;

test("clicking a row moves the selection cursor to it", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    expect(lineWith(h.frame(), "TypeError")).toContain("▸");

    await h.click(ROW_CLICK_X, rowOf(h.frame(), "ValueError"));

    const frame = h.frame();
    expect(lineWith(frame, "ValueError")).toContain("▸");
    expect(lineWith(frame, "TypeError")).not.toContain("▸");
    // One click only selects — the list is still what's on screen.
    expect(frame).toContain("Slow database query");
  } finally {
    await h.cleanup();
  }
});

test("clicking the already-selected row opens its detail", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    const row = rowOf(h.frame(), "ValueError");
    await h.click(ROW_CLICK_X, row); // select
    await h.click(ROW_CLICK_X, row); // confirm

    const frame = h.frame();
    expect(frame).toContain("PUMP-STATION-2"); // the detail's own header
    expect(frame).toContain("Stack Trace");
    expect(frame).not.toContain("Slow database query"); // the list is gone
  } finally {
    await h.cleanup();
  }
});

test("clicking a different row re-aims the cursor instead of opening", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    await h.click(ROW_CLICK_X, rowOf(h.frame(), "ValueError"));
    await h.click(ROW_CLICK_X, rowOf(h.frame(), "Slow database query"));

    const frame = h.frame();
    expect(frame).toContain("TypeError"); // still the list, no detail opened
    expect(lineWith(frame, "Slow database query")).toContain("▸");
    expect(lineWith(frame, "ValueError")).not.toContain("▸");
  } finally {
    await h.cleanup();
  }
});

test("a click that focuses the list can only select, never open", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    // Move focus off the list; the cursor stays on row 0 but stops rendering.
    await h.press((i) => i.pressTab());
    expect(h.frame()).not.toContain("▸");

    // Clicking row 0 — the row the cursor is already on — must not count as
    // confirming a cursor the user couldn't see.
    await h.click(ROW_CLICK_X, rowOf(h.frame(), "TypeError"));

    const frame = h.frame();
    expect(frame).toContain("ValueError"); // still the list, not a detail view
    expect(lineWith(frame, "TypeError")).toContain("▸");
  } finally {
    await h.cleanup();
  }
});

test("clicking a row closes the secondary nav drawer", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    // Open the drawer from the rail.
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Inbox");

    await h.click(ROW_CLICK_X, rowOf(h.frame(), "ValueError"));

    const frame = h.frame();
    expect(frame).not.toContain("Inbox"); // drawer closed
    expect(lineWith(frame, "ValueError")).toContain("▸");
  } finally {
    await h.cleanup();
  }
});

test("a row click is inert while the command palette is open", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    const target = rowOf(h.frame(), "ValueError");

    await h.press((i) => i.pressKey("k", { ctrl: true }));
    // Aim at where the row was. The palette's scrim is what's actually there.
    await h.click(ROW_CLICK_X, target);

    // The cursor has not moved and no detail opened: the modal above the list
    // took the click, which is the whole point of the scrim.
    const frame = h.frame();
    expect(lineWith(frame, "TypeError")).toContain("▸");
    expect(frame).not.toContain("Stack Trace");
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

test("clicking a row still hits the right issue once the list has scrolled", async () => {
  const h = await renderApp(stubClient(longList));
  try {
    await h.waitForFrame((f) => f.includes("RowError0"));
    await h.press((i) => i.pressKey("G", { shift: true }));
    await h.waitForFrame((f) => f.includes("RowError23"));

    // A row that is only on screen because the viewport scrolled: the click
    // lands in screen space, so nothing may re-derive its index from the
    // unscrolled list.
    await h.click(ROW_CLICK_X, rowOf(h.frame(), "RowError21"));
    expect(lineWith(h.frame(), "RowError21")).toContain("▸");

    await h.click(ROW_CLICK_X, rowOf(h.frame(), "RowError21"));
    expect(h.frame()).toContain("PUMP-STATION-22"); // its detail, not a neighbour's
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
    // Traces is a screen of its own, so the issue stream is gone entirely.
    expect(frame).toContain("Search spans…");
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
