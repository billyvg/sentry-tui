import { useCallback, useMemo, useRef } from "react";
import { RenderableEvents, type InputRenderable } from "@opentui/core";

import type { SeerBlock, SeerCallRecord, SeerPendingUserInput, SeerToolLink } from "~/api/seer";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { formatKey, primaryKey } from "~/core/commands";
import {
  codeModeLabel,
  describeCallRecord,
  describeCallRecordDetail,
  describeToolCalls,
  getBlockStatus,
  getCallRecordStatus,
  latestSeerTodos,
  SEER_STATUS_GLYPH,
  SEER_SUGGESTED_QUESTIONS,
  visibleCallRecords,
  type SeerSlashCommand,
} from "~/core/seer";
import { fitText, wrapText } from "~/lib/text";
import { timeAgo } from "~/lib/sparkline";
import { useSpinnerFrame } from "~/ui/components/Spinner";
import { SeerMarkdown } from "~/ui/components/SeerMarkdown";
import type { SeerChatState } from "~/ui/hooks/useSeerChat";
import { BOLD, DIM, ITALIC, NONE } from "~/ui/lib/attributes";
import { useTheme } from "~/ui/theme";

/** Rows taken by the composer, including its border. */
const COMPOSER_HEIGHT = 3;

export interface SeerExplorerProps {
  chat: SeerChatState;
  width: number;
  height: number;
  focused: boolean;
  value: string;
  onInput: (value: string) => void;
  inputFocused: boolean;
  historySelected: number;
  pendingState: {
    fileApprovalIndex: number;
    questionIndex: number;
    questionSelected: number;
  };
  showHistory: boolean;
  slashCommands: readonly SeerSlashCommand[];
  slashSelected: number;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  placeholderOverride?: string;
}

