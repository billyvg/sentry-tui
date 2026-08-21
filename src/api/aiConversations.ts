/**
 * Explore › Conversations — the gen-AI conversation list.
 *
 * Not a Discover query, despite what
 * `docs/plans/002-explore-dashboards-monitors.md` §7.2 says. The web serves
 * this list from `GET /organizations/{org}/ai-conversations/`
 * (`views/explore/conversations/hooks/useConversations.tsx`), which rolls the
 * gen-AI spans of a trace up into one row per *conversation*: a title, how
 * long it took, how many model calls and tool calls it made, what it cost.
 * Querying `dataset=spans` instead gives one row per model call, which is a
 * different and much less useful screen.
 *
 * The chart above the table is still Discover — upstream plots
 * `count_unique(gen_ai.conversation.id)` over spans
 * (`conversationsChart.tsx:51-52`) while the table comes from here, and this
 * screen does the same.
 *
 * Read-only, and manual-refresh only: nothing here polls.
 */

import type { SentryClient } from "~/api/client";

/** Who the conversation was with, when the SDK reported a user at all. */
export interface ConversationUser {
  id?: string;
  email?: string;
  username?: string;
  ipAddress?: string;
}

/** One conversation: every gen-AI span of a trace, rolled into a row. */
export interface Conversation {
  id: string;
  /** AI-generated summary. Absent until title generation has run, if ever. */
  title?: string;
  /** The first user message, which stands in for a missing title. */
  firstInput?: string;
  /** The model's last reply. */
  lastOutput?: string;
  /** Summed duration of the conversation's `ai_client` spans, ms. */
  generationDurationMs: number;
  /** Wall-clock span of the whole conversation, ms. */
  durationMs: number;
  /** ISO-8601 instant the conversation ended, for the age column. */
  endedAt: string;
  /** Model calls made. */
  llmCalls: number;
  toolCalls: number;
  toolErrors: number;
  /** Distinct tools invoked, in the order the API returned them. */
  toolNames: string[];
  errors: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  /** Total cost in USD, or `undefined` when the API reported none. */
  totalCost?: number;
  traceCount: number;
  traceIds: string[];
  projectId?: string;
  user?: ConversationUser;
}

export const CONVERSATION_PAGE_SIZE = 50;

