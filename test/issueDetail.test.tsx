import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { theme } from "~/core/theme";
import { App } from "~/ui/App";
import { eventFixture, groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
/**
 * Tall enough that the stack trace's expanded frames clear the header, with
 * several rows to spare.
 *
 * The detail screen is a scrollbox, so anything past this is simply off-view —
 * and a height that only *just* fits turns every change to the header into
 * failures down here that read like rendering bugs rather than layout drift.
 */
const HEIGHT = 60;

function stubClient({ eventDelayMs = 0 } = {}) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = groupsFixture;
    if (url.includes("issues-stats")) payload = {};
    else if (url.includes("/events/")) {
      if (eventDelayMs) await new Promise((r) => setTimeout(r, eventDelayMs));
      payload = eventFixture;
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

/** Open the first issue: focus the list, then press Enter. */
async function openFirstIssue(client = stubClient()) {
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  await h.waitForFrame((f) => f.includes("TypeError"));
  // Content pane has focus by default; press Enter to open the issue.
  await h.press((i) => i.pressEnter());
  return h;
}

test("enter opens the issue detail with header metadata", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("Issues › Feed › PUMP-STATION-1"));
    const frame = h.frame();
    // The trail lives in the pane's border now, and the row under it says how
    // to leave — both drawn by the app for every pushed view, not by this one.
    expect(frame).toContain("Issues › Feed › PUMP-STATION-1");
    expect(frame).toContain("back to Feed");
    expect(frame).toContain("TypeError");
    expect(frame).toContain("1.4k events");
    expect(frame).toContain("92 users");
    expect(frame).toContain("r resolve"); // action chip
  } finally {
    await h.cleanup();
  }
});

test("the header separates current state from the actions that change it", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("Issues › Feed › PUMP-STATION-1"));
    const frame = h.frame();

    // State — what the issue is. No key, so it can't read as a control.
    expect(frame).toContain("unresolved · javascript · high priority · unassigned");
    // Actions — what you can do, each carrying the key that does it.
    expect(frame).toContain("r resolve");
    expect(frame).toContain("a archive");
    // `p` and `A` have no handler, so the header must not advertise them.
    // Scoped to the actions row itself — none of `resolve`/`unresolve`/
    // `archive`/`unarchive`/`bookmark`/`review` contain either letter, so a
    // bare search stays a real check even without parens to delimit a key.
    // Matched on "r resolve" rather than "resolve" alone: the state line above
    // contains "unresolved", which itself contains "resolve".
    const actionsRow = frame.split("\n").find((line) => line.includes("r resolve"));
    expect(actionsRow).not.toContain("p");
    expect(actionsRow).not.toContain("A");
  } finally {
    await h.cleanup();
  }
});

test("a numbered section folds and unfolds from its own digit", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("▾ 1 Stack Trace"));
    expect(h.frame()).toContain("renderRoot");

    await h.press((i) => i.pressKey("1"));
    expect(h.frame()).toContain("▸ 1 Stack Trace");
    expect(h.frame()).not.toContain("renderRoot");

    await h.press((i) => i.pressKey("1"));
    expect(h.frame()).toContain("▾ 1 Stack Trace");
    expect(h.frame()).toContain("renderRoot");
  } finally {
    await h.cleanup();
  }
});

test("z folds every section at once, and unfolds them again", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("▾ 1 Stack Trace"));

    await h.press((i) => i.pressKey("z"));
    const folded = h.frame();
    expect(folded).toContain("▸ 1 Stack Trace");
    expect(folded).toContain("▸ 2 Breadcrumbs");
    expect(folded).not.toContain("renderRoot");

    await h.press((i) => i.pressKey("z"));
    expect(h.frame()).toContain("▾ 1 Stack Trace");
  } finally {
    await h.cleanup();
  }
});

test("a folded section says how many rows it is hiding", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("▾ 1 Stack Trace"));
    // Folded is the state the count is for, and it also brings every section
    // header onto one screen.
    await h.press((i) => i.pressKey("z"));

    const frame = h.frame();
    expect(frame).toContain("▸ 2 Breadcrumbs (2)");
    expect(frame).toContain("▸ 4 Tags (4)");
    expect(frame).toContain("▸ 5 Contexts (2)");
  } finally {
    await h.cleanup();
  }
});

test("header renders from the already-loaded group before the event arrives", async () => {
  const h = await openFirstIssue(stubClient({ eventDelayMs: 5_000 }));
  try {
    // No waiting: the group came from the list, so the header is immediate.
    const frame = h.frame();
    expect(frame).toContain("PUMP-STATION-1");
    expect(frame).toContain("TypeError");
    expect(frame).toContain("Loading event…");
    // The slow part is the body, and it says so rather than blocking.
    expect(frame).not.toContain("Stack Trace");
  } finally {
    await h.cleanup();
  }
});

