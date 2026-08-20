import type { SeerBlock, SeerSession } from "~/api/seer";

/** A user turn, as the API returns it once the server has recorded it. */
export const userBlockFixture: SeerBlock = {
  id: "block-user-1",
  message: { role: "user", content: "Why is checkout failing?" },
  timestamp: "2026-08-20T12:00:00.000000",
};

/** A tool-use turn — the running commentary Seer emits while working. */
export const toolBlockFixture: SeerBlock = {
  id: "block-tool-1",
  message: {
    role: "tool_use",
    content: null,
    tool_calls: [
      {
        function: "code_search",
        id: "call-1",
        args: JSON.stringify({ mode: "read_file", path: "checkout.py", repo_name: "acme/store" }),
      },
    ],
  },
  timestamp: "2026-08-20T12:00:01.000000",
  tool_links: [{ kind: "code_search", params: { is_error: false } }],
};

/** A finished tool call that failed, for the failure glyph. */
export const failedToolBlockFixture: SeerBlock = {
  id: "block-tool-2",
  message: {
    role: "tool_use",
    content: null,
    tool_calls: [
      {
        function: "get_issue_details",
        id: "call-2",
        args: JSON.stringify({ issue_id: "PROJ-42" }),
      },
    ],
  },
  timestamp: "2026-08-20T12:00:02.000000",
  tool_links: [{ kind: "get_issue_details", params: { is_error: true } }],
};

export const assistantBlockFixture: SeerBlock = {
  id: "block-assistant-1",
  message: {
    role: "assistant",
    content: "Checkout fails when the cart is empty because `total` is undefined.",
  },
  timestamp: "2026-08-20T12:00:03.000000",
};

/**
 * A settled conversation. `updated_at` is stamped far in the future so the
 * staleness check can't misfire during a test run.
 */
export const seerSessionFixture: SeerSession = {
  status: "completed",
  updated_at: "2999-01-01T00:00:00.000000",
  blocks: [userBlockFixture, toolBlockFixture, assistantBlockFixture],
};

/** The same run mid-flight, with a block still loading. */
export const seerProcessingSessionFixture: SeerSession = {
  status: "processing",
  updated_at: "2999-01-01T00:00:00.000000",
  blocks: [userBlockFixture, { ...toolBlockFixture, loading: true }],
};
