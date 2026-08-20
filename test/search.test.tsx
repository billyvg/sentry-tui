import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { DEFAULT_QUERY } from "~/api/issues";
import { App } from "~/ui/App";
import { groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

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

test("the search bar shows the default query", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    expect(h.frame()).toContain("is:unresolved");
  } finally {
    await h.cleanup();
  }
});

test("/ focuses the search bar and shows submit/cancel hints", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    // Focus content pane first.
    await h.press((i) => i.pressTab());
    // Press / to focus the search bar.
    await h.press((i) => i.pressKey("/"));

    const frame = h.frame();
    expect(frame).toContain("submit");
    expect(frame).toContain("cancel");
  } finally {
    await h.cleanup();
  }
});

test("typing in the search bar updates the displayed text", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressKey("/"));

    // Select all and type new query.
    await h.press((i) => i.pressKey("a", { meta: true }));
    await h.press((i) => i.pressKey("hello"));

    const frame = h.frame();
    expect(frame).toContain("hello");
  } finally {
    await h.cleanup();
  }
});

test("Escape reverts the search query to the last committed value", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressKey("/"));

    // Type something.
    await h.press((i) => i.pressKey("a", { meta: true }));
    await h.press((i) => i.pressKey("x"));

    // Cancel with Escape — should revert.
    await h.pressEscape();

    const frame = h.frame();
    expect(frame).toContain(DEFAULT_QUERY);
    // The submit/cancel hints should be gone.
    expect(frame).not.toContain("submit");
  } finally {
    await h.cleanup();
  }
});

test("j/k navigation keys do not type into the search bar when it is not focused", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    await h.press((i) => i.pressTab());

    // Press j to move down (should navigate, not type).
    await h.press((i) => i.pressKey("j"));

    const frame = h.frame();
    // The query should still be the default, not "jis:unresolved…"
    expect(frame).toContain(DEFAULT_QUERY);
  } finally {
    await h.cleanup();
  }
});

test("/ search hint appears in the status bar on the issue list", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    expect(h.frame()).toContain("search");
  } finally {
    await h.cleanup();
  }
});