/** The Seer Agent conversation as a full terminal screen. */
export function SeerExplorer({
  chat,
  width,
  height,
  focused,
  value,
  onInput,
  inputFocused,
  onInputFocus,
  onInputBlur,
  slashCommands,
  slashSelected,
  showHistory,
  historySelected,
  pendingState,
  placeholderOverride,
}: SeerExplorerProps) {
  const theme = useTheme();
  const inner = Math.max(10, width - 2);
  const slashMenuHeight = slashCommands.length > 0 ? slashCommands.length + 2 : 0;
  const transcriptHeight = Math.max(1, height - 1 - COMPOSER_HEIGHT - slashMenuHeight);
  const spinner = useSpinnerFrame(chat.thinking);
  const latestTodos = useMemo(() => latestSeerTodos(chat.blocks), [chat.blocks]);
  const hasAgentApprovalEmbed = useMemo(
    () =>
      chat.blocks.some((block) =>
        (block.tool_results ?? []).some(
          (result) =>
            result?.structuredContent?.agentWriteApproval !== undefined ||
            result?.content.includes("agentWriteApproval"),
        ),
      ),
    [chat.blocks],
  );
  const inputRef = useRef<InputRenderable>(null);

  const inputRefCallback = useCallback(
    (node: InputRenderable | null) => {
      const prev = inputRef.current;
      if (prev) {
        prev.removeAllListeners(RenderableEvents.FOCUSED);
        prev.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, () => onInputFocus?.());
        node.on(RenderableEvents.BLURRED, () => onInputBlur?.());
      }
    },
    [onInputFocus, onInputBlur],
  );

  const placeholder =
    placeholderOverride ??
    (chat.timedOut
      ? "Response timed out. Please try again."
      : chat.interrupting
        ? "Interrupted. What should Seer do instead?"
        : chat.pendingInput
          ? "Respond using the controls above"
          : "Ask Seer a question, or press / for commands.");

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <box
        style={{
          flexDirection: "row",
          width,
          height: 1,
          flexShrink: 0,
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: theme.panelAlt,
        }}
      >
        <text fg={theme.text} attributes={BOLD}>
          Seer Agent{" "}
        </text>
        <text fg={theme.accent}>β</text>
        <box style={{ flexGrow: 1 }} />
        {chat.capabilities.codeMode ? (
          <text fg={theme.muted}>{`${codeModeLabel(chat.codeMode)} · `}</text>
        ) : null}
        {chat.codeChanges.length > 0 ? (
          <text
            fg={theme.muted}
          >{`+${chat.codeChanges.reduce((sum, change) => sum + change.added, 0)} -${chat.codeChanges.reduce((sum, change) => sum + change.removed, 0)} · `}</text>
        ) : null}
        <text fg={theme.muted}>{`${formatKey(primaryKey("sentry.seer.history"))} history`}</text>
      </box>

      {showHistory ? (
        <SeerHistory
          chat={chat}
          selected={historySelected}
          width={inner}
          height={transcriptHeight}
        />
      ) : (
        <scrollbox
          focused={focused && !inputFocused}
          stickyScroll
          stickyStart="bottom"
          style={{ flexGrow: 1, width, height: transcriptHeight }}
        >
          {chat.blocks.length === 0 ? (
            <SeerEmptyState width={inner} />
          ) : (
            chat.blocks.map((block) => (
              <SeerBlockView
                key={block.id}
                block={block}
                width={inner}
                spinner={spinner}
                chat={chat}
                showTodos={latestTodos?.blockId === block.id ? latestTodos.todos : []}
              />
            ))
          )}

          {chat.codeChanges.length > 0 ? <CodeChangesCard chat={chat} width={inner} /> : null}

          {chat.pendingInput &&
          (chat.pendingInput.input_type !== "reauth_monitoring_provider" ||
            chat.capabilities.infraTelemetry) &&
          (chat.pendingInput.input_type !== "agent_write_approval" || !hasAgentApprovalEmbed) ? (
            <PendingInputCard pending={chat.pendingInput} state={pendingState} width={inner} />
          ) : null}

          {chat.error ? (
            <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
              <text fg={theme.danger}>Seer request failed</text>
              <text fg={theme.muted}>{chat.error.message}</text>
            </box>
          ) : null}

          {chat.timedOut ? (
            <box style={{ paddingLeft: 1, paddingTop: 1 }}>
              <text fg={theme.warning}>
                Seer stopped responding. Send another message to retry.
              </text>
            </box>
          ) : null}
        </scrollbox>
      )}

      {slashCommands.length > 0 ? (
        <SlashMenu commands={slashCommands} selected={slashSelected} width={width} />
      ) : null}

      <box
        style={{
          flexDirection: "row",
          width,
          flexShrink: 0,
          height: COMPOSER_HEIGHT,
          border: true,
          borderStyle: "rounded",
          borderColor: inputFocused ? theme.accent : theme.border,
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={chat.thinking ? theme.accent : theme.subText}>
          {chat.thinking ? `${spinner} ` : "› "}
        </text>
        <input
          ref={inputRefCallback}
          value={value}
          placeholder={placeholder}
          focused={inputFocused}
          onInput={onInput}
          style={{
            flexGrow: 1,
            textColor: theme.text,
            backgroundColor: theme.panel,
            focusedTextColor: theme.text,
            focusedBackgroundColor: theme.panel,
            placeholderColor:
              chat.timedOut || chat.interrupting || chat.pendingInput
                ? theme.warning
                : theme.subText,
          }}
        />
      </box>
    </box>
  );
}

