import { describe, expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import type { Group } from "~/api/types";
import { applyUpdate, findTriageAction, TRIAGE_ACTIONS } from "~/core/triage";
import { App } from "~/ui/App";
import { eventFixture, groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

describe("triage actions", () => {
  const unresolved = groupsFixture[0]!;
  const archived = groupsFixture[2]!; // status: ignored

  test("every action maps to a real command", () => {
    for (const action of TRIAGE_ACTIONS) {
      expect(findTriageAction(action.commandId)).toBe(action);
    }
  });

  test("resolve sets the status, and is a no-op when already resolved", () => {
    const resolve = findTriageAction("sentry.issue.resolve")!;
    expect(resolve.update(unresolved)).toEqual({ status: "resolved" });
    expect(resolve.update({ ...unresolved, status: "resolved" })).toBeNull();
  });

  test("archive toggles, matching the web app", () => {
    const archive = findTriageAction("sentry.issue.archive")!;
    expect(archive.update(unresolved)).toEqual({
      status: "ignored",
      substatus: "archived_until_escalating",
    });
    // Archiving an archived issue un-archives it.
    expect(archive.update(archived)).toEqual({ status: "unresolved" });
  });

  test("bookmark toggles both ways", () => {
    const bookmark = findTriageAction("sentry.issue.bookmark")!;
    expect(bookmark.update(unresolved)).toEqual({ isBookmarked: true });
    expect(bookmark.update({ ...unresolved, isBookmarked: true })).toEqual({
      isBookmarked: false,
    });
  });

  test("mark reviewed is a no-op once seen", () => {
    const review = findTriageAction("sentry.issue.markReviewed")!;
    expect(review.update(unresolved)).toEqual({ inbox: false, hasSeen: true });
    expect(review.update({ ...unresolved, hasSeen: true })).toBeNull();
  });

  test("no action deletes anything", () => {
    for (const action of TRIAGE_ACTIONS) {
      const update = action.update(unresolved) ?? {};
      expect(Object.keys(update)).not.toContain("delete");
      expect(Object.keys(update)).not.toContain("discard");
    }
  });

  test("applyUpdate mirrors the fields the server will change", () => {
    const next = applyUpdate(unresolved, {
      status: "resolved",
      isBookmarked: true,
    });
    expect(next.status).toBe("resolved");
    expect(next.isBookmarked).toBe(true);
    // Untouched fields are preserved, and the original is not mutated.
    expect(next.title).toBe(unresolved.title);
    expect(unresolved.status).toBe("unresolved");
  });

  test("marking reviewed also clears the unread flag locally", () => {
    expect(applyUpdate(unresolved, { inbox: false }).hasSeen).toBe(true);
  });
});

/** Render the app, focus the list, and return the harness. */
async function renderList(fetchImpl: typeof fetch, { width = WIDTH, height = HEIGHT } = {}) {
  const client = new SentryClient({ auth, fetchImpl, maxRetries: 0 });
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width,
    height,
  });
  await h.waitForFrame((f) => f.includes("TypeError"));
  // Content pane has focus by default.
  return h;
}

