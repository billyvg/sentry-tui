import { expect, test } from "bun:test";

import { App } from "~/ui/App";
import { renderHarness } from "./helpers";

const renderApp = (opts?: { width?: number; height?: number }) =>
  renderHarness(<App onQuit={() => {}} />, opts);

test("renders the app shell with nav and status bar", async () => {
  const h = await renderApp();
  try {
    const frame = h.frame();
    expect(frame).toContain("Issues"); // secondary nav header
    expect(frame).toContain("Feed"); // default item
    expect(frame).toContain("Ready"); // status bar notice
    expect(frame).toContain("quit"); // status bar hint
  } finally {
    await h.cleanup();
  }
});

test("? opens the help overlay listing commands by title", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("?"));

    const frame = h.frame();
    expect(frame).toContain("Keyboard shortcuts");
    expect(frame).toContain("Resolve");
    expect(frame).toContain("esc to close");
  } finally {
    await h.cleanup();
  }
});

test("escape closes the help overlay", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("?"));
    expect(h.frame()).toContain("Keyboard shortcuts");

    await h.pressEscape();
    expect(h.frame()).not.toContain("Keyboard shortcuts");
  } finally {
    await h.cleanup();
  }
});

test("navigating the rail switches the secondary nav contents", async () => {
  const h = await renderApp();
  try {
    expect(h.frame()).toContain("Feed");

    // The rail owns focus by default; move down to Explore.
    await h.press((i) => i.pressKey("j"));

    const frame = h.frame();
    expect(frame).toContain("Explore");
    expect(frame).toContain("Traces");
  } finally {
    await h.cleanup();
  }
});

test("tab moves focus from the rail to the secondary nav", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressTab());
    // With the secondary nav focused, j walks items rather than nav groups.
    await h.press((i) => i.pressKey("j"));

    const frame = h.frame();
    expect(frame).toContain("Issues"); // still in the Issues group
    expect(frame).toContain("Inbox");
  } finally {
    await h.cleanup();
  }
});

test("quit callback fires on q", async () => {
  let quit = false;
  const h = await renderHarness(<App onQuit={() => (quit = true)} />);
  try {
    await h.press((i) => i.pressKey("q"));
    expect(quit).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("does not overflow a narrow terminal", async () => {
  const h = await renderApp({ width: 60, height: 20 });
  try {
    for (const line of h.frame().split("\n").filter(Boolean)) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  } finally {
    await h.cleanup();
  }
});