test("renders the stack trace with in-app frames and folded system frames", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("Stack Trace"));
    const frame = h.frame();

    expect(frame).toContain("TypeError");
    expect(frame).toContain("app.tsx in renderRoot at line 42:13");
    expect(frame).toContain("In App");
    // The react-dom frame is a system frame, but it calls into app code, so
    // Sentry keeps it visible as the boundary — it just isn't marked In App.
    expect(frame).toContain("invokeGuardedCallback");
    const systemLine = frame.split("\n").find((line) => line.includes("invokeGuardedCallback"))!;
    expect(systemLine).not.toContain("In App");
  } finally {
    await h.cleanup();
  }
});

test("expands the crashing frame's source context with the active line marked", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("Stack Trace"));
    const frame = h.frame();

    expect(frame).toContain("return <Header id={user.id} />");
    expect(frame).toContain("❯"); // active-line marker
    expect(frame).toContain("Local variables");
    expect(frame).toContain("props");
  } finally {
    await h.cleanup();
  }
});

test("renders breadcrumbs, request, tags, contexts and sdk sections", async () => {
  // Tall enough that every section is on screen at once — the sections below
  // the stack trace are otherwise off the bottom of the scrollbox.
  const client = stubClient();
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: 100,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    // Content pane has focus by default; press Enter to open the issue.
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Breadcrumbs"));

    const frame = h.frame();
    expect(frame).toContain("Breadcrumbs");
    expect(frame).toContain("/orders -> /checkout");
    expect(frame).toContain("Request");
    expect(frame).toContain("GET https://app.example.com/checkout");
    expect(frame).toContain("Tags");
    expect(frame).toContain("browser");
    expect(frame).toContain("SDK");
    expect(frame).toContain("sentry.javascript.react");
  } finally {
    await h.cleanup();
  }
});

test("escape returns to the issue stream", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("Stack Trace"));

    await h.pressEscape();
    const frame = h.frame();

    expect(frame).not.toContain("Stack Trace");
    expect(frame).toContain("TypeError"); // back on the list
    expect(frame).toContain("is:unresolved"); // stream chrome is back
  } finally {
    await h.cleanup();
  }
});

test("the detail view surfaces an event load failure without losing the header", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/events/")) return new Response("", { status: 500 });
    const payload = url.includes("issues-stats") ? {} : groupsFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const h = await openFirstIssue(new SentryClient({ auth, fetchImpl, maxRetries: 0 }));
  try {
    await h.waitForFrame((f) => f.includes("Failed to load event"));
    const frame = h.frame();
    expect(frame).toContain("Failed to load event");
    // The header still stands — it never needed the event.
    expect(frame).toContain("PUMP-STATION-1");
  } finally {
    await h.cleanup();
  }
});

test("the scrollbox viewport fills the pane, with the scrollbar beside it", async () => {
  // A scrollbox lays its root out as a row — viewport, then vertical scrollbar.
  // Forcing `flexDirection: "column"` on it stacks the bar *under* the
  // viewport, which halves the visible height and leaves the bar adrift in the
  // dead space below the content. Long content is what makes that visible.
  const longEvent = {
    ...eventFixture,
    entries: eventFixture.entries.map((entry) =>
      entry.type === "breadcrumbs"
        ? {
            type: "breadcrumbs",
            data: {
              values: Array.from({ length: 120 }, (_, i) => ({
                type: "default",
                level: "info",
                category: "worker",
                message: `crumb ${i}`,
                timestamp: "2026-08-20T09:12:01Z",
                data: null,
              })),
            },
          }
        : entry,
    ),
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = groupsFixture;
    if (url.includes("issues-stats")) payload = {};
    else if (url.includes("/events/")) payload = longEvent;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const h = await openFirstIssue(new SentryClient({ auth, fetchImpl }));
  try {
    await h.waitForFrame((f) => f.includes("Breadcrumbs (120)"));

    // Row HEIGHT - 3 is the last row inside the content pane's border, one
    // above the border and the status bar. Content that tall must reach it.
    const lastPaneRow = h.frame().split("\n")[HEIGHT - 3]!;
    expect(lastPaneRow).toContain("crumb ");
  } finally {
    await h.cleanup();
  }
});

test("a chip's end caps are painted in its rim color, not as stray blocks", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("r resolve"));

    // The pill's rounded end is a half block whose *unfilled* half falls
    // through to the page. It carries the rim rather than the fill, which is
    // what makes it the frame's left and right sides instead of a seam — but
    // it must carry one of them, or the chips gain two loose blocks either
    // side.
    const cap = h.spanContaining("▐");
    expect(cap).toBeDefined();
    const rendered = (["r", "g", "b"] as const).map((k) => Math.round(cap!.fg[k] * 255));
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(rendered).toEqual(channels(theme.chip.rim));
    // The frame only exists while the two differ.
    expect(theme.chip.rim).not.toBe(theme.chip.surface);
  } finally {
    await h.cleanup();
  }
});
