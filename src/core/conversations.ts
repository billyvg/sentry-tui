/**
 * Explore › Conversations — the bits of its configuration worth unit-testing.
 *
 * Conversations is deliberately *not* in `core/exploreTables.ts`: it is not a
 * Discover table. Its rows come from `/organizations/{org}/ai-conversations/`,
 * which pre-aggregates gen-AI spans into one row per conversation, so it has
 * no `dataset`, no `field[]` and no flat rows to reshape. Forcing it into the
 * one-component-four-configs pattern would have meant giving that config table
 * a discriminator and the component a branch — which is the pattern paying for
 * a screen rather than the other way round.
 *
 * What the two screens *do* share is the chart, which upstream keeps on
 * Discover even though the table is not (`conversationsChart.tsx:51-52`).
 */

/** Spans belonging to a conversation, as the web's own chart filters them. */
export const CONVERSATION_SPAN_FILTER = "has:gen_ai.conversation.id";

/**
 * The chart above the table: the web's "Individual Chats" series, which counts
 * conversations rather than the model calls inside them
 * (`conversationsChart.tsx:66-69`).
 */
export const CONVERSATION_CHART = {
  yAxis: "count_unique(gen_ai.conversation.id)",
  /** What a bar counts, for the total beside the title. */
  noun: "conversations",
} as const;

/** What a row is called, for the status bar and the row count. */
export const CONVERSATION_NOUN = "conversations";

/** The organization feature this screen sits behind. */
export const CONVERSATION_FEATURE = "gen-ai-conversations";

/**
 * Empty-state copy.
 *
 * The feature is flagged and we cannot read an org's flags, so an empty list
 * may mean "not enabled" rather than "nothing matched" — it says both, and
 * never claims there is nothing to see.
 */
export function conversationEmptyLines(query: string): Array<string | undefined> {
  return [
    query || undefined,
    "Try widening the time range or adjusting the query.",
    `This organization may not have ${CONVERSATION_FEATURE} enabled.`,
  ];
}
