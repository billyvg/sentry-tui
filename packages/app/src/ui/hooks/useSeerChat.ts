import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { ApiError, type SentryClient } from "~/api/client";
import {
  approveSeerWrite,
  createSeerPR,
  getSeerSession,
  interruptSeerRun,
  isSessionSettled,
  isSessionStale,
  listSeerRuns,
  respondToSeerInput,
  sendSeerMessage,
  SEER_ERROR_POLL_INTERVAL_MS,
  SEER_POLL_INTERVAL_MS,
  type SeerBlock,
  type SeerCodeMode,
  type SeerPendingUserInput,
  type SeerRepoPRState,
  type SeerRunId,
  type SeerRun,
} from "~/api/seer";
import {
  errorOf,
  idle,
  rejected,
  resolved,
  startLoading,
  valueOf,
  type AsyncError,
  type AsyncStatus,
} from "~/core/async";
import { SEER_THINKING_PLACEHOLDERS, summarizeSeerCodeChanges } from "~/core/seer";
import type { SeerCapabilities, SeerCodeChange } from "~/core/seer";
import { initialSeerConversationState, seerConversationReducer } from "~/ui/hooks/seerChatState";

/** Give up on a run after roughly a minute of consecutive server errors. */
const MAX_ERROR_POLLS = Math.ceil(60_000 / SEER_ERROR_POLL_INTERVAL_MS);