/** Accepted Code Mode patches and their pull-request synchronization state. */
function CodeChangesCard({ chat, width }: { chat: SeerChatState; width: number }) {
  const theme = useTheme();
  const needsPush = chat.codeChanges.some(
    (change) => change.status === "needs_push" || change.status === "error",
  );
  return (
    <box
      style={{
        flexDirection: "column",
        width: Math.max(8, width - 2),
        marginTop: 1,
        border: true,
        borderColor: theme.border,
        paddingLeft: 1,
      }}
    >
      <text fg={theme.text} attributes={BOLD}>
        Code changes
      </text>
      {chat.codeChanges.map((change) => (
        <box key={change.repoName} style={{ flexDirection: "column" }}>
          <text fg={theme.accent} attributes={BOLD}>
            {`${change.repoName}  +${change.added} -${change.removed}`}
          </text>
          {change.files.map((file) => (
            <text key={file.path} fg={theme.muted}>
              {`  +${file.added} -${file.removed}  ${file.path}`}
            </text>
          ))}
          <text
            fg={
              change.status === "pushed"
                ? theme.success
                : change.status === "error"
                  ? theme.danger
                  : change.status === "creating"
                    ? theme.warning
                    : theme.muted
            }
          >
            {change.status === "creating"
              ? "  Creating or updating PR…"
              : change.status === "error"
                ? "  PR update failed — retry available"
                : change.status === "pushed"
                  ? `  Pushed${change.prNumber ? ` · PR #${change.prNumber}` : ""}${change.prUrl ? ` · ${change.prUrl}` : ""}`
                  : `  ${change.prNumber ? `PR #${change.prNumber} has unpushed changes` : "No PR yet"}`}
          </text>
        </box>
      ))}
      {needsPush && !chat.readOnly ? (
        <text
          fg={theme.accent}
        >{`[${formatKey(primaryKey("sentry.seer.pushChanges"))}] create/update PRs · /create-pr`}</text>
      ) : null}
    </box>
  );
}

/** Filtered slash commands, immediately above the composer they control. */
function SlashMenu({
  commands,
  selected,
  width,
}: {
  commands: readonly SeerSlashCommand[];
  selected: number;
  width: number;
}) {
  const theme = useTheme();
  return (
    <box
      style={{
        flexDirection: "column",
        width,
        flexShrink: 0,
        border: true,
        borderColor: theme.border,
        backgroundColor: theme.panel,
        paddingLeft: 1,
      }}
    >
      {commands.map((command, index) => (
        <box
          key={command.id}
          style={{
            flexDirection: "row",
            width: Math.max(1, width - 4),
            backgroundColor: index === selected ? theme.selected : undefined,
          }}
        >
          <text fg={index === selected ? theme.accent : theme.text} attributes={BOLD}>
            {command.title.padEnd(19)}
          </text>
          <text fg={theme.muted}>{fitText(command.description, Math.max(1, width - 25))}</text>
        </box>
      ))}
    </box>
  );
}

/** Recent runs returned by Seer's shared run index. */
function SeerHistory({
  chat,
  selected,
  width,
  height,
}: {
  chat: SeerChatState;
  selected: number;
  width: number;
  height: number;
}) {
  const theme = useTheme();
  const runs = valueOf(chat.runs) ?? [];
  const error = errorOf(chat.runs);
  return (
    <scrollbox focused style={{ flexGrow: 1, width: width + 2, height }}>
      <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
        <text fg={theme.text} attributes={BOLD}>
          Recent conversations
        </text>
        <text fg={theme.muted}>j/k select · enter open · esc close</text>
        {isInitialLoad(chat.runs) ? <text fg={theme.muted}>Loading conversations…</text> : null}
        {error ? <text fg={theme.danger}>{error.message}</text> : null}
        {!isInitialLoad(chat.runs) && !error && runs.length === 0 ? (
          <text fg={theme.muted}>No recent conversations.</text>
        ) : null}
        {runs.map((run, index) => (
          <box
            key={run.id}
            style={{
              flexDirection: "row",
              width,
              backgroundColor: index === selected ? theme.selected : undefined,
            }}
          >
            <text fg={index === selected ? theme.accent : theme.muted}>
              {index === selected ? "❯ " : "  "}
            </text>
            <text fg={theme.text}>
              {fitText(run.title ?? "Untitled chat", Math.max(4, width - 10))}
            </text>
            <box style={{ flexGrow: 1 }} />
            <text fg={theme.muted}>{timeAgo(run.lastTriggeredAt)}</text>
          </box>
        ))}
      </box>
    </scrollbox>
  );
}

function SeerBlockView({
  block,
  width,
  spinner,
  chat,
  showTodos,
}: {
  block: SeerBlock;
  width: number;
  spinner: string;
  chat: SeerChatState;
  showTodos: NonNullable<SeerBlock["todos"]>;
}) {
  if (block.message.role === "user") return <UserBlock block={block} width={width} />;
  if (block.message.role === "tool_use") {
    return (
      <ToolUseBlock
        block={block}
        width={width}
        spinner={spinner}
        chat={chat}
        showTodos={showTodos}
      />
    );
  }
  return <AssistantBlock block={block} width={width} spinner={spinner} chat={chat} />;
}

/** The user's own message, marked with a caret so turns are scannable. */
function UserBlock({ block, width }: { block: SeerBlock; width: number }) {
  const theme = useTheme();
  const lines = wrapText(block.message.content ?? "", Math.max(1, width - 3));
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {lines.map((line, index) => (
        <text key={index} fg={theme.text} attributes={BOLD}>
          {index === 0 ? `› ${line}` : `  ${line}`}
        </text>
      ))}
    </box>
  );
}