export interface ListConversationsParams {
  org: string;
  /** Search query in Sentry's search syntax, applied to the gen-AI spans. */
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/** Fetch the conversation list, newest first. */
export async function listConversations(
  client: SentryClient,
  {
    org,
    query = "",
    statsPeriod,
    project,
    environment,
    cursor,
    limit = CONVERSATION_PAGE_SIZE,
    signal,
  }: ListConversationsParams,
): Promise<{ data: Conversation[]; nextCursor: string | null }> {
  const page = await client.request<RawConversation[]>(`/organizations/${org}/ai-conversations/`, {
    query: {
      query: query || undefined,
      statsPeriod,
      project,
      environment,
      cursor,
      per_page: limit,
      referrer: "sentry-tui.explore-conversations",
    },
    signal,
  });

  const rows = Array.isArray(page.data) ? page.data : [];
  return {
    // The web sorts client-side too: the endpoint's order is not guaranteed,
    // and a list of conversations reads newest-first like every other stream
    // in the app.
    data: rows.map(normalise).sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)),
    nextCursor: page.nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/**
 * A message payload as the endpoint sends it: a plain string from some SDKs,
 * a list of typed parts from others.
 */
type RawMessage = string | Array<{ type?: string; text?: string }> | null | undefined;

interface RawConversation {
  conversationId?: string;
  title?: string | null;
  firstInput?: RawMessage;
  lastOutput?: RawMessage;
  generationDuration?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  llmCalls?: number;
  toolCalls?: number;
  toolErrors?: number;
  toolNames?: string[];
  errors?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number | null;
  traceCount?: number;
  traceIds?: string[];
  projectId?: number | null;
  user?: {
    id?: string | null;
    email?: string | null;
    username?: string | null;
    ip_address?: string | null;
  } | null;
}

function normalise(raw: RawConversation, index: number): Conversation {
  const start = raw.startTimestamp ?? 0;
  const end = raw.endTimestamp ?? start;
  return {
    id: raw.conversationId ?? String(index),
    title: text(raw.title),
    firstInput: messageText(raw.firstInput),
    lastOutput: messageText(raw.lastOutput),
    generationDurationMs: raw.generationDuration ?? 0,
    durationMs: Math.max(0, end - start),
    // Timestamps are epoch milliseconds here, unlike the ISO strings every
    // other endpoint in the app returns — converted at the boundary so the
    // UI has one kind of timestamp to think about.
    endedAt: end > 0 ? new Date(end).toISOString() : "",
    llmCalls: raw.llmCalls ?? 0,
    toolCalls: raw.toolCalls ?? 0,
    toolErrors: raw.toolErrors ?? 0,
    toolNames: Array.isArray(raw.toolNames) ? raw.toolNames.filter(isNonEmpty) : [],
    errors: raw.errors ?? 0,
    totalTokens: raw.totalTokens ?? 0,
    inputTokens: raw.inputTokens ?? 0,
    outputTokens: raw.outputTokens ?? 0,
    totalCost: typeof raw.totalCost === "number" ? raw.totalCost : undefined,
    traceCount: raw.traceCount ?? 0,
    traceIds: Array.isArray(raw.traceIds) ? raw.traceIds.filter(isNonEmpty) : [],
    projectId: raw.projectId == null ? undefined : String(raw.projectId),
    user: normaliseUser(raw.user),
  };
}

/**
 * The readable part of a message payload.
 *
 * Both encodings are handled because both are in the wild: the first text part
 * of a structured message, else the string itself.
 */
function messageText(raw: RawMessage): string | undefined {
  if (typeof raw === "string") return text(raw);
  if (!Array.isArray(raw)) return undefined;
  return text(raw.find((part) => part?.type === "text")?.text ?? raw[0]?.text);
}

/**
 * `null`, `"none"` and the empty string all mean "the SDK did not report one"
 * (`normalizeUserField` in `conversationsTable.tsx`), so they collapse to
 * `undefined` rather than reaching the UI as text to render.
 */
function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return undefined;
  return trimmed;
}

function normaliseUser(raw: RawConversation["user"]): ConversationUser | undefined {
  if (!raw) return undefined;
  const user: ConversationUser = {
    id: text(raw.id),
    email: text(raw.email),
    username: text(raw.username),
    ipAddress: text(raw.ip_address),
  };
  return Object.values(user).some(Boolean) ? user : undefined;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * What to call a conversation: its generated title, else the first thing the
 * user said, else nothing — the caller supplies the placeholder.
 *
 * Mirrors `getConversationTitle` (`conversationsTable.tsx:319`), minus the
 * markdown flattening: a terminal row is one line, so whitespace collapses and
 * the width does the rest.
 */
export function conversationTitle(conversation: Conversation): string | undefined {
  const raw = conversation.title ?? conversation.firstInput;
  return raw ? raw.replace(/\s+/g, " ").trim() || undefined : undefined;
}

/** UUID pattern, for ids worth shortening. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A conversation id short enough for a row.
 *
 * `getConversationIdLabel` (`:338`): UUIDs get an eight-character prefix,
 * anything else (`resp_…`, `slack:1234`) is already short.
 */
export function conversationIdLabel(id: string): string {
  return UUID.test(id) ? id.slice(0, 8) : id;
}

/**
 * The name to show for whoever was talking, in the web's own precedence
 * (`getUserDisplayName`, `conversationsTable.tsx:100`).
 */
export function conversationUserLabel(user: ConversationUser | undefined): string | undefined {
  if (!user) return undefined;
  return user.email ?? user.username ?? user.ipAddress ?? undefined;
}
