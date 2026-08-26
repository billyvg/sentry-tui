import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import { matchesCommand } from "~/core/commands";
import { SEER_SUGGESTED_QUESTIONS, seerSlashCommands, type SeerSlashCommand } from "~/core/seer";
import { useTheme } from "~/ui/theme";
import { SeerChatContext } from "~/ui/hooks/useSeerChat";
import { SeerExplorer } from "~/ui/screens/SeerExplorer";
import type { ScreenProps } from "~/ui/screens/types";

interface QuestionOption {
  description: string;
  label: string;
}

interface Question {
  options: QuestionOption[];
  question: string;
}

/** Narrow the untyped question payload returned by Seer's pending-input bus. */
function pendingQuestions(data: Record<string, unknown> | undefined): Question[] {
  const raw = data?.["questions"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record["question"] !== "string" || !Array.isArray(record["options"])) return [];
    const options = record["options"].flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const item = option as Record<string, unknown>;
      return typeof item["label"] === "string"
        ? [{ label: item["label"], description: String(item["description"] ?? "") }]
        : [];
    });
    return [{ question: record["question"], options }];
  });
}

/**
 * Seer › Ask Seer, as a registered screen.
 *
 * The screen owns terminal adaptations around the shared run: slash-menu
 * selection, history, and keyboard responses to pending-input controls. The
 * conversation itself stays in `App` so navigation never discards it.
 */
