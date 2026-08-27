/**
 * Seer Explorer — the conversational agent behind the web app's "Ask Seer".
 *
 * Mirrors `sentry/static/app/views/seerExplorer`. A conversation is a *run*:
 * POST a query to start one, then poll its state until the session settles.
 * The web client layers a Conduit push channel on top of that poll purely as
 * an accelerator; polling is the source of truth, so the TUI only polls.
 */

import type { SentryClient } from "~/api/client";

/** How often to re-poll a run that is still processing. */
export const SEER_POLL_INTERVAL_MS = 500;
/** Slower cadence after the server starts returning 5xx. */
export const SEER_ERROR_POLL_INTERVAL_MS = 2500;
/** A run whose `updated_at` is this stale is considered timed out. */
export const SEER_STALE_TIMEOUT_MS = 120_000;

/** Runs are keyed by a UUID (`sentry_run_id`) or a legacy numeric id. */
export type SeerRunId = string | number;

/** The server-side tool selection exposed by Seer's employee slash commands. */
export type SeerCodeMode = "off" | "on" | "only";

export type SeerRole = "user" | "assistant" | "tool_use";

export type SeerSessionStatus = "processing" | "completed" | "error" | "awaiting_user_input";

export interface SeerToolCall {
  /** JSON-encoded argument object. */
  args: string;
  /** Tool name, e.g. `code_search`, `telemetry_live_search`. */
  function: string;
  id?: string | null;
}

export interface SeerMessage {
  content: string | null;
  role: SeerRole;
  thinking_content?: string | null;
  tool_calls?: SeerToolCall[] | null;
}

/**
 * A deep link the agent attached to a tool call, plus the flags the web UI
 * reads to decide a tool row's status.
 */
export interface SeerToolLink {
  kind: string;
  params?: {
    is_error?: boolean;
    empty_results?: boolean;
    pending_approval?: boolean;
    pending_question?: boolean;
    summary?: string;
    short_id?: string;
    mode?: string;
    [key: string]: unknown;
  } | null;
}

/** One Sentry API or library call made inside a Code Mode execute. */
export interface SeerCallRecord {
  id: number;
  kind: "api" | "lib";
  body?: string;
  body_truncated?: boolean;
  error?: string;
  method?: string;
  name?: string;
  params?: Record<string, unknown>;
  parent?: number | null;
  path?: string;
  path_params?: Record<string, string>;
  resolved_path?: string;
  status?: number;
  title?: string;
}

/** An artifact created by either a classic tool or Code Mode. */
export interface SeerArtifact {
  data: Record<string, unknown> | null;
  key: string;
  reason: string;
}

export interface SeerFilePatch {
  diff: string;
  repo_name: string;
  patch: {
    path: string;
    added: number;
    removed: number;
    [key: string]: unknown;
  };
}

export interface SeerRepoPRState {
  branch_name: string | null;
  commit_sha: string | null;
  pr_creation_error: string | null;
  pr_creation_status: "creating" | "completed" | "error" | (string & {}) | null;
  pr_id: number | null;
  pr_number: number | null;
  pr_url: string | null;
  repo_name: string;
  title: string | null;
}

export interface SeerTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** Result aligned to a tool call by id, including Code Mode's effects bus. */
export interface SeerToolResult {
  content: string;
  tool_call_function: string;
  tool_call_id: string;
  structuredContent?: {
    agentWriteApproval?: Record<string, unknown>;
    artifacts?: SeerArtifact[];
    calls?: SeerCallRecord[];
    links?: SeerToolLink[];
    todos?: SeerTodoItem[];
  } | null;
}

/** One turn in the conversation. */
export interface SeerBlock {
  id: string;
  message: SeerMessage;
  timestamp: string;
  loading?: boolean;
  todos?: SeerTodoItem[] | null;
  /** Positionally aligned with `message.tool_calls`. */
  tool_links?: Array<SeerToolLink | null> | null;
  /** In-flight calls mirrored before a Code Mode execute returns its result. */
  live_calls?: SeerCallRecord[] | null;
  /** Positionally independent results correlated through `tool_call_id`. */
  tool_results?: Array<SeerToolResult | null> | null;
  artifacts?: SeerArtifact[] | null;
  file_patches?: SeerFilePatch[] | null;
  merged_file_patches?: SeerFilePatch[] | null;
  pr_commit_shas?: Record<string, string> | null;
}

export interface SeerPendingUserInput {
  id: string;
  input_type:
    | "file_change_approval"
    | "agent_write_approval"
    | "ask_user_question"
    | "reauth_monitoring_provider";
  data: Record<string, unknown>;
}

export interface SeerSession {
  blocks: SeerBlock[];
  status: SeerSessionStatus;
  updated_at: string;
  owner_user_id?: number | null;
  pending_user_input?: SeerPendingUserInput | null;
  repo_pr_states?: Record<string, SeerRepoPRState>;
}

/** One recent Explorer run returned by the shared Seer run index. */
export interface SeerRun {
  id: string;
  title: string | null;
  dateCreated: string;
  lastTriggeredAt: string;
}

/** GET response — `session` is null (with a 404) for an unknown run. */
interface SeerStateResponse {
  session: SeerSession | null;
  sentry_run_id?: string | null;
}

/** POST response when starting or continuing a run. */
interface SeerChatResponse {
  run_id: number;
  sentry_run_id?: string | null;
}

/** Prefer the UUID the server returns; fall back to the numeric run id. */
function pickRunId(response: SeerChatResponse): SeerRunId {
  return response.sentry_run_id ?? response.run_id;
}

const basePath = (org: string) => `/organizations/${org}/seer/explorer-chat/`;
const runPath = (org: string, runId: SeerRunId) =>
  `${basePath(org)}${encodeURIComponent(String(runId))}/`;

