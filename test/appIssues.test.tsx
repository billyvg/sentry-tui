import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
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

test("status bar reports the settled issue count", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("3 issues"));
    expect(h.frame()).toContain("3 issues");
  } finally {
    await h.cleanup();
  }
});

test("j and k move the selection cursor within the list", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    // Focus the content pane: nav -> secondary -> content.
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressTab());

    const rowOf = (frame: string, needle: string) =>
      frame.split("\n").findIndex((line) => line.includes(needle));

    // The cursor marker sits on the first row initially.
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
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressTab());

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

test("switching away from Issues shows an honest stub", async () => {
  const h = await renderApp();
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    // Rail has focus by default; move to Explore.
    await h.press((i) => i.pressKey("j"));

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
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressTab());
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

test("an empty result set clamps the cursor without crashing", async () => {
  const h = await renderApp(stubClient([]));
  try {
    await h.waitForFrame((f) => f.includes("No issues match"));
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressKey("j"));
    expect(h.frame()).toContain("No issues match");
  } finally {
    await h.cleanup();
  }
});
