import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { eventFixture, groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
/**
 * Tall enough that the stack trace's expanded frames clear the header.
 *
 * The detail screen is a scrollbox, so anything past this is simply off-view —
 * a height that "nearly" fits produces assertion failures that read like
 * rendering bugs.
 */
const HEIGHT = 52;

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
    await h.waitForFrame((f) => f.includes("Issues / PUMP-STATION-1"));
    const frame = h.frame();
    expect(frame).toContain("Issues / PUMP-STATION-1"); // breadcrumb
    expect(frame).toContain("TypeError");
    expect(frame).toContain("1.4k events");
    expect(frame).toContain("92 users");
    expect(frame).toContain("(r) resolve"); // action chip
  } finally {
    await h.cleanup();
  }
});

test("the header separates current state from the actions that change it", async () => {
  const h = await openFirstIssue();
  try {
    await h.waitForFrame((f) => f.includes("Issues / PUMP-STATION-1"));
    const frame = h.frame();

    // State — what the issue is. No key, so it can't read as a control.
    expect(frame).toContain("unresolved · error · javascript · high priority · unassigned");
    // Actions — what you can do, each carrying the key that does it.
    expect(frame).toContain("(r) resolve");
    expect(frame).toContain("(a) archive");
    // `p` and `A` have no handler, so the header must not advertise them.
    expect(frame).not.toContain("(p)");
    expect(frame).not.toContain("(A)");
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
    await h.waitForFrame((f) => f.includes("Breadcrumbs"));
    expect(h.frame()).toContain("Breadcrumbs (2)");
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
