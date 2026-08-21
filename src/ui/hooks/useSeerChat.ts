import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, type SentryClient } from "~/api/client";
import {
  getSeerSession,
  interruptSeerRun,
  isSessionSettled,
  isSessionStale,
  sendSeerMessage,
  SEER_ERROR_POLL_INTERVAL_MS,
  SEER_POLL_INTERVAL_MS,
  type SeerBlock,
  type SeerRunId,
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
import { SEER_THINKING_PLACEHOLDERS } from "~/core/seer";

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
  send: (query: string) => void;
  interrupt: () => void;
  reset: () => void;
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
export function useSeerChat(client: SentryClient | null, org: string): SeerChatState {
  const [session, setSession] = useState<AsyncStatus<SeerSession>>(idle);
  const [runId, setRunId] = useState<SeerRunId | null>(null);
  const [optimistic, setOptimistic] = useState<SeerBlock[] | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  /** Bumped on every send so a settled run resumes polling. */
  const [pollToken, setPollToken] = useState(0);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  /** Monotonic counter for optimistic block ids and placeholder rotation. */
  const turnCount = useRef(0);

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
      if (!client || !org || trimmed === "") return;

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
      sendSeerMessage(client, { org, query: trimmed, runId: currentRun, insertIndex: base.length })
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
    [client, org],
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

  return {
    blocks,
    thinking,
    timedOut,
    interrupting,
    error: errorOf(session),
    started: runId !== null || blocks.length > 0,
    send,
    interrupt,
    reset,
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
