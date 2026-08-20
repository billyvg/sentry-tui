import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { groupsFixture } from "./fixtures";
import { renderHarness, type Harness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 34;

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

async function renderApp(onQuit: () => void = () => {}) {
  const h = await renderHarness(<App onQuit={onQuit} client={stubClient()} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  await h.waitForFrame((f) => f.includes("TypeError"));
  return h;
}

/** Open the palette the way a user does. */
const openPalette = (h: Harness) => h.press((i) => i.pressKey("k", { ctrl: true }));

test("ctrl+k opens the palette, escape closes it", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    expect(h.frame()).toContain("Command palette");

    await h.pressEscape();
    expect(h.frame()).not.toContain("Command palette");
  } finally {
    await h.cleanup();
  }
});

test("ctrl+k toggles the palette shut again", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await openPalette(h);
    expect(h.frame()).not.toContain("Command palette");
  } finally {
    await h.cleanup();
  }
});

test("an unfiltered palette lists destinations and commands", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    const frame = h.frame();
    expect(frame).toContain("Go to");
    expect(frame).toContain("Feed");
    expect(frame).toContain("↑↓ move");
  } finally {
    await h.cleanup();
  }
});

test("typing filters the list down to the match", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("logs"));

    const frame = h.frame();
    expect(frame).toContain("Logs");
    // Not a subsequence of "logs", so the rest of Issues is gone. "Feed" would
    // be the obvious thing to check, but it doubles as the active view's
    // header behind the palette — these appear nowhere but the palette list.
    expect(frame).not.toContain("Warnings");
    expect(frame).not.toContain("All Views");
  } finally {
    await h.cleanup();
  }
});

test("j and k type into the query rather than moving the cursor", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("jk"));
    // No destination contains "jk" as a subsequence.
    expect(h.frame()).toContain('No matches for "jk"');
  } finally {
    await h.cleanup();
  }
});

test("enter on a filtered destination navigates the content pane", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("all monitors"));
    await h.press((i) => i.pressKey("\r"));

    const frame = h.frame();
    expect(frame).not.toContain("Command palette");
    expect(frame).toContain("Monitors › All Monitors");
  } finally {
    await h.cleanup();
  }
});

test("the arrow keys move the cursor between results", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    // The catalog opens on the first destination, and `▸` marks the cursor.
    expect(h.frame()).toContain("▸ Feed");

    await h.press((i) => i.pressArrow("down"));
    expect(h.frame()).toContain("▸ Inbox");

    await h.press((i) => i.pressArrow("up"));
    expect(h.frame()).toContain("▸ Feed");

    // Up at the top of the list is a no-op rather than a wrap.
    await h.press((i) => i.pressArrow("up"));
    expect(h.frame()).toContain("▸ Feed");
  } finally {
    await h.cleanup();
  }
});

test("enter runs whichever row the cursor moved to", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("dashboards"));
    // Both Dashboards destinations match; walk to the one that is not first.
    const first = h.frame().includes("▸ All Dashboards") ? "Sentry Built" : "All Dashboards";
    await h.press((i) => i.pressArrow("down"));
    expect(h.frame()).toContain(`▸ ${first}`);

    await h.press((i) => i.pressKey("\r"));
    expect(h.frame()).toContain(`Dashboards › ${first}`);
  } finally {
    await h.cleanup();
  }
});

test("running a command from the palette invokes it", async () => {
  let quit = false;
  const h = await renderApp(() => {
    quit = true;
  });
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("quit"));
    await h.press((i) => i.pressKey("\r"));
    expect(quit).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("selecting Help from the palette opens the help overlay", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("help"));
    await h.press((i) => i.pressKey("\r"));

    const frame = h.frame();
    expect(frame).not.toContain("Command palette");
    expect(frame).toContain("Keyboard shortcuts");
  } finally {
    await h.cleanup();
  }
});

test("triage actions are offered on the issue stream and act on the cursor row", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("resolve"));
    expect(h.frame()).toContain("Issue");

    await h.press((i) => i.pressKey("\r"));
    // The optimistic write lands before the stubbed PUT resolves.
    await h.waitForFrame((f) => f.includes("resolved"));
  } finally {
    await h.cleanup();
  }
});

test("a flood of weak matches cannot bury a strong one in another section", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    // "re" is a subsequence of "Explore", so every Explore destination matches
    // on its group; without the per-section cap they push "Resolve" off screen.
    await h.press((i) => i.pressKey("re"));

    const frame = h.frame();
    expect(frame).toContain("Resolve");
    expect(frame).toContain("more — keep typing");
  } finally {
    await h.cleanup();
  }
});

test("the palette closes without acting when nothing matches", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.press((i) => i.pressKey("zzzzq"));
    expect(h.frame()).toContain("No matches");

    await h.press((i) => i.pressKey("\r"));
    // Enter on an empty list is inert; the palette stays put.
    expect(h.frame()).toContain("Command palette");
  } finally {
    await h.cleanup();
  }
});

test("the app takes keys again after the palette closes", async () => {
  const h = await renderApp();
  try {
    await openPalette(h);
    await h.pressEscape();

    // `/` is an app binding, not text — it must reach the search handler.
    await h.press((i) => i.pressKey("/"));
    expect(h.frame()).toContain("submit");
  } finally {
    await h.cleanup();
  }
});

test("ctrl+k opens the palette while the search box has focus", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("/"));
    expect(h.frame()).toContain("submit");

    await openPalette(h);
    const frame = h.frame();
    expect(frame).toContain("Command palette");
    // Opening the palette abandoned the edit, same as cancelling it.
    expect(frame).not.toContain("submit");
  } finally {
    await h.cleanup();
  }
});

test("the status bar advertises the palette", async () => {
  const h = await renderApp();
  try {
    expect(h.frame()).toContain("commands");
  } finally {
    await h.cleanup();
  }
});