export function SeerScreen({
  client,
  org,
  state,
  width,
  height,
  focused,
  registerActions,
  navigateToScreen,
  notify,
}: ScreenProps) {
  const theme = useTheme();
  const chat = useContext(SeerChatContext);
  const [inputFocused, setInputFocused] = useState(true);
  const [slashSelected, setSlashSelected] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [historySelected, setHistorySelected] = useState(0);
  const [fileApprovalIndex, setFileApprovalIndex] = useState(0);
  const [fileApprovalDecisions, setFileApprovalDecisions] = useState<boolean[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<string[]>([]);
  const [questionSelected, setQuestionSelected] = useState(0);

  const value = state.searchQuery;
  const setValue = useCallback(
    (next: string) => state.dispatch({ type: "setSearchQuery", payload: next }),
    [state.dispatch],
  );
  const pendingId = chat?.pendingInput?.id;

  const commands = useMemo(
    () =>
      chat
        ? seerSlashCommands(chat.capabilities, {
            hasRun: chat.started,
            hasCodeChanges: chat.codeChanges.length > 0,
          })
        : [],
    [chat],
  );
  const visibleCommands = useMemo(() => {
    if (!value.startsWith("/") || value.includes(" ")) return [];
    const query = value.toLowerCase();
    return commands.filter((command) => command.title.startsWith(query));
  }, [commands, value]);

  useEffect(() => setSlashSelected(0), [value]);

  useEffect(() => {
    setFileApprovalIndex(0);
    setFileApprovalDecisions([]);
    setQuestionIndex(0);
    setQuestionAnswers([]);
    setQuestionSelected(0);
    if (pendingId) setInputFocused(false);
  }, [pendingId]);

  const openHistory = useCallback(() => {
    if (!chat) return;
    chat.loadRuns();
    setHistorySelected(0);
    setShowHistory(true);
    setInputFocused(false);
  }, [chat]);

  const pushChanges = useCallback(() => {
    if (!chat || chat.readOnly || chat.thinking) return;
    const pending = chat.codeChanges.filter(
      (change) => change.status === "needs_push" || change.status === "error",
    );
    for (const change of pending) chat.createPR(change.repoName);
    if (pending.length > 0) {
      notify({
        kind: "info",
        text: `${pending.some((change) => change.prNumber) ? "Updating" : "Creating"} ${pending.length === 1 ? "pull request" : "pull requests"}…`,
      });
    }
  }, [chat, notify]);

  const executeCommand = useCallback(
    (command: SeerSlashCommand) => {
      if (!chat) return;
      setValue("");
      switch (command.id) {
        case "new":
          chat.reset();
          setShowHistory(false);
          setInputFocused(true);
          return;
        case "history":
          openHistory();
          return;
        case "create-pr":
          pushChanges();
          return;
        case "conversations":
          if (chat.runId !== null) {
            navigateToScreen("explore.conversations", {
              query: `gen_ai.conversation.id:${JSON.stringify(String(chat.runId))}`,
            });
          }
          return;
        case "code-mode-off":
        case "code-mode-on":
        case "code-mode-only": {
          const mode = command.id.replace("code-mode-", "") as "off" | "on" | "only";
          chat.setCodeMode(mode);
          notify({ kind: "info", text: `Seer ${command.title.slice(1)}` });
          return;
        }
        case "bash-mode-off":
        case "bash-mode-on": {
          const enabled = command.id.endsWith("-on");
          chat.setBashMode(enabled);
          notify({ kind: "info", text: `Seer bash mode ${enabled ? "on" : "off"}` });
          return;
        }
        case "thinking-off":
        case "thinking-on":
          chat.setShowThinking(command.id.endsWith("-on"));
          return;
      }
    },
    [chat, navigateToScreen, notify, openHistory, pushChanges, setValue],
  );

  const questions = pendingQuestions(chat?.pendingInput?.data);
  const currentQuestion = questions[questionIndex];
  const otherSelected = Boolean(
    currentQuestion && questionSelected === currentQuestion.options.length,
  );

  const commitQuestionAnswer = useCallback(
    (answer: string) => {
      if (!chat?.pendingInput || !currentQuestion) return;
      const answers = [...questionAnswers, answer];
      if (questionIndex + 1 >= questions.length) {
        chat.respond(chat.pendingInput.id, { answers });
        setValue("");
        setInputFocused(false);
        return;
      }
      setQuestionAnswers(answers);
      setQuestionIndex((index) => index + 1);
      setQuestionSelected(0);
      setValue("");
      setInputFocused(false);
    },
    [chat, currentQuestion, questionAnswers, questionIndex, questions.length, setValue],
  );

  const submit = useCallback(() => {
    if (!chat) return false;

    if (chat.pendingInput?.input_type === "ask_user_question" && otherSelected) {
      const answer = value.trim();
      if (answer) commitQuestionAnswer(answer);
      return true;
    }

    const command =
      visibleCommands[slashSelected] ??
      commands.find((candidate) => candidate.title === value.trim().toLowerCase());
    if (command) {
      executeCommand(command);
      return true;
    }

    if (chat.thinking || chat.readOnly || chat.pendingInput || value.trim() === "") return true;
    chat.send(value);
    setValue("");
    return true;
  }, [
    chat,
    commands,
    commitQuestionAnswer,
    executeCommand,
    otherSelected,
    setValue,
    slashSelected,
    value,
    visibleCommands,
  ]);

  const respondToFileApproval = useCallback(
    (approved: boolean) => {
      if (chat?.pendingInput?.input_type !== "file_change_approval") return;
      const patches = Array.isArray(chat.pendingInput.data["patches"])
        ? chat.pendingInput.data["patches"]
        : [];
      const decisions = [...fileApprovalDecisions, approved];
      if (fileApprovalIndex + 1 >= patches.length) {
        chat.respond(chat.pendingInput.id, { decisions });
      } else {
        setFileApprovalDecisions(decisions);
        setFileApprovalIndex((index) => index + 1);
      }
    },
    [chat, fileApprovalDecisions, fileApprovalIndex],
  );

  const handlePendingKey = useCallback(
    (key: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) => {
      const pending = chat?.pendingInput;
      if (!pending) return false;

      if (pending.input_type === "file_change_approval") {
        if (key.name.toLowerCase() === "y") respondToFileApproval(true);
        else if (key.name.toLowerCase() === "x") respondToFileApproval(false);
        else return false;
        return true;
      }

      if (pending.input_type === "agent_write_approval") {
        if (key.name.toLowerCase() === "x") {
          chat.respond(pending.id, { decision: "reject" });
          return true;
        }
        if (key.name.toLowerCase() !== "y") return false;
        const sessionId = pending.data["session_id"];
        const rawScopes = pending.data["required_scopes"];
        const scopes = Array.isArray(rawScopes)
          ? rawScopes.filter((scope): scope is string => typeof scope === "string")
          : [];
        if (typeof sessionId === "string") chat.approveWrite(pending.id, sessionId, scopes);
        return true;
      }

      if (pending.input_type !== "ask_user_question" || !currentQuestion) return false;
      if (matchesCommand("sentry.nav.up", key) || key.name.toLowerCase() === "up") {
        setQuestionSelected((selected) =>
          selected > 0 ? selected - 1 : currentQuestion.options.length,
        );
        return true;
      }
      if (matchesCommand("sentry.nav.down", key) || key.name.toLowerCase() === "down") {
        setQuestionSelected((selected) =>
          selected < currentQuestion.options.length ? selected + 1 : 0,
        );
        return true;
      }
      if (key.name.toLowerCase() === "o") {
        setQuestionSelected(currentQuestion.options.length);
        setInputFocused(true);
        return true;
      }
      const option = Number(key.name) - 1;
      if (option >= 0 && option < currentQuestion.options.length) {
        setQuestionSelected(option);
        return true;
      }
      if (matchesCommand("sentry.nav.open", key) && !otherSelected) {
        const selected = currentQuestion.options[questionSelected];
        if (selected) commitQuestionAnswer(selected.label);
        return true;
      }
      return false;
    },
    [
      chat,
      commitQuestionAnswer,
      currentQuestion,
      otherSelected,
      questionSelected,
      respondToFileApproval,
    ],
  );

  /** Keys claimed by the slash completion menu while the native input owns focus. */
  const handleInputKey = useCallback(
    (key: { name: string }) => {
      if (visibleCommands.length === 0) return false;
      const name = key.name.toLowerCase();
      if (name === "up") {
        setSlashSelected(
          (selected) => (selected - 1 + visibleCommands.length) % visibleCommands.length,
        );
        return true;
      }
      if (name === "down") {
        setSlashSelected((selected) => (selected + 1) % visibleCommands.length);
        return true;
      }
      return false;
    },
    [visibleCommands.length],
  );

  /** Keys that belong to the transcript, history, or pending user input. */
  const handleKey = useCallback(
    (key: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) => {
      if (!chat) return false;
      if (chat.pendingInput && handlePendingKey(key)) return true;

      if (showHistory) {
        const runCount = chat.runs.state === "ready" ? chat.runs.value.length : 0;
        if (matchesCommand("sentry.nav.down", key)) {
          setHistorySelected((selected) => Math.min(selected + 1, Math.max(0, runCount - 1)));
          return true;
        }
        if (matchesCommand("sentry.nav.up", key)) {
          setHistorySelected((selected) => Math.max(0, selected - 1));
          return true;
        }
        if (matchesCommand("sentry.nav.open", key) && chat.runs.state === "ready") {
          const selected = chat.runs.value[historySelected];
          if (selected) {
            chat.switchRun(selected.id);
            setShowHistory(false);
            setInputFocused(true);
          }
          return true;
        }
        return false;
      }

      if (matchesCommand("sentry.seer.compose", key) || matchesCommand("sentry.nav.open", key)) {
        setInputFocused(true);
        return true;
      }
      if (matchesCommand("sentry.seer.newChat", key)) {
        chat.reset();
        setValue("");
        setInputFocused(true);
        return true;
      }
      if (matchesCommand("sentry.seer.history", key)) {
        openHistory();
        return true;
      }
      if (matchesCommand("sentry.seer.pushChanges", key) && chat.codeChanges.length > 0) {
        pushChanges();
        return true;
      }
      if (matchesCommand("sentry.seer.interrupt", key)) {
        if (chat.thinking) chat.interrupt();
        return true;
      }
      if (chat.blocks.length === 0 && !key.ctrl && !key.meta) {
        const question = SEER_SUGGESTED_QUESTIONS[Number(key.name) - 1];
        if (question !== undefined) {
          chat.send(question);
          return true;
        }
      }
      return false;
    },
    [chat, handlePendingKey, historySelected, openHistory, pushChanges, setValue, showHistory],
  );

  const back = useCallback(() => {
    if (!showHistory) return false;
    setShowHistory(false);
    setInputFocused(true);
    return true;
  }, [showHistory]);

  const composerFocused =
    focused &&
    inputFocused &&
    !showHistory &&
    !chat?.readOnly &&
    (!chat?.pendingInput ||
      (chat.pendingInput.input_type === "ask_user_question" && otherSelected));

  useEffect(() => {
    registerActions({
      inputFocused: () => composerFocused,
      submitInput: submit,
      blurInput: () => setInputFocused(false),
      handleInputKey,
      handleKey,
      back,
    });
    return () => registerActions(null);
  }, [back, composerFocused, handleInputKey, handleKey, registerActions, submit]);

  if (!chat) return <text fg={theme.muted}>Seer is unavailable.</text>;
  if (!chat.capabilities.available) {
    return <text fg={theme.muted}>Seer Agent is not enabled for this organization.</text>;
  }

  const placeholder = otherSelected
    ? "Type your own answer…"
    : chat.readOnly
      ? "This conversation is owned by another user and is read-only"
      : undefined;

  return (
    <SeerExplorer
      chat={chat}
      client={client}
      org={org}
      width={width}
      height={height}
      focused={focused}
      value={value}
      onInput={setValue}
      inputFocused={composerFocused}
      onInputFocus={() => setInputFocused(true)}
      onInputBlur={() => setInputFocused(false)}
      slashCommands={visibleCommands}
      slashSelected={slashSelected}
      showHistory={showHistory}
      historySelected={historySelected}
      pendingState={{ fileApprovalIndex, questionIndex, questionSelected }}
      placeholderOverride={placeholder}
    />
  );
}