function toAsyncError(error: unknown): AsyncError {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export interface SeerChatState {
  /** Conversation to render — server blocks, or the optimistic stand-in. */
  blocks: SeerBlock[];
  /** True while a turn is in flight, so the composer shows an interrupt. */
  thinking: boolean;
  /** The run stopped reporting progress; the user should try again. */
  timedOut: boolean;
  /** An interrupt was requested but the run hasn't wound down yet. */
  interrupting: boolean;
  error?: AsyncError;
  /** Whether a conversation exists at all, for the empty state. */
  started: boolean;
  runId: SeerRunId | null;
  /** Current run belongs to another user and cannot be continued. */
  readOnly: boolean;
  pendingInput: SeerPendingUserInput | null;
  repoPRStates: Record<string, SeerRepoPRState>;
  codeChanges: SeerCodeChange[];
  capabilities: SeerCapabilities;
  codeMode: SeerCodeMode;
  bashMode: boolean;
  showThinking: boolean;
  runs: AsyncStatus<SeerRun[]>;
  send: (query: string) => void;
  interrupt: () => void;
  reset: () => void;
  switchRun: (runId: SeerRunId) => void;
  loadRuns: () => void;
  respond: (inputId: string, responseData?: Record<string, unknown>) => void;
  approveWrite: (inputId: string, sessionId: string, scopes: string[]) => void;
  createPR: (repoName: string) => void;
  setCodeMode: (mode: SeerCodeMode) => void;
  setBashMode: (enabled: boolean) => void;
  setShowThinking: (enabled: boolean) => void;
}

export interface SeerChatOptions {
  features?: readonly string[];
  isEmployee?: boolean;
  pageName?: string;
  userId?: string;
  codeMode?: SeerCodeMode;
  bashMode?: boolean;
  showThinking?: boolean;
  onCodeModeChange?: (mode: SeerCodeMode) => void;
  onBashModeChange?: (enabled: boolean) => void;
  onShowThinkingChange?: (enabled: boolean) => void;
}

/** Test one API-exposed feature name without restating the organization prefix. */
function hasFeature(features: readonly string[] | undefined, name: string): boolean {
  return features?.includes(name) === true;
}

/**
 * Drive one Seer Explorer conversation.
 *
 * Sending is optimistic — the user's message and a placeholder answer appear
 * immediately, because the POST only returns a run id and the real blocks
 * arrive on a later poll. The optimistic array stays on screen until the
 * server's own block list has caught up to it, which avoids the message
 * visibly vanishing and reappearing between the POST and the first poll.
 */
export function useSeerChat(
  client: SentryClient | null,
  org: string,
  options: SeerChatOptions = {},
): SeerChatState {
  const [conversation, dispatch] = useReducer(
    seerConversationReducer,
    undefined,
    initialSeerConversationState,
  );
  const [runs, setRuns] = useState<AsyncStatus<SeerRun[]>>(idle);

  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  /** Monotonic counter for optimistic block ids and placeholder rotation. */
  const turnCount = useRef(0);
  const previousOrg = useRef(org);

  // A run id and its blocks are organization-scoped. Drop both immediately
  // when the app switches orgs so one customer's transcript never flashes in
  // another customer's screen.
  useEffect(() => {
    if (previousOrg.current === org) return;
    previousOrg.current = org;
    dispatch({ type: "orgChanged" });
    setRuns(idle);
  }, [org]);

  const capabilities = useMemo<SeerCapabilities>(
    () => ({
      // Keep the screen available while organization details load. Once the
      // server gives an explicit feature list, absence is authoritative.
      available: options.features === undefined || hasFeature(options.features, "seer-explorer"),
      bashMode: hasFeature(options.features, "seer-explorer-allow-bash-mode"),
      codeMode: hasFeature(options.features, "seer-explorer-code-mode-tools"),
      embeds: hasFeature(options.features, "seer-explorer-embeds"),
      employee: options.isEmployee === true,
      infraTelemetry: hasFeature(options.features, "seer-infra-telemetry"),
      streaming: hasFeature(options.features, "seer-explorer-stream"),
      thinking: hasFeature(options.features, "seer-explorer-thinking-blocks"),
    }),
    [options.features, options.isEmployee],
  );

  const codeMode = options.codeMode ?? "only";
  const bashMode = options.bashMode ?? false;
  const showThinking = capabilities.thinking && (options.showThinking ?? false);

  // Poll the run until it settles. A settled run simply stops rescheduling,
  // so an idle conversation costs nothing.
  useEffect(() => {
    if (!client || !org || conversation.runId == null) return;
    const runId = conversation.runId;

    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errorPolls = 0;

    const tick = async () => {
      try {
        const next = await getSeerSession(client, {
          org,
          runId,
          signal: controller.signal,
        });
        if (cancelled) return;
        errorPolls = 0;

        if (next) {
          const now = Date.now();
          if (isSessionSettled(next)) {
            dispatch({ type: "pollSettled", session: next, now });
            return;
          }
          if (isSessionStale(next, now)) {
            dispatch({ type: "pollStale", session: next, now });
            return;
          }
          dispatch({ type: "pollProgressed", session: next, now });
        }
        timer = setTimeout(() => void tick(), SEER_POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        errorPolls += 1;
        if (errorPolls > MAX_ERROR_POLLS) {
          dispatch({ type: "pollFailed", error: toAsyncError(error) });
          return;
        }
        timer = setTimeout(() => void tick(), SEER_ERROR_POLL_INTERVAL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, org, conversation.runId, conversation.pollToken]);

  const send = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!client || !org || trimmed === "" || !capabilities.available) return;

      const base = valueOf(conversationRef.current.session)?.blocks ?? [];
      const turn = turnCount.current++;
      const now = new Date().toISOString();
      const placeholder =
        SEER_THINKING_PLACEHOLDERS[turn % SEER_THINKING_PLACEHOLDERS.length] ?? "Thinking…";

      const optimistic: SeerBlock[] = [
        ...base,
        {
          id: `optimistic-user-${turn}`,
          message: { role: "user", content: trimmed },
          timestamp: now,
        },
        {
          id: `optimistic-assistant-${turn}`,
          message: { role: "assistant", content: placeholder },
          timestamp: now,
          loading: true,
        },
      ];
      dispatch({ type: "sendStarted", optimistic, now: Date.now() });

      const currentRun = conversationRef.current.runId;
      const sent = new Date();
      sendSeerMessage(client, {
        org,
        query: trimmed,
        runId: currentRun,
        insertIndex: base.length,
        pageName: options.pageName,
        sentAt: [sent.toString(), sent.toISOString()],
        codeMode: capabilities.codeMode ? codeMode : undefined,
        bashMode: capabilities.employee && capabilities.bashMode ? bashMode : undefined,
      })
        .then((id) => {
          dispatch({ type: "sendSucceeded", runId: id });
        })
        .catch((error: unknown) => {
          dispatch({ type: "sendFailed", error: toAsyncError(error) });
        });
    },
    [
      client,
      org,
      capabilities.available,
      capabilities.codeMode,
      capabilities.employee,
      capabilities.bashMode,
      options.pageName,
      codeMode,
      bashMode,
    ],
  );

  const interrupt = useCallback(() => {
    const currentRun = conversationRef.current.runId;
    if (!client || !org || currentRun == null) return;
    dispatch({ type: "interruptStarted" });
    interruptSeerRun(client, { org, runId: currentRun }).catch(() => {
      // The run may have finished on its own between render and click; the
      // next poll settles the UI either way.
      dispatch({ type: "interruptFailed" });
    });
  }, [client, org]);

  const respond = useCallback(
    (inputId: string, responseData?: Record<string, unknown>) => {
      const currentRun = conversationRef.current.runId;
      if (!client || !org || currentRun == null) return;

      dispatch({ type: "respondStarted", now: Date.now() });

      respondToSeerInput(client, { org, runId: currentRun, inputId, responseData })
        .then(() => dispatch({ type: "respondSucceeded" }))
        .catch((error: unknown) => {
          dispatch({ type: "respondFailed", error: toAsyncError(error) });
        });
    },
    [client, org],
  );

  const approveWrite = useCallback(
    (inputId: string, sessionId: string, scopes: string[]) => {
      if (!client || !org || scopes.length === 0) return;
      approveSeerWrite(client, { org, sessionId, scopes })
        .then((granted) => {
          const approved = scopes.every((scope) => granted.includes(scope));
          respond(inputId, {
            decision: approved ? "approve" : "reject",
            ...(approved ? {} : { reason: "insufficient_scope" }),
          });
        })
        .catch((error: unknown) => {
          dispatch({ type: "approveWriteFailed", error: toAsyncError(error) });
        });
    },
    [client, org, respond],
  );

  const createPR = useCallback(
    (repoName: string) => {
      const currentRun = conversationRef.current.runId;
      if (!client || !org || currentRun == null || !repoName) return;
      dispatch({ type: "createPRStarted", now: Date.now() });
      createSeerPR(client, { org, runId: currentRun, repoName })
        .then(() => dispatch({ type: "createPRSucceeded" }))
        .catch((error: unknown) => {
          dispatch({ type: "createPRFailed", error: toAsyncError(error) });
        });
    },
    [client, org],
  );

  const switchRun = useCallback((nextRunId: SeerRunId) => {
    dispatch({ type: "switchRun", runId: nextRunId });
  }, []);

  const loadRuns = useCallback(() => {
    if (!client || !org || !capabilities.available) return;
    const controller = new AbortController();
    setRuns(startLoading(runsRef.current, Date.now()));
    void listSeerRuns(client, { org, signal: controller.signal })
      .then((next) => setRuns(resolved(next, Date.now())))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRuns(rejected(runsRef.current, toAsyncError(error)));
      });
  }, [client, org, capabilities.available]);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  const serverBlocks = valueOf(conversation.session)?.blocks ?? [];
  const blocks = useMemo(() => {
    if (!conversation.optimistic) return serverBlocks;
    // Once the server knows about at least as many blocks as we invented, its
    // copy is strictly better — it has real ids, tool calls, and content.
    return serverBlocks.length >= conversation.optimistic.length
      ? serverBlocks
      : conversation.optimistic;
  }, [serverBlocks, conversation.optimistic]);

  const status = valueOf(conversation.session)?.status;
  const thinking =
    !conversation.timedOut &&
    (conversation.optimistic !== null ||
      status === "processing" ||
      blocks.some((block) => block.loading));
  const ownerId = valueOf(conversation.session)?.owner_user_id;
  const readOnly = ownerId !== null && ownerId !== undefined && String(ownerId) !== options.userId;
  const repoPRStates = valueOf(conversation.session)?.repo_pr_states ?? {};
  const codeChanges = useMemo(
    () => summarizeSeerCodeChanges(blocks, repoPRStates),
    [blocks, repoPRStates],
  );

  const setCodeMode = useCallback(
    (mode: SeerCodeMode) => options.onCodeModeChange?.(mode),
    [options.onCodeModeChange],
  );
  const setBashMode = useCallback(
    (enabled: boolean) => options.onBashModeChange?.(enabled),
    [options.onBashModeChange],
  );
  const setShowThinking = useCallback(
    (enabled: boolean) => options.onShowThinkingChange?.(enabled),
    [options.onShowThinkingChange],
  );

  return {
    blocks,
    thinking,
    timedOut: conversation.timedOut,
    interrupting: conversation.interrupting,
    error: errorOf(conversation.session),
    started: conversation.runId !== null || blocks.length > 0,
    runId: conversation.runId,
    readOnly,
    pendingInput: valueOf(conversation.session)?.pending_user_input ?? null,
    repoPRStates,
    codeChanges,
    capabilities,
    codeMode,
    bashMode,
    showThinking,
    runs,
    send,
    interrupt,
    reset,
    switchRun,
    loadRuns,
    respond,
    approveWrite,
    createPR,
    setCodeMode,
    setBashMode,
    setShowThinking,
  };
}

/**
 * The live conversation, provided by `App` rather than by the screen.
 *
 * Seer's transcript has to outlive the screen's mount: navigating to Issues and
 * back is not a reason to lose what Seer just said. `App` holds the hook — it
 * is inert until the first message, so it costs nothing while the user is
 * elsewhere — and the screen reads it from here.
 */
export const SeerChatContext = createContext<SeerChatState | null>(null);
