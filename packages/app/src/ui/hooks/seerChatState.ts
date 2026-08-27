import type { SeerBlock, SeerRunId, SeerSession } from "~/api/seer";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  valueOf,
  type AsyncError,
  type AsyncStatus,
} from "~/core/async";

/** The coordinated lifecycle of one live Seer conversation. */
export interface SeerConversationState {
  session: AsyncStatus<SeerSession>;
  runId: SeerRunId | null;
  optimistic: SeerBlock[] | null;
  timedOut: boolean;
  interrupting: boolean;
  /** Bumped when an existing run needs polling to resume. */
  pollToken: number;
}

/** Every atomic transition supported by a live Seer conversation. */
export type SeerConversationAction =
  | { type: "orgChanged" }
  | { type: "sendStarted"; optimistic: SeerBlock[]; now: number }
  | { type: "sendSucceeded"; runId: SeerRunId }
  | { type: "sendFailed"; error: AsyncError }
  | { type: "pollProgressed"; session: SeerSession; now: number }
  | { type: "pollSettled"; session: SeerSession; now: number }
  | { type: "pollStale"; session: SeerSession; now: number }
  | { type: "pollFailed"; error: AsyncError }
  | { type: "interruptStarted" }
  | { type: "interruptFailed" }
  | { type: "respondStarted"; now: number }
  | { type: "respondSucceeded" }
  | { type: "respondFailed"; error: AsyncError }
  | { type: "approveWriteFailed"; error: AsyncError }
  | { type: "createPRStarted"; now: number }
  | { type: "createPRSucceeded" }
  | { type: "createPRFailed"; error: AsyncError }
  | { type: "switchRun"; runId: SeerRunId }
  | { type: "reset" };

/** Build the empty state for a Seer conversation, optionally ready to refetch a run. */
export function initialSeerConversationState(
  runId: SeerRunId | null = null,
): SeerConversationState {
  return {
    session: idle(),
    runId,
    optimistic: null,
    timedOut: false,
    interrupting: false,
    pollToken: 0,
  };
}

/** Mark a session as processing without discarding its current transcript. */
function resumeSession(session: AsyncStatus<SeerSession>, now: number): AsyncStatus<SeerSession> {
  const current = valueOf(session);
  return current
    ? resolved({ ...current, status: "processing", updated_at: new Date(now).toISOString() }, now)
    : session;
}

/** Apply one side-effect-free conversation lifecycle transition. */
export function seerConversationReducer(
  state: SeerConversationState,
  action: SeerConversationAction,
): SeerConversationState {
  switch (action.type) {
    case "orgChanged":
    case "reset":
      return initialSeerConversationState();
    case "sendStarted":
      return {
        ...state,
        session: startLoading(state.session, action.now),
        optimistic: action.optimistic,
        timedOut: false,
        interrupting: false,
      };
    case "sendSucceeded":
      return { ...state, runId: action.runId, pollToken: state.pollToken + 1 };
    case "sendFailed":
      return {
        ...state,
        session: rejected(state.session, action.error),
        optimistic: null,
      };
    case "pollProgressed":
      return { ...state, session: resolved(action.session, action.now) };
    case "pollSettled":
      return {
        ...state,
        session: resolved(action.session, action.now),
        optimistic: null,
        interrupting: false,
      };
    case "pollStale":
      return {
        ...state,
        session: resolved(action.session, action.now),
        optimistic: null,
        timedOut: true,
      };
    case "pollFailed":
      return {
        ...state,
        session: rejected(state.session, action.error),
        optimistic: null,
      };
    case "interruptStarted":
      return { ...state, interrupting: true };
    case "interruptFailed":
      return { ...state, interrupting: false };
    case "respondStarted":
      return {
        ...state,
        session: resumeSession(state.session, action.now),
        timedOut: false,
        interrupting: false,
      };
    case "respondSucceeded":
      return { ...state, pollToken: state.pollToken + 1 };
    case "respondFailed":
    case "approveWriteFailed":
      return { ...state, session: rejected(state.session, action.error) };
    case "createPRStarted":
      return { ...state, session: resumeSession(state.session, action.now) };
    case "createPRSucceeded":
      return { ...state, pollToken: state.pollToken + 1 };
    case "createPRFailed":
      return { ...state, session: rejected(state.session, action.error) };
    case "switchRun":
      if (action.runId === state.runId) return state;
      return {
        ...initialSeerConversationState(),
        runId: action.runId,
        pollToken: state.pollToken + 1,
      };
  }
}