/** Seer's assistant answer, rendered with native Markdown and streaming support. */
function AssistantBlock({
  block,
  width,
  spinner,
  chat,
}: {
  block: SeerBlock;
  width: number;
  spinner: string;
  chat: SeerChatState;
}) {
  const theme = useTheme();
  const content = block.message.content ?? "";
  if (block.loading && content.trim() === "") {
    return <text fg={theme.muted}>{`  ${spinner} Thinking…`}</text>;
  }

  // Optimistic placeholders are deliberately one row: this is the same flex
  // layout as the web placeholder and keeps the spinner beside “One sec…”.
  if (block.loading && block.id.startsWith("optimistic-assistant-")) {
    return (
      <box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "row" }}>
        <text fg={theme.muted}>{`  ${spinner} ${content}`}</text>
      </box>
    );
  }

  if (!content.trim()) return null;
  return (
    <box style={{ flexDirection: "column", paddingLeft: 3, paddingTop: 1, width }}>
      <SeerMarkdown
        content={content}
        width={Math.max(1, width - 3)}
        streaming={block.loading && chat.capabilities.streaming}
        embedsEnabled={chat.capabilities.embeds}
      />
    </box>
  );
}

/** Tool progress, including Code Mode's calls, links, artifacts, and structured Markdown. */
function ToolUseBlock({
  block,
  width,
  spinner,
  chat,
  showTodos,
}: {
  block: SeerBlock;
  width: number;
  spinner: string;
  chat: SeerChatState;
  showTodos: NonNullable<SeerBlock["todos"]>;
}) {
  const theme = useTheme();
  const status = getBlockStatus(block);
  const blockGlyph = status === "loading" ? spinner : SEER_STATUS_GLYPH[status];
  const blockColor =
    status === "failure"
      ? theme.danger
      : status === "mixed" || status === "pending"
        ? theme.warning
        : theme.muted;
  const classicLines = describeToolCalls(block);
  const calls = block.message.tool_calls ?? [];

  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, width }}>
      {chat.showThinking && block.message.thinking_content?.trim() ? (
        <box style={{ flexDirection: "column", paddingLeft: 2, width: Math.max(1, width - 2) }}>
          <text fg={theme.muted} attributes={BOLD}>
            Thinking
          </text>
          <SeerMarkdown
            content={block.message.thinking_content}
            width={Math.max(1, width - 4)}
            embedsEnabled={chat.capabilities.embeds}
          />
        </box>
      ) : null}

      {calls.flatMap((tool, index) => {
        const result = block.tool_results?.find((entry) => entry?.tool_call_id === tool.id);
        const isCodeMode =
          tool.function === "sentry_api_execute" || tool.function === "sentry_api_search";
        const callRecords = result?.structuredContent?.calls?.length
          ? result.structuredContent.calls
          : calls.length === 1
            ? (block.live_calls ?? [])
            : [];
        const rows = visibleCallRecords(callRecords).flatMap((record) => {
          const label = describeCallRecord(record);
          return label ? [{ record, label }] : [];
        });
        const links = result?.structuredContent?.links ?? [];
        const artifacts = result?.structuredContent?.artifacts ?? [];
        const structuredMarkdown =
          result?.structuredContent && result.content.trimStart().startsWith("{%")
            ? result.content
            : null;

        return [
          ...(rows.length
            ? rows.map(({ record, label }) => (
                <CodeModeCallRow
                  key={`${tool.id ?? index}-${record.id}`}
                  record={record}
                  label={label}
                  settled={Boolean(result)}
                  spinner={spinner}
                />
              ))
            : !isCodeMode
              ? [
                  <text key={`${tool.id ?? index}-classic`} fg={blockColor} attributes={ITALIC}>
                    {`  ${blockGlyph} ${classicLines[index] ?? tool.function}`}
                  </text>,
                ]
              : []),
          ...links
            .filter((link) => link.params?.is_error !== true)
            .map((link, linkIndex) => (
              <text key={`${tool.id ?? index}-link-${linkIndex}`} fg={theme.accent}>
                {`    ↗ ${toolLinkLabel(link.kind, link.params)}`}
              </text>
            )),
          ...artifacts.map((artifact, artifactIndex) => (
            <text key={`${tool.id ?? index}-artifact-${artifactIndex}`} fg={theme.accent}>
              {`    ◇ ${artifact.reason || artifact.key}`}
            </text>
          )),
          ...(structuredMarkdown
            ? [
                <SeerMarkdown
                  key={`${tool.id ?? index}-markdown`}
                  content={structuredMarkdown}
                  width={Math.max(1, width - 3)}
                  embedsEnabled={chat.capabilities.embeds}
                  structuredContent={result?.structuredContent ?? null}
                />,
              ]
            : []),
        ];
      })}

      {showTodos.map((todo, index) => (
        <text
          key={`todo-${index}`}
          fg={todo.status === "completed" ? theme.success : theme.muted}
          attributes={todo.status === "completed" ? DIM : NONE}
        >
          {`    ${todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[~]" : "[ ]"} ${todo.content}`}
        </text>
      ))}
    </box>
  );
}

