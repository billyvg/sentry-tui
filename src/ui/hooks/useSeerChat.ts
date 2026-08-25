import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  type SeerSession,
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
  const [session, setSession] = useState<AsyncStatus<SeerSession>>(idle);
  const [runId, setRunId] = useState<SeerRunId | null>(null);
  const [optimistic, setOptimistic] = useState<SeerBlock[] | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [runs, setRuns] = useState<AsyncStatus<SeerRun[]>>(idle);
  /** Bumped on every send so a settled run resumes polling. */
  const [pollToken, setPollToken] = useState(0);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
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
    setRunId(null);
    setSession(idle);
    setOptimistic(null);
    setTimedOut(false);
    setInterrupting(false);
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
    if (!client || !org || runId == null) return;

    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errorPolls = 0;

    const tick = async () => {
      try {
        const next = await getSeerSession(client, { org, runId, signal: controller.signal });
        if (cancelled) return;
        errorPolls = 0;

        if (next) {
          setSession(resolved(next, Date.now()));
          if (isSessionSettled(next)) {
            setOptimistic(null);
            setInterrupting(false);
            return;
          }
          if (isSessionStale(next, Date.now())) {
            setOptimistic(null);
            setTimedOut(true);
            return;
          }
        }
        timer = setTimeout(() => void tick(), SEER_POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        errorPolls += 1;
        if (errorPolls > MAX_ERROR_POLLS) {
          setOptimistic(null);
          setSession(rejected(sessionRef.current, toAsyncError(error)));
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
  }, [client, org, runId, pollToken]);

  const send = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!client || !org || trimmed === "" || !capabilities.available) return;

      const base = valueOf(sessionRef.current)?.blocks ?? [];
      const turn = turnCount.current++;
      const now = new Date().toISOString();
      const placeholder =
        SEER_THINKING_PLACEHOLDERS[turn % SEER_THINKING_PLACEHOLDERS.length] ?? "Thinking…";

      setOptimistic([
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
      ]);
      setTimedOut(false);
      setInterrupting(false);
      setSession(startLoading(sessionRef.current, Date.now()));

      const currentRun = runIdRef.current;
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
          setRunId(id);
          // Continuing an existing run leaves `runId` unchanged, so the poll
          // effect needs its own trigger to restart.
          setPollToken((n) => n + 1);
        })
        .catch((error: unknown) => {
          setOptimistic(null);
          setSession(rejected(sessionRef.current, toAsyncError(error)));
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
    const currentRun = runIdRef.current;
    if (!client || !org || currentRun == null) return;
    setInterrupting(true);
    interruptSeerRun(client, { org, runId: currentRun }).catch(() => {
      // The run may have finished on its own between render and click; the
      // next poll settles the UI either way.
      setInterrupting(false);
    });
  }, [client, org]);

  const respond = useCallback(
    (inputId: string, responseData?: Record<string, unknown>) => {
      const currentRun = runIdRef.current;
      if (!client || !org || currentRun == null) return;

      const current = valueOf(sessionRef.current);
      if (current) {
        setSession(
          resolved(
            { ...current, status: "processing", updated_at: new Date().toISOString() },
            Date.now(),
          ),
        );
      }
      setInterrupting(false);
      setTimedOut(false);

      respondToSeerInput(client, { org, runId: currentRun, inputId, responseData })
        .then(() => setPollToken((token) => token + 1))
        .catch((error: unknown) => {
          setSession(rejected(sessionRef.current, toAsyncError(error)));
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
          setSession(rejected(sessionRef.current, toAsyncError(error)));
        });
    },
    [client, org, respond],
  );

  const createPR = useCallback(
    (repoName: string) => {
      const currentRun = runIdRef.current;
      if (!client || !org || currentRun == null || !repoName) return;
      const current = valueOf(sessionRef.current);
      if (current) {
        setSession(
          resolved(
            { ...current, status: "processing", updated_at: new Date().toISOString() },
            Date.now(),
          ),
        );
      }
      createSeerPR(client, { org, runId: currentRun, repoName })
        .then(() => setPollToken((token) => token + 1))
        .catch((error: unknown) => {
          setSession(rejected(sessionRef.current, toAsyncError(error)));
        });
    },
    [client, org],
  );

  const switchRun = useCallback((nextRunId: SeerRunId) => {
    if (nextRunId === runIdRef.current) return;
    setRunId(nextRunId);
    setSession(idle);
    setOptimistic(null);
    setTimedOut(false);
    setInterrupting(false);
    setPollToken((token) => token + 1);
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
    setRunId(null);
    setSession(idle);
    setOptimistic(null);
    setTimedOut(false);
    setInterrupting(false);
  }, []);

  const serverBlocks = valueOf(session)?.blocks ?? [];
  const blocks = useMemo(() => {
    if (!optimistic) return serverBlocks;
    // Once the server knows about at least as many blocks as we invented, its
    // copy is strictly better — it has real ids, tool calls, and content.
    return serverBlocks.length >= optimistic.length ? serverBlocks : optimistic;
  }, [serverBlocks, optimistic]);

  const status = valueOf(session)?.status;
  const thinking =
    !timedOut &&
    (optimistic !== null || status === "processing" || blocks.some((block) => block.loading));
  const ownerId = valueOf(session)?.owner_user_id;
  const readOnly = ownerId !== null && ownerId !== undefined && String(ownerId) !== options.userId;
  const repoPRStates = valueOf(session)?.repo_pr_states ?? {};
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
    timedOut,
    interrupting,
    error: errorOf(session),
    started: runId !== null || blocks.length > 0,
    runId,
    readOnly,
    pendingInput: valueOf(session)?.pending_user_input ?? null,
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
