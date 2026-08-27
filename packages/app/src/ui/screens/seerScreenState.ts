import type { SeerPendingUserInput } from "~/api/seer";

type PendingInputIdentity = Pick<SeerPendingUserInput, "id" | "input_type">;

/** Mutually exclusive interaction modes on the Seer screen. */
export type SeerScreenState =
  | { mode: "conversation"; inputFocused: boolean; slashSelected: number }
  | { mode: "history"; selected: number }
  | { mode: "fileApproval"; pendingId: string; index: number; decisions: boolean[] }
  | {
      mode: "question";
      pendingId: string;
      index: number;
      answers: string[];
      selected: number;
      inputFocused: boolean;
    }
  | { mode: "blockingInput"; pendingId: string };

/** Atomic interaction transitions supported by the Seer screen. */
export type SeerScreenAction =
  | { type: "pendingChanged"; pending: PendingInputIdentity | null }
  | { type: "inputChanged" }
  | { type: "focusInput"; allowQuestion: boolean }
  | { type: "blurInput" }
  | { type: "moveSlashSelection"; direction: -1 | 1; count: number }
  | { type: "openHistory" }
  | { type: "closeHistory" }
  | { type: "moveHistorySelection"; direction: -1 | 1; count: number }
  | { type: "startNewChat" }
  | { type: "moveQuestionSelection"; direction: -1 | 1; optionCount: number }
  | { type: "selectQuestionOption"; index: number }
  | { type: "selectOtherAnswer"; optionCount: number }
  | { type: "commitQuestionAnswer"; answer: string; final: boolean }
  | { type: "recordFileDecision"; approved: boolean; final: boolean };

/** Build the initial, composer-focused screen state. */
export function initialSeerScreenState(): SeerScreenState {
  return { mode: "conversation", inputFocused: true, slashSelected: 0 };
}

/** Start the control state appropriate for one server-requested user input. */
function pendingState(pending: PendingInputIdentity): SeerScreenState {
  switch (pending.input_type) {
    case "file_change_approval":
      return { mode: "fileApproval", pendingId: pending.id, index: 0, decisions: [] };
    case "ask_user_question":
      return {
        mode: "question",
        pendingId: pending.id,
        index: 0,
        answers: [],
        selected: 0,
        inputFocused: false,
      };
    case "agent_write_approval":
    case "reauth_monitoring_provider":
      return { mode: "blockingInput", pendingId: pending.id };
  }
}

/** Apply one side-effect-free Seer screen interaction transition. */
export function seerScreenReducer(
  state: SeerScreenState,
  action: SeerScreenAction,
): SeerScreenState {
  switch (action.type) {
    case "pendingChanged":
      if (action.pending) {
        return pendingState(action.pending);
      }
      return "pendingId" in state
        ? { mode: "conversation", inputFocused: false, slashSelected: 0 }
        : state;
    case "inputChanged":
      return state.mode === "conversation" && state.slashSelected !== 0
        ? { ...state, slashSelected: 0 }
        : state;
    case "focusInput":
      if (state.mode === "conversation") return { ...state, inputFocused: true };
      if (state.mode === "question" && action.allowQuestion) {
        return { ...state, inputFocused: true };
      }
      return state;
    case "blurInput":
      if (state.mode === "conversation" || state.mode === "question") {
        return { ...state, inputFocused: false };
      }
      return state;
    case "moveSlashSelection":
      if (state.mode !== "conversation" || action.count === 0) return state;
      return {
        ...state,
        slashSelected: (state.slashSelected + action.direction + action.count) % action.count,
      };
    case "openHistory":
      return state.mode === "conversation" ? { mode: "history", selected: 0 } : state;
    case "closeHistory":
      return state.mode === "history"
        ? { mode: "conversation", inputFocused: true, slashSelected: 0 }
        : state;
    case "startNewChat":
      return { mode: "conversation", inputFocused: true, slashSelected: 0 };
    case "moveHistorySelection": {
      if (state.mode !== "history") return state;
      const selected = Math.max(
        0,
        Math.min(state.selected + action.direction, Math.max(0, action.count - 1)),
      );
      return selected === state.selected ? state : { ...state, selected };
    }
    case "moveQuestionSelection":
      if (state.mode !== "question") return state;
      return {
        ...state,
        selected:
          (state.selected + action.direction + action.optionCount + 1) % (action.optionCount + 1),
        inputFocused: false,
      };
    case "selectQuestionOption":
      return state.mode === "question"
        ? { ...state, selected: action.index, inputFocused: false }
        : state;
    case "selectOtherAnswer":
      return state.mode === "question"
        ? { ...state, selected: action.optionCount, inputFocused: true }
        : state;
    case "commitQuestionAnswer":
      if (state.mode !== "question") return state;
      return action.final
        ? { ...state, inputFocused: false }
        : {
            ...state,
            index: state.index + 1,
            answers: [...state.answers, action.answer],
            selected: 0,
            inputFocused: false,
          };
    case "recordFileDecision":
      if (state.mode !== "fileApproval" || action.final) return state;
      return {
        ...state,
        index: state.index + 1,
        decisions: [...state.decisions, action.approved],
      };
  }
}