/** One concrete API/lib action made inside a Code Mode execute. */
function CodeModeCallRow({
  record,
  label,
  settled,
  spinner,
}: {
  record: SeerCallRecord;
  label: string;
  settled: boolean;
  spinner: string;
}) {
  const theme = useTheme();
  const status = getCallRecordStatus(record, settled);
  const glyph = status === "loading" ? spinner : status === "failure" ? "✗" : "✓";
  const color = status === "failure" ? theme.danger : theme.muted;
  const details = describeCallRecordDetail(record);
  const suffix = record.error
    ? ` — ${record.error}`
    : record.status !== undefined && record.status >= 400
      ? ` — HTTP ${record.status}`
      : "";
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={color} attributes={ITALIC}>
        {`  ${glyph} ${label}${suffix}`}
      </text>
      {details.map((detail, index) => (
        <text key={index} fg={theme.subText}>{`      ${detail}`}</text>
      ))}
    </box>
  );
}

/** Prefer Seer's human summary, then derive a non-internal link label. */
function toolLinkLabel(kind: string, params: SeerToolLink["params"]): string {
  const summary = params?.["summary"];
  if (typeof summary === "string" && summary.trim()) return summary;
  return `View ${kind.replace(/^get_/, "").replace(/_/g, " ")}`;
}