function listFetch(onPut?: (body: unknown) => Response | Promise<Response>): {
  impl: typeof fetch;
  puts: unknown[];
} {
  const puts: unknown[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (init.method === "PUT") {
      const body: unknown = JSON.parse(init.body as string);
      puts.push(body);
      if (onPut) return onPut(body);
      return new Response(JSON.stringify({ ...groupsFixture[0], ...(body as object) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    let payload: unknown = groupsFixture;
    if (url.includes("issues-stats")) payload = {};
    else if (url.includes("/events/")) payload = eventFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, puts };
}

describe("triage from the issue list", () => {
  test("r sends a resolve PUT and confirms in the status bar", async () => {
    const { impl, puts } = listFetch();
    const h = await renderList(impl);
    try {
      await h.press((i) => i.pressKey("r"));
      await h.waitForFrame((f) => f.includes("Resolved"));

      expect(puts).toEqual([{ status: "resolved" }]);
      expect(h.frame()).toContain("Resolved PUMP-STATION-1");
    } finally {
      await h.cleanup();
    }
  });

  test("a is archive with the until-escalating substatus", async () => {
    const { impl, puts } = listFetch();
    const h = await renderList(impl);
    try {
      await h.press((i) => i.pressKey("a"));
      await h.waitForFrame((f) => f.includes("Archived"));

      expect(puts).toEqual([{ status: "ignored", substatus: "archived_until_escalating" }]);
    } finally {
      await h.cleanup();
    }
  });

  test("acts on the cursor row, not always the first", async () => {
    const { impl, puts } = listFetch();
    const h = await renderList(impl);
    try {
      await h.press((i) => i.pressKey("j")); // move to ValueError
      await h.press((i) => i.pressKey("r"));
      await h.waitForFrame((f) => f.includes("Resolved"));

      expect(puts).toHaveLength(1);
      expect(h.frame()).toContain("Resolved PUMP-STATION-2");
    } finally {
      await h.cleanup();
    }
  });

  test("a failed mutation rolls back and reports the error", async () => {
    const { impl } = listFetch(() => new Response("", { status: 403 }));
    const h = await renderList(impl);
    try {
      await h.press((i) => i.pressKey("b")); // bookmark
      await h.waitForFrame((f) => f.includes("Failed"));

      const frame = h.frame();
      expect(frame).toContain("Failed");
      // The row is still there and readable — no crash, no blank state.
      expect(frame).toContain("TypeError");
    } finally {
      await h.cleanup();
    }
  });

  test("a no-op action says so instead of sending a request", async () => {
    const { impl, puts } = listFetch();
    const h = await renderList(impl);
    try {
      // The third fixture is already archived; unresolve it, then unresolve
      // again — the second press has nothing to do.
      await h.press((i) => i.pressKey("G", { shift: true }));
      await h.press((i) => i.pressKey("u"));
      await h.waitForFrame((f) => f.includes("Unresolved"));
      const after = puts.length;

      await h.press((i) => i.pressKey("u"));
      await h.waitForFrame((f) => f.includes("Already unresolved"));
      expect(puts).toHaveLength(after);
    } finally {
      await h.cleanup();
    }
  });

  test("triage keys are inert while the nav rail has focus", async () => {
    const { impl, puts } = listFetch();
    const client = new SentryClient({ auth, fetchImpl: impl, maxRetries: 0 });
    const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
      width: WIDTH,
      height: HEIGHT,
    });
    try {
      await h.waitForFrame((f) => f.includes("TypeError"));
      // Content has focus by default — tab to the rail.
      await h.press((i) => i.pressTab());
      await h.press((i) => i.pressKey("r"));
      expect(puts).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });
});

test("triage works from the detail view and updates its header", async () => {
  const { impl, puts } = listFetch();
  const h = await renderList(impl, { height: 40 });
  try {
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Issues / PUMP-STATION-1"));
    expect(h.frame()).toContain("(r) resolve");
    expect(h.frame()).toContain("unresolved · javascript");

    await h.press((i) => i.pressKey("r"));
    await h.waitForFrame((f) => f.includes("(u) unresolve"));

    expect(puts).toEqual([{ status: "resolved" }]);
    // Both the action chip and the state line reflect the new status without a
    // refetch — they are derived from the same optimistically-updated group.
    expect(h.frame()).toContain("(u) unresolve");
    expect(h.frame()).toContain("resolved · javascript");
  } finally {
    await h.cleanup();
  }
});

test("optimistic update is visible before the server responds", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));

  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (init.method === "PUT") {
      await gate;
      return new Response(JSON.stringify(groupsFixture[0]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const payload = String(input).includes("issues-stats") ? {} : groupsFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const h = await renderList(impl);
  try {
    await h.press((i) => i.pressKey("m")); // mark reviewed
    // The PUT has not resolved, but the row already shows the in-flight
    // marker — this is what makes triage feel instant on a slow API.
    await h.waitForFrame((f) => f.includes("⟳"));
    expect(h.frame()).toContain("⟳");

    await h.press(() => release());
    await h.waitForFrame((f) => !f.includes("⟳"));
  } finally {
    await h.cleanup();
  }
});

test("issue rows expose their permalink for terminal hyperlinks", () => {
  // OSC-8 links are emitted by <a href>; assert the data is present so the
  // row can render one.
  for (const group of groupsFixture as Group[]) {
    expect(group.permalink).toStartWith("https://");
  }
});
