/**
 * Wire-format fixtures for `/organizations/{org}/ai-conversations/`.
 *
 * Shapes taken from a live response: epoch-millisecond timestamps, `totalCost`
 * that can be zero or null, a `title` that is often absent, and `firstInput`
 * in both the plain-string and structured-parts encodings.
 */

/** 2026-08-21T00:00:00Z, so ages are stable relative to each other. */
const BASE_MS = 1_787_270_400_000;

export const rawConversationsFixture: unknown[] = [
  {
    conversationId: "1677a6b8-10cc-495c-8a30-0a9642b57094",
    title: "Payment declined due to insufficient funds",
    firstInput: "Why did this checkout fail?",
    lastOutput: "The card issuer declined the charge for insufficient funds.",
    projectId: 6178942,
    errors: 0,
    llmCalls: 4,
    toolCalls: 2,
    toolErrors: 0,
    toolNames: ["search_docs", "fetch_order"],
    totalTokens: 2462,
    inputTokens: 2100,
    outputTokens: 362,
    totalCost: 0.0006655,
    generationDuration: 834.5,
    startTimestamp: BASE_MS - 3000,
    endTimestamp: BASE_MS,
    traceCount: 1,
    traceIds: ["0b7419b0d4b54156ad5be964425efa1a"],
    user: { id: "448786", email: "ada@example.com", username: null, ip_address: null },
  },
  {
    conversationId: "9c02f1ee-77aa-4c0d-9a11-3b6c5d4e2f88",
    // No generated title: the first message stands in for it, and this one
    // arrives in the structured-parts encoding.
    title: null,
    firstInput: [{ type: "text", text: "Summarise\n  the last four deploys" }],
    lastOutput: "Four deploys since Tuesday, two of them reverts.",
    projectId: 11276,
    errors: 3,
    llmCalls: 12,
    toolCalls: 7,
    toolErrors: 1,
    toolNames: ["list_deploys", "read_commit", "diff_release", "post_summary"],
    totalTokens: 18_400,
    inputTokens: 16_900,
    outputTokens: 1500,
    totalCost: 0.0184,
    generationDuration: 12_480,
    startTimestamp: BASE_MS - 600_000,
    endTimestamp: BASE_MS - 540_000,
    traceCount: 3,
    traceIds: ["aa11", "bb22", "cc33"],
    user: { id: null, email: null, username: null, ip_address: "10.0.0.4" },
  },
  {
    // Nothing to show but the id: no title, no first message, no user, no
    // cost. The row still has to render.
    conversationId: "resp_8f31c",
    title: null,
    firstInput: null,
    lastOutput: null,
    projectId: null,
    errors: 0,
    llmCalls: 1,
    toolCalls: 0,
    toolErrors: 0,
    toolNames: [],
    totalTokens: 24,
    inputTokens: 20,
    outputTokens: 4,
    totalCost: 0,
    generationDuration: 435,
    startTimestamp: BASE_MS - 1_200_000,
    endTimestamp: BASE_MS - 1_199_565,
    traceCount: 1,
    traceIds: [],
    user: { id: null, email: null, username: "none", ip_address: null },
  },
];