export interface SendSeerMessageParams {
  org: string;
  query: string;
  /**
   * Where in the conversation the message lands. Sending at an index below
   * `blocks.length` truncates the run from that point, which is how the web
   * app implements "edit and resend".
   */
  insertIndex?: number;
  /** Existing run to continue; omit to start a fresh conversation. */
  runId?: SeerRunId | null;
  /** Route the user is "on", surfaced to the agent as context. */
  pageName?: string;
  /** Display timestamps, local first and UTC second, matching the web request. */
  sentAt?: string[];
  /** Feature-gated employee override; omitted when the flag is unavailable. */
  codeMode?: SeerCodeMode;
  /** Feature-gated employee override; omitted when the flag is unavailable. */
  bashMode?: boolean;
  signal?: AbortSignal;
}

/**
 * Send a message, starting a run when `runId` is absent and continuing it
 * otherwise. Returns the run id to poll.
 */
export async function sendSeerMessage(
  client: SentryClient,
  {
    org,
    query,
    insertIndex,
    runId,
    pageName,
    sentAt,
    codeMode,
    bashMode,
    signal,
  }: SendSeerMessageParams,
): Promise<SeerRunId> {
  const page = await client.request<SeerChatResponse>(
    runId == null ? basePath(org) : runPath(org, runId),
    {
      method: "POST",
      body: {
        query,
        insert_index: insertIndex,
        page_name: pageName,
        sent_at: sentAt,
        override_code_mode_enable: codeMode,
        override_bash_mode_enabled: bashMode,
      },
      signal,
    },
  );
  return pickRunId(page.data);
}

/** List the current user's recent Explorer conversations. */
export async function listSeerRuns(
  client: SentryClient,
  { org, signal, limit = 20 }: { org: string; signal?: AbortSignal; limit?: number },
): Promise<SeerRun[]> {
  const page = await client.request<SeerRun[]>(`/organizations/${org}/seer/runs/`, {
    query: { per_page: limit, query: "is:mine type:explorer" },
    signal,
  });
  return page.data;
}

/** Poll a run's current state. Returns null when the run no longer exists. */
export async function getSeerSession(
  client: SentryClient,
  { org, runId, signal }: { org: string; runId: SeerRunId; signal?: AbortSignal },
): Promise<SeerSession | null> {
  const page = await client.request<SeerStateResponse>(runPath(org, runId), { signal });
  return page.data?.session ?? null;
}

/**
 * Ask the agent to wind down the current turn.
 *
 * The server accepts this asynchronously (202) — the run keeps reporting
 * `processing` until it actually stops, so callers must keep polling.
 */
export async function interruptSeerRun(
  client: SentryClient,
  { org, runId, signal }: { org: string; runId: SeerRunId; signal?: AbortSignal },
): Promise<void> {
  await client.request(
    `/organizations/${org}/seer/explorer-update/${encodeURIComponent(String(runId))}/`,
    {
      method: "POST",
      body: { payload: { type: "interrupt" } },
      signal,
    },
  );
}

/** Respond to an approval or question that paused the current run. */
export async function respondToSeerInput(
  client: SentryClient,
  {
    org,
    runId,
    inputId,
    responseData,
    signal,
  }: {
    org: string;
    runId: SeerRunId;
    inputId: string;
    responseData?: Record<string, unknown>;
    signal?: AbortSignal;
  },
): Promise<void> {
  await client.request(
    `/organizations/${org}/seer/explorer-update/${encodeURIComponent(String(runId))}/`,
    {
      method: "POST",
      body: {
        payload: {
          type: "user_input_response",
          input_id: inputId,
          response_data: responseData,
        },
      },
      signal,
    },
  );
}

/** Create or update a pull request for one repository's accepted Code Mode patches. */
export async function createSeerPR(
  client: SentryClient,
  {
    org,
    runId,
    repoName,
    signal,
  }: { org: string; runId: SeerRunId; repoName: string; signal?: AbortSignal },
): Promise<void> {
  await client.request(
    `/organizations/${org}/seer/explorer-update/${encodeURIComponent(String(runId))}/`,
    {
      method: "POST",
      body: { payload: { type: "create_pr", repo_name: repoName } },
      signal,
    },
  );
}

/** Request the short-lived capability scopes required for a Code Mode write. */
export async function approveSeerWrite(
  client: SentryClient,
  {
    org,
    sessionId,
    scopes,
    signal,
  }: { org: string; sessionId: string; scopes: string[]; signal?: AbortSignal },
): Promise<string[]> {
  const page = await client.request<{ scopes: string[] }>(`/organizations/${org}/agent/approve/`, {
    method: "POST",
    body: { sessionId, scopes },
    signal,
  });
  return page.data.scopes;
}

/**
 * True when a session has nothing left in flight — the poll-stop condition
 * from `useSeerExplorerPolling`.
 */
export function isSessionSettled(session: SeerSession | null | undefined): boolean {
  if (!session) return false;
  if (session.status === "processing") return false;
  return !session.blocks.some((block) => block.loading);
}

/**
 * Parse a Seer timestamp. The API emits naive ISO strings that are UTC, so a
 * missing zone designator has to be supplied — otherwise the runtime reads
 * them as local time and every run west of UTC looks hours stale.
 */
function parseTimestamp(value: string): number {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

/** Whether the run has gone quiet long enough to call it timed out. */
export function isSessionStale(session: SeerSession | null | undefined, now: number): boolean {
  if (!session) return false;
  const updatedAt = parseTimestamp(session.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  return now - updatedAt >= SEER_STALE_TIMEOUT_MS;
}
