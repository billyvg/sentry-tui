import { describe, expect, test } from "bun:test";

import {
  initialSeerScreenState,
  seerScreenReducer,
  type SeerScreenState,
} from "~/ui/screens/seerScreenState";

/** Reduce several screen actions in order for transition-focused tests. */
function reduce(
  state: SeerScreenState,
  ...actions: Parameters<typeof seerScreenReducer>[1][]
): SeerScreenState {
  return actions.reduce(seerScreenReducer, state);
}

describe("seerScreenReducer", () => {
  test("pending controls preempt history and return to an unfocused conversation", () => {
    const pending = reduce(
      initialSeerScreenState(),
      { type: "openHistory" },
      {
        type: "pendingChanged",
        pending: { id: "approval-1", input_type: "agent_write_approval" },
      },
    );
    expect(pending).toEqual({ mode: "blockingInput", pendingId: "approval-1" });
    expect(seerScreenReducer(pending, { type: "openHistory" })).toBe(pending);

    expect(seerScreenReducer(pending, { type: "pendingChanged", pending: null })).toEqual({
      mode: "conversation",
      inputFocused: false,
      slashSelected: 0,
    });
  });

  test("question progress keeps answers aligned with the active question", () => {
    const first = seerScreenReducer(initialSeerScreenState(), {
      type: "pendingChanged",
      pending: { id: "questions-1", input_type: "ask_user_question" },
    });
    const second = reduce(
      first,
      { type: "selectOtherAnswer", optionCount: 2 },
      { type: "commitQuestionAnswer", answer: "A custom answer", final: false },
    );

    expect(second).toEqual({
      mode: "question",
      pendingId: "questions-1",
      index: 1,
      answers: ["A custom answer"],
      selected: 0,
      inputFocused: false,
    });
    expect(seerScreenReducer(second, { type: "focusInput", allowQuestion: false })).toBe(second);
    expect(
      seerScreenReducer(second, {
        type: "commitQuestionAnswer",
        answer: "Done",
        final: true,
      }),
    ).toEqual(second);
  });

  test("file decisions advance together while the final response holds position", () => {
    const first = seerScreenReducer(initialSeerScreenState(), {
      type: "pendingChanged",
      pending: { id: "patches-1", input_type: "file_change_approval" },
    });
    const second = seerScreenReducer(first, {
      type: "recordFileDecision",
      approved: true,
      final: false,
    });

    expect(second).toEqual({
      mode: "fileApproval",
      pendingId: "patches-1",
      index: 1,
      decisions: [true],
    });
    expect(
      seerScreenReducer(second, {
        type: "recordFileDecision",
        approved: false,
        final: true,
      }),
    ).toEqual(second);
  });

  test("history and slash selections stay within their active modes", () => {
    const history = reduce(
      initialSeerScreenState(),
      { type: "openHistory" },
      { type: "moveHistorySelection", direction: 1, count: 2 },
      { type: "moveHistorySelection", direction: 1, count: 2 },
    );
    expect(history).toEqual({ mode: "history", selected: 1 });

    const conversation = reduce(
      history,
      { type: "closeHistory" },
      { type: "moveSlashSelection", direction: -1, count: 3 },
    );
    expect(conversation).toEqual({ mode: "conversation", inputFocused: true, slashSelected: 2 });
  });
});
