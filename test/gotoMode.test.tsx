import { expect, test } from "bun:test";

import { theme } from "~/core/theme";
import { App } from "~/ui/App";
import { renderHarness } from "./helpers";

const renderApp = (opts?: { width?: number; height?: number }) =>
  renderHarness(<App onQuit={() => {}} />, opts);

test("the status bar advertises the mode's key", async () => {
  const h = await renderApp();
  try {
    expect(h.frame()).toContain("(n) nav");
  } finally {
    await h.cleanup();
  }
});

test("n opens both nav panes with a key printed in every label", async () => {
  const h = await renderApp();
  try {
    // The secondary pane is hidden until something opens it.
    expect(h.frame()).not.toContain("Inbox");

    await h.press((i) => i.pressKey("n"));

    const frame = h.frame();
    // Primary rail: each group answers to its own initial, lower-cased.
    expect(frame).toContain("(i)ssues");
    expect(frame).toContain("(e)xplore");
    expect(frame).toContain("(d)ashboards");
    // Secondary pane, opened by the mode rather than by Enter.
    expect(frame).toContain("(f)eed");
    // "Inbox" wants `i`, which Issues holds, and `n`, which the mode keeps for
    // itself — so it reaches past both to the next character it owns.
    expect(frame).toContain("In(b)ox");
    // The bar says what the app is waiting for.
    expect(frame).toContain("go to…");
  } finally {
    await h.cleanup();
  }
});

test("the printed key wears the app's keystroke pink", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("n"));

    // `frame()` flattens color away, so spans are the only proof the key is
    // findable by sweeping for pink rather than by reading every label. Each
    // key is its own span, holding exactly the one character to press.
    const keySpans = h
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.text === "i" || span.text === "f");

    expect(keySpans.length).toBe(2); // Issues and Feed
    for (const span of keySpans) {
      expect(rgbToHex(span.fg)).toBe(theme.hotkey.toLowerCase());
    }
  } finally {
    await h.cleanup();
  }
});

test("a secondary key navigates and closes the mode", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("n"));
    // Issues › All Views: `a` is gone by then, so the key is the second word's.
    expect(h.frame()).toContain("All (v)iews");
    await h.press((i) => i.pressKey("v"));

    const frame = h.frame();
    expect(frame).toContain("All Views"); // the content pane's own header
    expect(frame).not.toContain("(i)ssues"); // keys are gone with the mode
    expect(frame).not.toContain("Inbox"); // and so is the secondary pane
  } finally {
    await h.cleanup();
  }
});

test("a group key repoints the secondary pane without leaving the mode", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("n"));
    await h.press((i) => i.pressKey("e"));

    const afterGroup = h.frame();
    // Explore's items, each with a key, and the mode still waiting. Traces
    // keys off its `r`: the groups are assigned first, and Seer takes `s`,
    // which pushes Settings onto `t`.
    expect(afterGroup).toContain("T(r)aces");
    expect(afterGroup).toContain("(l)ogs");
    expect(afterGroup).toContain("go to…");
    // Still on the Issues feed: choosing a group is not yet a destination.
    expect(afterGroup).toContain("Feed");

    await h.press((i) => i.pressKey("l"));
    expect(h.frame()).toContain("Search logs…");
  } finally {
    await h.cleanup();
  }
});

test("escape leaves the mode and puts the panes back", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("n"));
    expect(h.frame()).toContain("(f)eed");

    await h.pressEscape();

    const frame = h.frame();
    expect(frame).not.toContain("(f)eed");
    expect(frame).not.toContain("Inbox"); // the pane closed with the mode
    expect(frame).toContain("is:unresolved"); // content untouched
  } finally {
    await h.cleanup();
  }
});

test("a second n leaves the mode, so the keys can't get stuck on", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("n"));
    await h.press((i) => i.pressKey("n"));
    expect(h.frame()).not.toContain("(i)ssues");
  } finally {
    await h.cleanup();
  }
});

test("an unassigned key leaves the mode without acting on the issue", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("n"));
    // `q` is quit and belongs to no destination here; in the mode it is a miss,
    // and a miss must not fall through to the command it usually runs.
    await h.press((i) => i.pressKey("q"));

    expect(h.frame()).not.toContain("(i)ssues");
  } finally {
    await h.cleanup();
  }
});

test("the org key still opens the picker while the mode is up", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("n"));
    // The rail prints `(o)` beside the slug throughout, so no nav item may
    // claim it — "Errors & Outages" reaches past its `O` to the next character.
    expect(h.frame()).toContain("E(r)rors & Outages");

    await h.press((i) => i.pressKey("o"));
    const frame = h.frame();
    expect(frame).toContain("Organization"); // the picker, anchored to the rail
    expect(frame).not.toContain("(i)ssues"); // and the mode stepped aside
  } finally {
    await h.cleanup();
  }
});

test("g still jumps to the top of the list rather than opening the mode", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("g"));
    expect(h.frame()).not.toContain("go to…");
  } finally {
    await h.cleanup();
  }
});

test("n is a letter, not a mode, while the search box has focus", async () => {
  const h = await renderApp();
  try {
    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("n"));

    expect(h.frame()).not.toContain("go to…");
  } finally {
    await h.cleanup();
  }
});

/** `captureSpans` reports colors as 0–1 rgb floats; the theme speaks hex. */
function rgbToHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}