/** The action surface for a run paused on user input. */
function PendingInputCard({
  pending,
  state,
  width,
}: {
  pending: SeerPendingUserInput;
  state: SeerExplorerProps["pendingState"];
  width: number;
}) {
  const theme = useTheme();
  const cardStyle = {
    flexDirection: "column" as const,
    width: Math.max(8, width - 2),
    border: true,
    borderColor: theme.warning,
    paddingLeft: 1,
    marginTop: 1,
  };

  if (pending.input_type === "file_change_approval") {
    const patches = Array.isArray(pending.data["patches"]) ? pending.data["patches"] : [];
    const patch = patches[state.fileApprovalIndex];
    const record = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
    const body =
      record["patch"] && typeof record["patch"] === "object"
        ? (record["patch"] as Record<string, unknown>)
        : record;
    const path = String(body["path"] ?? body["file_path"] ?? "proposed file change");
    const diff = String(body["diff"] ?? record["diff"] ?? "");
    return (
      <box style={cardStyle}>
        <text fg={theme.warning} attributes={BOLD}>
          {`Make this change? (${state.fileApprovalIndex + 1} of ${patches.length})`}
        </text>
        <text fg={theme.text}>{path}</text>
        {wrapText(diff, Math.max(1, width - 5))
          .slice(0, 10)
          .map((line, index) => (
            <text
              key={index}
              fg={
                line.startsWith("+")
                  ? theme.success
                  : line.startsWith("-")
                    ? theme.danger
                    : theme.muted
              }
            >
              {line}
            </text>
          ))}
        <text fg={theme.accent}>[y] approve · [x] reject</text>
      </box>
    );
  }

  if (pending.input_type === "agent_write_approval") {
    const scopes = Array.isArray(pending.data["required_scopes"])
      ? pending.data["required_scopes"].filter(
          (scope): scope is string => typeof scope === "string",
        )
      : [];
    return (
      <box style={cardStyle}>
        <text fg={theme.warning} attributes={BOLD}>
          Allow Seer to make changes?
        </text>
        <text fg={theme.muted}>Requested scopes:</text>
        {scopes.map((scope) => (
          <text key={scope} fg={theme.text}>{`  ${scope}`}</text>
        ))}
        <text fg={theme.accent}>[y] approve · [x] reject</text>
      </box>
    );
  }

  if (pending.input_type === "ask_user_question") {
    const rawQuestions = Array.isArray(pending.data["questions"]) ? pending.data["questions"] : [];
    const raw = rawQuestions[state.questionIndex];
    const question = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const options = Array.isArray(question["options"]) ? question["options"] : [];
    return (
      <box style={cardStyle}>
        <text fg={theme.text} attributes={BOLD}>
          {String(question["question"] ?? "Seer has a question")}
        </text>
        {options.map((option, index) => {
          const item =
            option && typeof option === "object" ? (option as Record<string, unknown>) : {};
          return (
            <box
              key={index}
              style={{
                flexDirection: "column",
                backgroundColor: index === state.questionSelected ? theme.selected : undefined,
              }}
            >
              <text
                fg={index === state.questionSelected ? theme.accent : theme.text}
              >{`${index + 1}. ${String(item["label"] ?? "Option")}`}</text>
              {item["description"] ? (
                <text fg={theme.muted}>{`   ${String(item["description"])}`}</text>
              ) : null}
            </box>
          );
        })}
        <text fg={state.questionSelected === options.length ? theme.accent : theme.muted}>
          o. Other — type your own answer
        </text>
        <text fg={theme.muted}>j/k select · enter confirm</text>
      </box>
    );
  }

  return (
    <box style={cardStyle}>
      <text fg={theme.warning} attributes={BOLD}>
        Reconnect your monitoring provider in Sentry
      </text>
      <text fg={theme.muted}>This run will resume after the connection is restored.</text>
    </box>
  );
}

/** The Seer eye, drawn at a size that survives a small terminal. */
const SEER_MARK = ["   ▄▄▄   ", " ▄█████▄ ", "███ ● ███", " ▀█████▀ ", "  ▀▀▀▀▀  "];

function SeerEmptyState({ width }: { width: number }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {SEER_MARK.map((line, index) => (
        <text key={index} fg={theme.accent}>{`  ${line}`}</text>
      ))}
      <text fg={theme.text} attributes={BOLD}>
        {"\n  Ask Seer anything about your application."}
      </text>
      <text fg={theme.muted}>{"  Try one of these:"}</text>
      {SEER_SUGGESTED_QUESTIONS.map((question, index) => (
        <text key={question} fg={theme.accent}>
          {`  ${index + 1}. ${wrapText(question, Math.max(1, width - 6))[0] ?? question}`}
        </text>
      ))}
      <text fg={theme.subText}>
        {`\n  ${formatKey(primaryKey("sentry.seer.compose"))} to type, ${formatKey(primaryKey("sentry.nav.open"))} to send, ${formatKey(primaryKey("sentry.seer.newChat"))} new, ${formatKey(primaryKey("sentry.seer.history"))} history`}
      </text>
    </box>
  );
}
