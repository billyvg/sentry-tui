/**
 * Issues secondary nav: each item fetches its own query.
 *
 * Navigating is rail → Enter (opens the secondary list) → j × n → Enter, so
 * these tests drive the same keys a user would rather than poking state.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { getIssueView } from "~/core/issueViews";
import { App } from "~/ui/App";
import { groupsFixture } from "./fixtures";
import { renderHarness, type Harness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

/** Records every issues-list URL the app requested, newest last. */
function recordingClient() {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/issues/?")) urls.push(url);
    const payload = url.includes("issues-stats") ? {} : groupsFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { urls, client: new SentryClient({ auth, fetchImpl }) };
}

/** The `query` parameter of the most recent issues request. */
function lastQuery(urls: string[]): string | null {
  const url = urls.at(-1);
  return url ? new URL(url).searchParams.get("query") : null;
}

function lastSort(urls: string[]): string | null {
  const url = urls.at(-1);
  return url ? new URL(url).searchParams.get("sort") : null;
}

/** Rail → Enter → j × steps → Enter, i.e. pick the nth Issues nav item. */
async function selectIssuesItem(h: Harness, steps: number) {
  // Focus starts on the content pane; Tab moves it to the rail.
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressEnter());
  for (let n = 0; n < steps; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

/** Index of a label within the flattened Issues nav item list. */
const ITEM_INDEX: Record<string, number> = {
  Feed: 0,
  Inbox: 1,
  "Errors & Outages": 2,
  "Breached Metrics": 3,
  Warnings: 4,
  Configuration: 5,
  "User Feedback": 6,
  "Recently Run": 7,
  "All Views": 8,
};

for (const label of ["Warnings", "Errors & Outages", "User Feedback", "Recently Run"]) {
  test(`selecting ${label} fetches its own query`, async () => {
    const { urls, client } = recordingClient();
    const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
      width: WIDTH,
      height: HEIGHT,
    });
    try {
      await h.waitForFrame((f) => f.includes("TypeError"));
      const view = getIssueView(label)!;

      await selectIssuesItem(h, ITEM_INDEX[label]!);
      await h.waitForFrame(() => lastQuery(urls) === view.query);

      expect(lastQuery(urls)).toBe(view.query);
      // The header names the view, since the secondary nav has closed.
      expect(h.frame()).toContain(label);
    } finally {
      await h.cleanup();
    }
  });
}

test("Inbox carries its own sort as well as its query", async () => {
  const { urls, client } = recordingClient();
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));
    expect(lastSort(urls)).toBe("date");

    await selectIssuesItem(h, ITEM_INDEX["Inbox"]!);
    await h.waitForFrame(() => lastSort(urls) === "progress");

    expect(lastQuery(urls)).toBe(getIssueView("Inbox")!.query);
    expect(lastSort(urls)).toBe("progress");
  } finally {
    await h.cleanup();
  }
});

test("reaching a view through the command palette applies its query too", async () => {
  const { urls, client } = recordingClient();
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    // Leave the Issues group first — somewhere inert, so this test is about
    // navigation and not about another screen's data. The palette jumps
    // straight to a group + item without moving the rail cursor through it,
    // which is the case where reading the *rail's* group rather than the
    // target's would silently skip the query reset.
    await h.press((i) => i.pressKey("k", { ctrl: true }));
    await h.waitForFrame((f) => f.includes("Command palette"));
    await h.press((i) => i.pressKey("sentry built"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Not implemented yet"));

    await h.press((i) => i.pressKey("k", { ctrl: true }));
    await h.waitForFrame((f) => f.includes("Command palette"));
    await h.press((i) => i.pressKey("warnings"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame(() => lastQuery(urls) === getIssueView("Warnings")!.query);
    expect(lastQuery(urls)).toBe(getIssueView("Warnings")!.query);
  } finally {
    await h.cleanup();
  }
});

test("switching back to Feed restores the default query", async () => {
  const { urls, client } = recordingClient();
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await h.waitForFrame((f) => f.includes("TypeError"));

    await selectIssuesItem(h, ITEM_INDEX["Warnings"]!);
    await h.waitForFrame(() => lastQuery(urls) === getIssueView("Warnings")!.query);

    // Re-entering the group starts the cursor on the active item, so walking
    // back up to Feed is the same number of steps in the other direction.
    await h.press((i) => i.pressTab());
    await h.press((i) => i.pressEnter());
    for (let n = 0; n < ITEM_INDEX["Warnings"]!; n++) await h.press((i) => i.pressKey("k"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame(() => lastQuery(urls) === getIssueView("Feed")!.query);
    expect(lastQuery(urls)).toBe(getIssueView("Feed")!.query);
    expect(lastSort(urls)).toBe("date");
  } finally {
    await h.cleanup();
  }
});
