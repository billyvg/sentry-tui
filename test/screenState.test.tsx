import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

function stubClient() {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.includes("issues-stats")
      ? {}
      : url.includes("/events-stats/") || url.includes("/events/")
        ? { data: [] }
        : groupsFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

const renderApp = () =>
  renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });

/** Jump straight to a destination through the command palette. */
async function goTo(h: Awaited<ReturnType<typeof renderApp>>, destination: string) {
  await h.press((i) => i.pressKey("k", { ctrl: true }));
  await h.press((i) => i.pressKey(destination));
  await h.press((i) => i.pressKey("\r"));
}

test("a screen's query and cursor survive a round trip through another section", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    // Move the cursor off the first row, then commit a query of our own.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("a", { meta: true }));
    await h.press((i) => i.pressKey("is:unresolved marker"));
    await h.press((i) => i.pressKey("\r"));
    expect(h.frame()).toContain("is:unresolved marker");

    await goTo(h, "Traces");
    await h.waitForFrame((f) => f.includes("Not implemented yet."));
    expect(h.frame()).not.toContain("is:unresolved marker");

    await goTo(h, "Feed");
    await h.waitForFrame((f) => f.includes("TypeError"));

    // The query is still committed, and the cursor is still on row two.
    expect(h.frame()).toContain("is:unresolved marker");
    const rows = h.frame().split("\n");
    expect(rows.find((line) => line.includes("ValueError"))).toContain("▸");
  } finally {
    await h.cleanup();
  }
});

test("screens with their own state key do not share filters", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    // Issues opens on 14d; Explore's tables open on their own default of 1h.
    expect(h.frame()).toContain("14d");

    await goTo(h, "Logs");
    await h.waitForFrame((f) => f.includes("Search logs"));
    expect(h.frame()).toContain("1h");
    expect(h.frame()).not.toContain("is:unresolved");

    await goTo(h, "Feed");
    await h.waitForFrame((f) => f.includes("TypeError"));
    expect(h.frame()).toContain("14d");
  } finally {
    await h.cleanup();
  }
});
