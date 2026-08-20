import { expect, test } from "bun:test";

import { App } from "~/ui/App";
import { NAV_RAIL_WIDTH } from "~/ui/components/NavRail";
import { renderHarness } from "./helpers";

const renderApp = (opts?: { width?: number; height?: number }) =>
  renderHarness(<App onQuit={() => {}} />, opts);

test("renders the app shell with nav and status bar, content defaults to Issues Feed", async () => {
  const h = await renderApp();
  try {
    const frame = h.frame();
    expect(frame).toContain("is:unresolved"); // issue stream is the default content
    expect(frame).toContain("quit"); // status bar hint
    // Secondary nav is hidden until Enter is pressed on the rail.
    expect(frame).not.toContain("Inbox");
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

test("navigating the rail moves the rail cursor without showing secondary", async () => {
  const h = await renderApp();
  try {
    // Content has focus by default; tab to the nav rail first.
    await h.press((i) => i.pressTab());
    // Move down to Explore.
    await h.press((i) => i.pressKey("j"));

    const frame = h.frame();
    // Secondary nav is still hidden — no Traces visible.
    expect(frame).not.toContain("Traces");
    // Content still shows the issue stream (unchanged by rail cursor).
    expect(frame).toContain("is:unresolved");
  } finally {
    await h.cleanup();
  }
});

test("enter on the rail opens secondary nav and moves focus there", async () => {
  const h = await renderApp();
  try {
    // Content has focus by default; tab to the nav rail first.
    await h.press((i) => i.pressTab());
    // Press Enter on Issues (default rail position).
    await h.press((i) => i.pressEnter());

    const frame = h.frame();
    // Secondary nav is now visible with Items from Issues group.
    expect(frame).toContain("Feed");
    expect(frame).toContain("Inbox");
  } finally {
    await h.cleanup();
  }
});

test("j/k in secondary nav moves items, Enter selects and hides secondary", async () => {
  const h = await renderApp();
  try {
    // Tab to the nav rail, then open secondary nav.
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Feed");

    // Move to Inbox.
    await h.press((i) => i.pressKey("j"));
    expect(h.frame()).toContain("Inbox");

    // Select Inbox — secondary hides, focus moves to content.
    await h.press((i) => i.pressEnter());
    const frame = h.frame();
    expect(frame).not.toContain("Inbox"); // secondary is hidden
  } finally {
    await h.cleanup();
  }
});

test("escape from secondary nav hides it and returns focus to the rail", async () => {
  const h = await renderApp();
  try {
    // Tab to the nav rail, then open secondary nav.
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Inbox");

    await h.pressEscape();
    const frame = h.frame();
    expect(frame).not.toContain("Inbox"); // secondary hidden
  } finally {
    await h.cleanup();
  }
});

// Rail rows start just inside the top border, one per group: Issues on row 1,
// Explore on row 2. Aiming at the last usable column proves the hit area is the
// whole row, not just the label's glyphs.
const EXPLORE_ROW = 2;
// Border and padding each take a column on the right, so the last cell a row
// actually covers is two in from the rail's own right edge.
const RAIL_ROW_RIGHT_EDGE = NAV_RAIL_WIDTH - 3;

/**
 * A column inside the secondary nav, just past the rail's right edge. Derived
 * rather than fixed: the rail's width follows its own content, so a literal
 * here would start clicking the rail the next time a label or key hint grows.
 */
const SECONDARY_ITEM_X = NAV_RAIL_WIDTH + 3;

test("clicking a rail group opens its secondary nav, without tabbing to the rail", async () => {
  const h = await renderApp();
  try {
    await h.click(RAIL_ROW_RIGHT_EDGE, EXPLORE_ROW);

    const frame = h.frame();
    expect(frame).toContain("Traces"); // Explore's secondary list
    expect(frame).toContain("Logs");
    // Selecting hasn't happened yet, so the content pane still shows issues.
    expect(frame).toContain("Last Seen");
  } finally {
    await h.cleanup();
  }
});

test("clicking a secondary nav item selects it and hides the secondary nav", async () => {
  const h = await renderApp();
  try {
    await h.click(RAIL_ROW_RIGHT_EDGE, EXPLORE_ROW);
    // "Logs" is the second item in Explore's first section — see the frame
    // above: header on row 2, rule on row 3, Traces on 4, Logs on 5.
    await h.click(SECONDARY_ITEM_X, 5);

    const frame = h.frame();
    expect(frame).toContain("Search logs…"); // the log stream is now the content
    expect(frame).not.toContain("Traces"); // secondary is hidden
  } finally {
    await h.cleanup();
  }
});

test("tab cycles between nav and content when secondary is hidden", async () => {
  const h = await renderApp();
  try {
    // Tab from nav → content (secondary is hidden).
    await h.press((i) => i.pressTab());
    // Now content is focused; the issue stream is still showing.
    const frame = h.frame();
    expect(frame).toContain("is:unresolved");
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
