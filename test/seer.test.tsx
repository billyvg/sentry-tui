import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App, type AppProps } from "~/ui/App";
import { seerSessionFixture } from "./seer-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

interface SeerStub {
  client: SentryClient;
  /** Bodies POSTed to the short-lived agent scope endpoint. */
  approvals: Array<Record<string, unknown>>;
  /** Bodies POSTed to the chat endpoint, in order. */
  sent: Array<Record<string, unknown>>;
  /** Bodies POSTed to the update (interrupt / PR) endpoint. */
  updates: Array<Record<string, unknown>>;
}

interface SeerStubOptions {
  features?: string[];
  runs?: Array<{
    id: string;
    title: string | null;
    dateCreated: string;
    lastTriggeredAt: string;
  }>;
  holdPost?: boolean;
}

function stubClient(
  session = seerSessionFixture,
  { features, runs = [], holdPost = false }: SeerStubOptions = {},
): SeerStub {
  const sent: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const approvals: Array<Record<string, unknown>> = [];

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.includes("/agent/approve/")) {
      approvals.push(body);
      return json({ scopes: body["scopes"] });
    }
    if (url.includes("/seer/explorer-update/")) {
      updates.push(body);
      return json({ run_id: 1 }, 202);
    }
    if (url.includes("/seer/runs/")) return json(runs);
    if (url.includes("/seer/explorer-chat/")) {
      if (method === "POST") {
        sent.push(body);
        if (holdPost) return await new Promise<Response>(() => {});
        return json({ run_id: 1, sentry_run_id: "run-uuid" });
      }
      return json({ session, sentry_run_id: "run-uuid" });
    }
    if (new URL(url).pathname.endsWith("/organizations/acme/") && features !== undefined) {
      return json({ id: "1", slug: "acme", name: "Acme", features });
    }
    // Issues endpoints are hit on mount; we navigate away from them.
    return json([]);
  }) as unknown as typeof fetch;

  return { client: new SentryClient({ auth, fetchImpl }), approvals, sent, updates };
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
async function renderSeer(client: SentryClient, props: Partial<AppProps> = {}) {
  return renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen="seer.ask" {...props} />,
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

test("the Seer destination disappears when the organization feature is explicitly off", async () => {
  const { client } = stubClient(seerSessionFixture, { features: [] });
  const h = await renderApp(client);
  try {
    await h.openNav();
    await h.waitForFrame((frame) => !frame.includes("Seer"));
    expect(h.frame()).not.toContain("Seer");
  } finally {
    await h.cleanup();
  }
});

test("Code Mode request overrides are sent only when their feature flags allow them", async () => {
  const flagged = stubClient(seerSessionFixture, {
    features: ["seer-explorer", "seer-explorer-code-mode-tools"],
  });
  const h = await renderSeer(flagged.client, {
    user: { id: "1", email: "dev@sentry.io" },
    initialSeerCodeModeByOrg: { acme: "off" },
  });
  try {
    await h.waitForFrame((frame) => frame.includes("standard tools"));
    await h.press((input) => input.pressKey("inspect checkout"));
    await h.press((input) => input.pressEnter());
    expect(flagged.sent[0]).toMatchObject({
      override_code_mode_enable: "off",
      page_name: "seer.ask",
    });
    expect(flagged.sent[0]?.["sent_at"]).toBeArray();
  } finally {
    await h.cleanup();
  }

  const unflagged = stubClient(seerSessionFixture, { features: ["seer-explorer"] });
  const other = await renderSeer(unflagged.client, {
    user: { id: "1", email: "dev@sentry.io" },
    initialSeerCodeModeByOrg: { acme: "on" },
  });
  try {
    await other.press((input) => input.pressKey("inspect checkout"));
    await other.press((input) => input.pressEnter());
    expect(unflagged.sent[0]).not.toHaveProperty("override_code_mode_enable");
    expect(unflagged.sent[0]).not.toHaveProperty("override_bash_mode_enabled");
  } finally {
    await other.cleanup();
  }
});

test("the slash menu exposes only feature-gated employee commands", async () => {
  const stub = stubClient(seerSessionFixture, {
    features: [
      "seer-explorer",
      "seer-explorer-code-mode-tools",
      "seer-explorer-allow-bash-mode",
      "seer-explorer-thinking-blocks",
    ],
  });
  const h = await renderSeer(stub.client, { user: { id: "1", email: "dev@sentry.io" } });
  try {
    await h.waitForFrame((frame) => frame.includes("Code Mode only"));
    await h.press((input) => input.typeText("/"));
    const frame = h.frame();
    expect(frame).toContain("/new");
    expect(frame).toContain("/code-mode-only");
    expect(frame).toContain("/bash-mode-on");
    expect(frame).toContain("/thinking-on");
    expect(frame).not.toContain("/conversations");
  } finally {
    await h.cleanup();
  }
});

test("recent Seer conversations can be opened from history", async () => {
  const stub = stubClient(seerSessionFixture, {
    features: ["seer-explorer"],
    runs: [
      {
        id: "older-run",
        title: "Investigate checkout latency",
        dateCreated: "2026-08-24T10:00:00Z",
        lastTriggeredAt: "2026-08-24T11:00:00Z",
      },
    ],
  });
  const h = await renderSeer(stub.client);
  try {
    await h.pressEscape();
    await h.press((input) => input.pressKey("H", { shift: true }));
    await h.waitForFrame((frame) => frame.includes("Investigate checkout latency"));
    expect(h.frame()).toContain("Recent conversations");
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("Checkout fails when the cart is empty"));
  } finally {
    await h.cleanup();
  }
});

