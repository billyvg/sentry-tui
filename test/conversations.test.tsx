import { describe, expect, test } from "bun:test";

import {
  conversationIdLabel,
  conversationTitle,
  conversationUserLabel,
  listConversations,
  type Conversation,
} from "~/api/aiConversations";
import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { getExploreTable } from "~/core/exploreTables";
import { getScreen } from "~/core/screens";
import { App } from "~/ui/App";
import { SCREEN_COMPONENTS } from "~/ui/screens/registry";
import { rawConversationsFixture } from "./conversation-fixtures";
import { exploreTimeseriesFixture } from "./explore-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });

/** Index of Conversations in the Explore sidebar, which is what `j` counts. */
const CONVERSATIONS_INDEX = 8;

/**
 * The list endpoint and the chart's Discover call are separate, so the stub
 * answers them separately — and answers `events/` with nothing, which is what
 * proves the rows did not come from a span query.
 */
function stubClient(rows: unknown = rawConversationsFixture) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/ai-conversations/")) return json(rows);
    if (url.includes("/events-stats/")) return json({ data: exploreTimeseriesFixture });
    return json([]);
  }) as unknown as typeof fetch;
  return { client: new SentryClient({ auth, fetchImpl }), calls };
}

async function navigateToConversations(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  for (let n = 0; n < CONVERSATIONS_INDEX; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

async function renderApp(client: SentryClient, width = 140, height = 32) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, { width, height });
}

// ---------------------------------------------------------------------------
// It is not a Discover table
// ---------------------------------------------------------------------------

