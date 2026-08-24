import { useCallback, useRef } from "react";
import { RenderableEvents, type InputRenderable } from "@opentui/core";

import type { SeerBlock } from "~/api/seer";
import { formatKey, primaryKey } from "~/core/commands";
import {
  describeToolCalls,
  getBlockStatus,
  SEER_STATUS_GLYPH,
  SEER_SUGGESTED_QUESTIONS,
} from "~/core/seer";
import { useTheme } from "~/ui/theme";
import { wrapText } from "~/lib/text";
import { useSpinnerFrame } from "~/ui/components/Spinner";
import { BOLD, DIM, ITALIC, NONE } from "~/ui/lib/attributes";
import type { SeerChatState } from "~/ui/hooks/useSeerChat";

/** Rows taken by the composer, including its border. */
const COMPOSER_HEIGHT = 3;

export interface SeerExplorerProps {
  chat: SeerChatState;
  width: number;
  height: number;
  focused: boolean;
  /** Current composer text — owned by `App` so it survives navigation. */
  value: string;
  onInput: (value: string) => void;
  inputFocused: boolean;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}

/**
 * The "Ask Seer" conversation, as a full screen.
 *
 * The web app puts this in a right-hand drawer beside whatever page you were
 * on; a terminal has no room for that, so the conversation gets the whole
 * content pane and the composer is pinned to the bottom.
 */
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
}: SeerExplorerProps) {
  const theme = useTheme();
  const inner = Math.max(10, width - 2);
  const transcriptHeight = Math.max(1, height - COMPOSER_HEIGHT);
  const spinner = useSpinnerFrame(chat.thinking);

  const inputRef = useRef<InputRenderable>(null);

  // Sync native focus/blur (e.g. mouse clicks) back to the parent.
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

  const placeholder = chat.timedOut
    ? "Response timed out. Please try again."
    : chat.interrupting
      ? "Interrupted. What should Seer do instead?"
      : "Ask Seer a question about your application…";

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/* A chat reads bottom-up: pin to the newest turn unless the user
          scrolls away, which is what `stickyScroll` gives us for free. */}
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
            <SeerBlockView key={block.id} block={block} width={inner} spinner={spinner} />
          ))
        )}

        {chat.error ? (
          <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
            <text fg={theme.danger}>Seer request failed</text>
            <text fg={theme.muted}>{chat.error.message}</text>
          </box>
        ) : null}

        {chat.timedOut ? (
          <box style={{ paddingLeft: 1, paddingTop: 1 }}>
            <text fg={theme.warning}>Seer stopped responding. Send another message to retry.</text>
          </box>
        ) : null}
      </scrollbox>

      {/* Composer, matching the bordered input used by the other screens. */}
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
            placeholderColor: chat.timedOut || chat.interrupting ? theme.warning : theme.subText,
          }}
        />
      </box>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function SeerBlockView({
  block,
  width,
  spinner,
}: {
  block: SeerBlock;
  width: number;
  spinner: string;
}) {
  if (block.message.role === "user") return <UserBlock block={block} width={width} />;
  if (block.message.role === "tool_use") {
    return <ToolUseBlock block={block} spinner={spinner} />;
  }
  return <AssistantBlock block={block} width={width} spinner={spinner} />;
}

/** The user's own message, marked with a caret so turns are scannable. */
function UserBlock({ block, width }: { block: SeerBlock; width: number }) {
  const theme = useTheme();
  const lines = wrapText(block.message.content ?? "", Math.max(1, width - 3));
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {lines.map((line, i) => (
        <text key={i} fg={theme.text} attributes={BOLD}>
          {i === 0 ? `› ${line}` : `  ${line}`}
        </text>
      ))}
    </box>
  );
}

/**
 * Seer's answer. Markdown arrives as raw text; a terminal has no renderer for
 * it, so it is wrapped and shown verbatim rather than half-parsed.
 */
function AssistantBlock({
  block,
  width,
  spinner,
}: {
  block: SeerBlock;
  width: number;
  spinner: string;
}) {
  const theme = useTheme();
  const content = block.message.content ?? "";
  const lines = wrapText(content, Math.max(1, width - 3));

  if (block.loading && content.trim() === "") {
    return (
      <box style={{ paddingLeft: 1, paddingTop: 1 }}>
        <text fg={theme.muted}>{`${spinner} Thinking…`}</text>
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {lines.map((line, i) => (
        <text key={i} fg={theme.text}>
          {`  ${line}`}
        </text>
      ))}
      {block.loading ? <text fg={theme.muted}>{`  ${spinner}`}</text> : null}
    </box>
  );
}

/**
 * The running commentary — "Reading app.tsx from sentry…" — that tells the
 * user Seer is making progress rather than hanging.
 */
function ToolUseBlock({ block, spinner }: { block: SeerBlock; spinner: string }) {
  const theme = useTheme();
  const status = getBlockStatus(block);
  const glyph = status === "loading" ? spinner : SEER_STATUS_GLYPH[status];
  const color =
    status === "failure"
      ? theme.danger
      : status === "mixed" || status === "pending"
        ? theme.warning
        : theme.muted;

  const lines = describeToolCalls(block);
  const todos = block.todos ?? [];

  return (
    <box style={{ flexDirection: "column", paddingLeft: 1 }}>
      {lines.map((line, i) => (
        <text key={i} fg={color} attributes={ITALIC}>
          {`  ${glyph} ${line}`}
        </text>
      ))}
      {todos.map((todo, i) => (
        <text
          key={`todo-${i}`}
          fg={todo.status === "completed" ? theme.success : theme.muted}
          attributes={todo.status === "completed" ? DIM : NONE}
        >
          {`    ${todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[~]" : "[ ]"} ${todo.content}`}
        </text>
      ))}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

/** The Seer eye, drawn at a size that survives a small terminal. */
const SEER_MARK = ["   ▄▄▄   ", " ▄█████▄ ", "███ ● ███", " ▀█████▀ ", "  ▀▀▀▀▀  "];

function SeerEmptyState({ width }: { width: number }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {SEER_MARK.map((line, i) => (
        <text key={i} fg={theme.accent}>
          {`  ${line}`}
        </text>
      ))}
      <text fg={theme.text} attributes={BOLD}>
        {"\n  Ask Seer anything about your application."}
      </text>
      <text fg={theme.muted}>{"  Try one of these:"}</text>
      {SEER_SUGGESTED_QUESTIONS.map((question, i) => (
        <text key={question} fg={theme.accent}>
          {`  ${i + 1}. ${wrapText(question, Math.max(1, width - 6))[0] ?? question}`}
        </text>
      ))}
      <text fg={theme.subText}>
        {`\n  ${formatKey(primaryKey("sentry.seer.compose"))} to type, ${formatKey(
          primaryKey("sentry.nav.open"),
        )} to send, ${formatKey(primaryKey("sentry.seer.newChat"))} for a new chat`}
      </text>
    </box>
  );
}
