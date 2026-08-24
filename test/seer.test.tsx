import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { seerSessionFixture } from "./seer-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

interface SeerStub {
  client: SentryClient;
  /** Bodies POSTed to the chat endpoint, in order. */
  sent: Array<Record<string, unknown>>;
  /** Bodies POSTed to the update (interrupt / PR) endpoint. */
  updates: Array<Record<string, unknown>>;
}

function stubClient(session = seerSessionFixture): SeerStub {
  const sent: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.includes("/seer/explorer-update/")) {
      updates.push(body);
      return json({ run_id: 1 }, 202);
    }
    if (url.includes("/seer/explorer-chat/")) {
      if (method === "POST") {
        sent.push(body);
        return json({ run_id: 1, sentry_run_id: "run-uuid" });
      }
      return json({ session, sentry_run_id: "run-uuid" });
    }
    // Issues endpoints are hit on mount; we navigate away from them.
    return json([]);
  }) as unknown as typeof fetch;

  return { client: new SentryClient({ auth, fetchImpl }), sent, updates };
}

async function renderApp(client: SentryClient) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

/**
 * Mount straight onto the conversation. The rail walk has its own tests below;
 * repeating it per test cost a render pass per keystroke.
 */
async function renderSeer(client: SentryClient) {
  return renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen="seer.ask" />,
    { width: WIDTH, height: HEIGHT },
  );
}

test("the nav rail lists Seer and no longer lists Insights", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.openNav();
    expect(h.frame()).toContain("Seer");
    expect(h.frame()).not.toContain("Insights");
  } finally {
    await h.cleanup();
  }
});

test("enter on the Seer rail item opens the screen without a secondary nav", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await h.openNav();
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    // Straight to the conversation — the secondary list never appears, so its
    // sole "Ask Seer" row is not on screen.
    expect(h.frame()).toContain("Ask Seer anything about your application.");
    expect(h.frame()).not.toContain("Ask Seer\n");
  } finally {
    await h.cleanup();
  }
});

test("goto mode jumps straight to Seer on its group key", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    // `n` opens goto mode, then Seer's own key completes the jump — there is
    // no second half to press, since the group has one destination.
    await h.press((i) => i.pressKey("n"));
    await h.press((i) => i.pressKey("s"));
    expect(h.frame()).toContain("Ask Seer anything about your application.");
  } finally {
    await h.cleanup();
  }
});

test("a multi-item group still opens its secondary nav", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    // Explore has many destinations, so Enter must still offer the list.
    await h.openNav();
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Traces");
  } finally {
    await h.cleanup();
  }
});

test("the Seer screen opens on an empty state with suggested prompts", async () => {
  const { client } = stubClient();
  const h = await renderSeer(client);
  try {
    expect(h.frame()).toContain("Ask Seer anything about your application.");
    expect(h.frame()).toContain("What are my slowest DB queries?");
  } finally {
    await h.cleanup();
  }
});

test("typing a question and pressing enter sends it to the chat endpoint", async () => {
  const stub = stubClient();
  const h = await renderSeer(stub.client);
  try {
    // The composer takes focus on arrival, so this types straight into it.
    await h.press((i) => i.pressKey("why is checkout failing"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Checkout fails"));

    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0]).toMatchObject({ query: "why is checkout failing", insert_index: 0 });
  } finally {
    await h.cleanup();
  }
});

test("the transcript renders the answer and the tool commentary", async () => {
  const stub = stubClient();
  const h = await renderSeer(stub.client);
  try {
    await h.press((i) => i.pressKey("hello"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Checkout fails"));

    const frame = h.frame();
    // The user's own turn.
    expect(frame).toContain("Why is checkout failing?");
    // Tool calls are phrased the way the web app phrases them.
    expect(frame).toContain("Read checkout.py from store");
    // And Seer's answer.
    expect(frame).toContain("Checkout fails when the cart is empty");
  } finally {
    await h.cleanup();
  }
});

test("escape releases the composer so a numbered prompt can be sent", async () => {
  const stub = stubClient();
  const h = await renderSeer(stub.client);
  try {
    // While the composer holds focus a digit is text, so drop focus first.
    await h.pressEscape();
    await h.press((i) => i.pressKey("2"));
    await h.waitForFrame((f) => f.includes("Checkout fails"));

    expect(stub.sent[0]).toMatchObject({ query: "What are my slowest DB queries?" });
  } finally {
    await h.cleanup();
  }
});

test("a new chat clears the transcript back to the empty state", async () => {
  const stub = stubClient();
  const h = await renderSeer(stub.client);
  try {
    await h.press((i) => i.pressKey("hello"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Checkout fails"));

    // Leave the composer, then start over. Shifted `N`: a bare `n` is goto.
    await h.pressEscape();
    await h.press((i) => i.pressKey("N", { shift: true }));
    await h.waitForFrame((f) => f.includes("Ask Seer anything about your application."));

    expect(h.frame()).not.toContain("Checkout fails");
  } finally {
    await h.cleanup();
  }
});

test("issue triage keys do not fire while the Seer screen is open", async () => {
  const stub = stubClient();
  const h = await renderSeer(stub.client);
  try {
    await h.pressEscape();
    // `r` resolves an issue on the issue stream; here it must do nothing.
    await h.press((i) => i.pressKey("r"));
    expect(h.frame()).not.toContain("Resolved");
  } finally {
    await h.cleanup();
  }
});
