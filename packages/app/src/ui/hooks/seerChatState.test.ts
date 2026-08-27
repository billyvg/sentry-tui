import { describe, expect, test } from "bun:test";

import type { SeerBlock, SeerSession } from "~/api/seer";
import { valueOf } from "~/core/async";
import {
  initialSeerConversationState,
  seerConversationReducer,
  type SeerConversationState,
} from "~/ui/hooks/seerChatState";

const optimistic: SeerBlock[] = [
  {
    id: "optimistic-user-0",
    message: { role: "user", content: "What broke?" },
    timestamp: "2026-08-26T12:00:00.000Z",
  },
];

const processing: SeerSession = {
  blocks: optimistic,
  status: "processing",
  updated_at: "2026-08-26T12:00:01.000Z",
};

const completed: SeerSession = {
  ...processing,
  status: "completed",
  updated_at: "2026-08-26T12:00:02.000Z",
};

/** Reduce several lifecycle actions in order for transition-focused tests. */
function reduce(
  state: SeerConversationState,
  ...actions: Parameters<typeof seerConversationReducer>[1][]
): SeerConversationState {
  return actions.reduce(seerConversationReducer, state);
}

describe("seerConversationReducer", () => {
  test("starts a restored run without carrying its fetched transcript", () => {
    expect(initialSeerConversationState("run-42")).toMatchObject({
      runId: "run-42",
      optimistic: null,
      pollToken: 0,
      session: { state: "idle" },
    });
  });

  test("moves an optimistic send atomically into a settled server session", () => {
    const state = reduce(
      initialSeerConversationState(),
      { type: "sendStarted", optimistic, now: 1 },
      { type: "sendSucceeded", runId: "run-1" },
      { type: "interruptStarted" },
      { type: "pollSettled", session: completed, now: 2 },
    );

    expect(state).toMatchObject({
      runId: "run-1",
      optimistic: null,
      timedOut: false,
      interrupting: false,
      pollToken: 1,
    });
    expect(valueOf(state.session)).toEqual(completed);
  });

  test("marks stale and failed polls without leaving optimistic UI behind", () => {
    const stale = reduce(
      initialSeerConversationState(),
      { type: "sendStarted", optimistic, now: 1 },
      { type: "pollStale", session: processing, now: 2 },
    );
    expect(stale).toMatchObject({ optimistic: null, timedOut: true });

    const failed = seerConversationReducer(stale, {
      type: "pollFailed",
      error: { message: "unavailable", retryable: true },
    });
    expect(failed.session).toMatchObject({
      state: "error",
      error: { message: "unavailable" },
      previous: processing,
    });
  });

  test("responding resumes the session and restarts polling as one lifecycle", () => {
    const active = reduce(
      initialSeerConversationState(),
      { type: "switchRun", runId: "run-1" },
      { type: "pollProgressed", session: { ...processing, status: "awaiting_user_input" }, now: 1 },
      { type: "pollStale", session: processing, now: 2 },
      { type: "interruptStarted" },
      { type: "respondStarted", now: 3 },
      { type: "respondSucceeded" },
    );

    expect(active).toMatchObject({
      runId: "run-1",
      timedOut: false,
      interrupting: false,
      pollToken: 2,
    });
    expect(valueOf(active.session)).toMatchObject({
      status: "processing",
      updated_at: "1970-01-01T00:00:00.003Z",
    });
  });

  test("switching runs and resetting clear all conversation-scoped state", () => {
    const previous = reduce(
      initialSeerConversationState(),
      { type: "sendStarted", optimistic, now: 1 },
      { type: "sendSucceeded", runId: "run-1" },
      { type: "pollStale", session: processing, now: 2 },
      { type: "interruptStarted" },
    );
    const switched = seerConversationReducer(previous, { type: "switchRun", runId: "run-2" });

    expect(switched).toEqual({
      ...initialSeerConversationState(),
      runId: "run-2",
      pollToken: 2,
    });
    expect(seerConversationReducer(switched, { type: "orgChanged" })).toEqual(
      initialSeerConversationState(),
    );
    expect(seerConversationReducer(previous, { type: "reset" })).toEqual(
      initialSeerConversationState(),
    );
  });
});