describe("registration", () => {
  test("Conversations has no Discover config and its own component", () => {
    // The three siblings share `ExploreTable`; this one must not, or it would
    // be asked for a `dataset` and a `field[]` it does not have.
    expect(getExploreTable("explore.conversations")).toBeUndefined();
    expect(SCREEN_COMPONENTS["explore.conversations"]).toBeDefined();
    expect(SCREEN_COMPONENTS["explore.conversations"]).not.toBe(
      SCREEN_COMPONENTS["explore.traces"],
    );
  });

  test("it still shares the Explore filter slice and opens a panel", () => {
    const screen = getScreen("explore.conversations");
    expect(screen.stateKey).toBe("explore.discover");
    expect(screen.kind).toBe("table");
    expect(screen.openLabel).toBe("details");
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe("listConversations", () => {
  async function fetchRows(rows: unknown = rawConversationsFixture): Promise<Conversation[]> {
    const { client } = stubClient(rows);
    const page = await listConversations(client, { org: "acme", statsPeriod: "1h" });
    return page.data;
  }

  test("hits the conversation endpoint, not events/", async () => {
    const { client, calls } = stubClient();
    await listConversations(client, { org: "acme", statsPeriod: "1h" });
    expect(calls.some((url) => url.includes("/ai-conversations/"))).toBe(true);
    expect(calls.some((url) => url.includes("/events/"))).toBe(false);
  });

  test("returns newest first", async () => {
    const rows = await fetchRows();
    const ends = rows.map((row) => Date.parse(row.endedAt));
    expect(ends).toEqual([...ends].sort((a, b) => b - a));
  });

  test("epoch milliseconds become ISO instants at the boundary", async () => {
    const [first] = await fetchRows();
    expect(first!.endedAt).toBe("2026-08-21T00:00:00.000Z");
  });

  test("a structured firstInput reads as text", async () => {
    const rows = await fetchRows();
    const structured = rows.find((row) => row.id.startsWith("9c02f1ee"))!;
    expect(structured.firstInput).toBe("Summarise\n  the last four deploys");
    expect(conversationTitle(structured)).toBe("Summarise the last four deploys");
  });

  test("a title wins over the first message", async () => {
    const rows = await fetchRows();
    const titled = rows.find((row) => row.id.startsWith("1677a6b8"))!;
    expect(conversationTitle(titled)).toBe("Payment declined due to insufficient funds");
  });

  test("a conversation with nothing to show survives normalisation", async () => {
    const rows = await fetchRows();
    const bare = rows.find((row) => row.id === "resp_8f31c")!;
    expect(conversationTitle(bare)).toBeUndefined();
    // `"none"` is the API's way of saying the SDK reported no user.
    expect(bare.user).toBeUndefined();
    expect(bare.totalCost).toBe(0);
    expect(bare.toolNames).toEqual([]);
  });

  test("a malformed body is an empty list, not a crash", async () => {
    expect(await fetchRows(null)).toEqual([]);
    expect(await fetchRows({ data: "nope" })).toEqual([]);
  });
});

describe("display helpers", () => {
  test("UUIDs shorten and other id formats do not", () => {
    expect(conversationIdLabel("1677a6b8-10cc-495c-8a30-0a9642b57094")).toBe("1677a6b8");
    expect(conversationIdLabel("resp_8f31c")).toBe("resp_8f31c");
    expect(conversationIdLabel("slack:1234")).toBe("slack:1234");
  });

  test("the user label follows the web's precedence", () => {
    expect(conversationUserLabel({ email: "a@b.c", username: "ada" })).toBe("a@b.c");
    expect(conversationUserLabel({ username: "ada", ipAddress: "10.0.0.1" })).toBe("ada");
    expect(conversationUserLabel({ ipAddress: "10.0.0.1" })).toBe("10.0.0.1");
    expect(conversationUserLabel(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

describe("Explore › Conversations", () => {
  test("renders one row per conversation, with the web's columns", async () => {
    const h = await renderApp(stubClient().client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("Payment declined"));

      const frame = h.frame();
      for (const header of ["Conversation", "Duration", "Msgs", "Errs", "Cost", "Tools", "Age"]) {
        expect(frame).toContain(header);
      }
      expect(frame).toContain("Payment declined due to insufficient funds");
      expect(frame).toContain("search_docs");
      expect(frame).toContain("$0.0007");
      // Three conversations, not the dozens of model calls inside them.
      expect(frame).toContain("3 conversations");
    } finally {
      await h.cleanup();
    }
  });

  test("a missing title falls back to the first message, then to a placeholder", async () => {
    const h = await renderApp(stubClient().client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("Payment declined"));

      const frame = h.frame();
      expect(frame).toContain("Summarise the last four deploys");
      expect(frame).toContain("Untitled conversation");
    } finally {
      await h.cleanup();
    }
  });

  test("the second line identifies the conversation, project and user", async () => {
    const h = await renderApp(stubClient().client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("Payment declined"));

      const frame = h.frame();
      expect(frame).toContain("1677a6b8");
      expect(frame).toContain("ada@example.com");
      expect(frame).toContain("3 traces");
    } finally {
      await h.cleanup();
    }
  });

  test("errors are called out and a clean conversation is not", async () => {
    const h = await renderApp(stubClient().client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("Payment declined"));
      // The middle fixture had three errors; the others had none, which reads
      // as a dot rather than a zero.
      expect(h.frame()).toContain("·");
      expect(h.spanContaining("3")).toBeDefined();
    } finally {
      await h.cleanup();
    }
  });

  test("the chart counts conversations, over spans", async () => {
    const { client, calls } = stubClient();
    const h = await renderApp(client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("count_unique(gen_ai.conversation.id)"));

      const chart = calls.find((url) => url.includes("/events-stats/"))!;
      expect(chart).toContain("dataset=spans");
      expect(decodeURIComponent(chart)).toContain("has:gen_ai.conversation.id");
    } finally {
      await h.cleanup();
    }
  });

  test("enter opens the prompt and the reply, escape closes them", async () => {
    const h = await renderApp(stubClient().client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("Payment declined"));

      await h.press((i) => i.pressEnter());
      const frame = h.frame();
      expect(frame).toContain("Why did this checkout fail?");
      expect(frame).toContain("declined the charge for insufficient funds");
      expect(frame).toContain("2.1k in / 362 out");
      // Counts agree in number, and the tool count is real rather than "0 tools".
      expect(frame).toContain("4 calls  │  2 tools");

      await h.pressEscape();
      expect(h.frame()).not.toContain("Why did this checkout fail?");
      expect(h.frame()).toContain("Payment declined");
    } finally {
      await h.cleanup();
    }
  });

  test("an untitled conversation does not print its first message twice", async () => {
    const h = await renderApp(stubClient().client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("Payment declined"));

      // Second row: no generated title, so the heading is the first message
      // and the "→" line would only repeat it.
      await h.press((i) => i.pressKey("j"));
      await h.press((i) => i.pressEnter());

      const frame = h.frame();
      expect(frame).toContain("Summarise the last four deploys");
      expect(frame).not.toContain("→ Summarise");
      // The reply is still worth showing.
      expect(frame).toContain("Four deploys since Tuesday");
      // And a titled conversation does show both.
      expect(frame).toContain("12 calls");
    } finally {
      await h.cleanup();
    }
  });

  test("an org without the feature gets an honest empty state", async () => {
    const h = await renderApp(stubClient([]).client);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("No conversations found"));

      const frame = h.frame();
      expect(frame).toContain("No conversations found");
      expect(frame).toContain("gen-ai-conversations");
      expect(frame).toContain("may not have");
    } finally {
      await h.cleanup();
    }
  });

  test.each([80, 100, 140])("nothing wraps or overflows at %i columns", async (width) => {
    const h = await renderApp(stubClient().client, width, 32);
    try {
      await navigateToConversations(h);
      await h.waitForFrame((f) => f.includes("Payment declined"));
      for (const line of h.frame().split("\n")) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    } finally {
      await h.cleanup();
    }
  });
});