test("the employee /conversations command opens the conversations screen", async () => {
  const stub = stubClient(seerSessionFixture, { features: ["seer-explorer"] });
  const h = await renderSeer(stub.client, { user: { id: "1", email: "dev@sentry.io" } });
  try {
    await h.press((input) => input.pressKey("show my runs"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("Checkout fails when the cart is empty"));
    await h.press((input) => input.typeText("/conversations"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("No conversations found"));
    expect(h.frame()).not.toContain("Seer Agent");
    expect(h.frame()).toContain('gen_ai.conversation.id:"run-uuid"');
  } finally {
    await h.cleanup();
  }
});

test("assistant Markdown, rich embeds, and Code Mode call records render as UI", async () => {
  const richSession = {
    ...seerSessionFixture,
    blocks: [
      seerSessionFixture.blocks[0]!,
      {
        id: "code-mode",
        message: {
          role: "tool_use" as const,
          content: null,
          tool_calls: [{ function: "sentry_api_execute", id: "execute-1", args: "{}" }],
        },
        timestamp: "2026-08-20T12:00:01Z",
        tool_results: [
          {
            content: "",
            tool_call_function: "sentry_api_execute",
            tool_call_id: "execute-1",
            structuredContent: {
              calls: [
                {
                  id: 1,
                  kind: "api" as const,
                  title: "Get highest priority issues",
                  method: "GET",
                  resolved_path: "/api/0/organizations/acme/issues/",
                  status: 200,
                },
              ],
              todos: [{ content: "Compare issue impact", status: "completed" as const }],
            },
          },
        ],
      },
      {
        id: "markdown-answer",
        message: {
          role: "assistant" as const,
          content: [
            "# Root cause",
            "",
            "The **checkout** path has one clear regression:",
            "",
            "- `total` is undefined",
            "",
            '{% chart %}{"title":"Error volume","series":[{"label":"Errors","data":[{"x":"a","y":1},{"x":"b","y":4},{"x":"c","y":2}]}]}{% /chart %}',
          ].join("\n"),
        },
        timestamp: "2026-08-20T12:00:03Z",
      },
    ],
  };
  const stub = stubClient(richSession, {
    features: ["seer-explorer", "seer-explorer-code-mode-tools", "seer-explorer-embeds"],
  });
  const h = await renderSeer(stub.client);
  try {
    await h.press((input) => input.pressKey("what happened"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("Get highest priority issues"));
    const frame = h.frame();
    expect(frame).toContain("Compare issue impact");
    expect(frame).toContain("Root cause");
    expect(frame).toContain("checkout");
    expect(frame).toContain("total");
    expect(frame).toContain("Error volume");
    expect(frame).not.toContain("{% chart %}");
  } finally {
    await h.cleanup();
  }
});

test("accepted Code Mode changes can create or update pull requests", async () => {
  const codeSession = {
    ...seerSessionFixture,
    blocks: [
      ...seerSessionFixture.blocks,
      {
        id: "patches",
        message: { role: "tool_use" as const, content: null, tool_calls: [] },
        timestamp: "2026-08-20T12:00:04Z",
        merged_file_patches: [
          {
            repo_name: "getsentry/checkout",
            diff: "+guard",
            patch: { path: "src/checkout.ts", added: 2, removed: 1 },
          },
        ],
      },
    ],
    repo_pr_states: {},
  };
  const stub = stubClient(codeSession, {
    features: ["seer-explorer", "seer-explorer-code-mode-tools"],
  });
  const h = await renderSeer(stub.client);
  try {
    await h.press((input) => input.pressKey("fix checkout"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("getsentry/checkout"));
    expect(h.frame()).toContain("+2 -1  src/checkout.ts");
    expect(h.frame()).toContain("No PR yet");

    await h.pressEscape();
    await h.press((input) => input.pressKey("p"));
    await h.wait(10);
    expect(stub.updates[0]).toEqual({
      payload: { type: "create_pr", repo_name: "getsentry/checkout" },
    });
  } finally {
    await h.cleanup();
  }
});

test("Code Mode write approvals use the trusted pending input and resume the run", async () => {
  const approvalSession = {
    ...seerSessionFixture,
    status: "awaiting_user_input" as const,
    blocks: [
      seerSessionFixture.blocks[0]!,
      {
        id: "approval",
        message: {
          role: "tool_use" as const,
          content: null,
          tool_calls: [{ function: "sentry_api_execute", id: "execute-1", args: "{}" }],
        },
        timestamp: "2026-08-20T12:00:04Z",
        tool_results: [
          {
            content: "{% agentWriteApproval /%}",
            tool_call_function: "sentry_api_execute",
            tool_call_id: "execute-1",
            structuredContent: {
              agentWriteApproval: {
                inputId: "approval-input",
                requiredScopes: ["project:write"],
                sessionId: "display-only-session",
                status: "pending",
              },
            },
          },
        ],
      },
    ],
    pending_user_input: {
      id: "approval-input",
      input_type: "agent_write_approval" as const,
      data: { required_scopes: ["project:write"], session_id: "trusted-session" },
    },
  };
  const stub = stubClient(approvalSession, {
    features: ["seer-explorer", "seer-explorer-code-mode-tools", "seer-explorer-embeds"],
  });
  const h = await renderSeer(stub.client);
  try {
    await h.press((input) => input.pressKey("make the fix"));
    await h.press((input) => input.pressEnter());
    await h.waitForFrame((frame) => frame.includes("Allow Seer to make changes?"));
    expect(h.frame()).not.toContain("{% agentWriteApproval");

    await h.press((input) => input.pressKey("y"));
    await h.wait(10);
    expect(stub.approvals).toEqual([{ sessionId: "trusted-session", scopes: ["project:write"] }]);
    expect(stub.updates).toContainEqual({
      payload: {
        type: "user_input_response",
        input_id: "approval-input",
        response_data: { decision: "approve" },
      },
    });
  } finally {
    await h.cleanup();
  }
});

test("the optimistic thinking spinner and text share one row", async () => {
  const stub = stubClient(seerSessionFixture, { holdPost: true });
  const h = await renderSeer(stub.client);
  try {
    await h.press((input) => input.pressKey("hello"));
    await h.press((input) => input.pressEnter());
    const thinkingLine = h
      .frame()
      .split("\n")
      .find((line) => line.includes("Looking around…"));
    expect(thinkingLine).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Looking around…/);
  } finally {
    await h.cleanup();
  }
});
