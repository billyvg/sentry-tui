/**
 * Explore › Conversations — one row per gen-AI conversation.
 *
 * The screen the web actually shows: `/ai-conversations/` rolls the gen-AI
 * spans of a trace into a conversation, so a row is a whole exchange — its
 * title, what it cost, how many model and tool calls it took — rather than one
 * model call. `docs/plans/002-explore-dashboards-monitors.md` §7.2 described
 * it as `dataset=spans`; that is the span-level view underneath, and a
 * different screen.
 *
 * The layout is its Explore siblings': search box, filter row, volume chart,
 * table. The chart is still Discover, over the same spans, as upstream's is.
 *
 * Read-only. Enter opens an inline panel with the first prompt and the last
 * reply; nothing here writes.
 */

import { useCallback, useEffect } from "react";

import {
  conversationIdLabel,
  conversationTitle,
  conversationUserLabel,
  type Conversation,
} from "~/api/aiConversations";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import type { Theme } from "~/core/theme";
import {
  CONVERSATION_CHART,
  CONVERSATION_NOUN,
  conversationEmptyLines,
} from "~/core/conversations";
import { useTheme } from "~/ui/theme";
import { countLabel, formatCount, timeAgo } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { BarChart, CHART_ROWS, fitsChart } from "~/ui/components/BarChart";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { SearchInput } from "~/ui/components/SearchInput";
import { useConversations } from "~/ui/hooks/useConversations";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD, DIM } from "~/ui/lib/attributes";
import { formatCost, formatDuration } from "~/ui/screens/exploreColumns";
import type { ScreenProps } from "~/ui/screens/types";

/** Cells the title keeps before a fixed column is shed instead. */
const TITLE_MIN_FLEX = 28;

/** Shown when neither a generated title nor a first message came back. */
const UNTITLED = "Untitled conversation";

/**
 * Conversation · Duration · Messages · Errors · Cost · Tools · Age, in the
 * web's own column order (`conversationsTable.tsx:70-78`).
 *
 * The title never sheds — a list of conversations with the titles hidden is a
 * list of identical rows. Tools goes first: it is the widest column and the
 * one most often empty. Cost and messages hold out longest, because they are
 * the two numbers people open this screen to add up.
 */
function conversationColumns(theme: Theme): ReadonlyArray<Column<Conversation>> {
  return [
    {
      key: "conversation",
      label: "Conversation",
      width: "flex",
      render: (conversation, _selected, width) => {
        const title = conversationTitle(conversation);
        return (
          <text fg={title ? theme.text : theme.subText}>{padText(title ?? UNTITLED, width)}</text>
        );
      },
    },
    {
      key: "duration",
      label: "Duration",
      width: 9,
      align: "right",
      priority: 2,
      render: (conversation, _selected, width) => (
        <text fg={theme.text}>
          {padText(formatDuration(conversation.generationDurationMs), width, "right")}
        </text>
      ),
    },
    {
      key: "messages",
      label: "Msgs",
      width: 5,
      align: "right",
      priority: 5,
      render: (conversation, _selected, width) => (
        <text fg={theme.text}>{padText(formatCount(conversation.llmCalls), width, "right")}</text>
      ),
    },
    {
      key: "errors",
      label: "Errs",
      width: 5,
      align: "right",
      priority: 3,
      render: (conversation, _selected, width) => {
        const errors = conversation.errors;
        return (
          <text fg={errors > 0 ? theme.danger : theme.subText} attributes={errors > 0 ? BOLD : 0}>
            {padText(errors > 0 ? formatCount(errors) : "·", width, "right")}
          </text>
        );
      },
    },
    {
      key: "cost",
      label: "Cost",
      width: 9,
      align: "right",
      priority: 6,
      render: (conversation, _selected, width) => (
        <text fg={theme.accent}>{padText(formatCost(conversation.totalCost), width, "right")}</text>
      ),
    },
    {
      key: "tools",
      label: "Tools",
      width: 20,
      priority: 1,
      render: (conversation, _selected, width) => (
        <text fg={theme.subText}>{padText(toolSummary(conversation, width), width)}</text>
      ),
    },
    {
      key: "age",
      label: "Age",
      width: 5,
      align: "right",
      priority: 4,
      render: (conversation, _selected, width) => (
        <text fg={theme.muted}>{padText(timeAgo(conversation.endedAt), width, "right")}</text>
      ),
    },
  ];
}

/**
 * The tools a conversation called, as many as fit, then `+N`.
 *
 * The web wraps them into tag chips over two rows and collapses the overflow
 * the same way (`conversationsTable.tsx:48-56`); one line has less room, so
 * the arithmetic is the same and the budget is smaller.
 */
function toolSummary(conversation: Conversation, width: number): string {
  const names = conversation.toolNames;
  if (names.length === 0)
    return conversation.toolCalls > 0 ? `${conversation.toolCalls} calls` : "";

  const shown: string[] = [];
  let used = 0;
  for (const name of names) {
    const cost = (shown.length > 0 ? 2 : 0) + name.length;
    // Leave room for the "+N" that says what was left out.
    if (used + cost > width - (shown.length < names.length - 1 ? 3 : 0)) break;
    shown.push(name);
    used += cost;
  }
  if (shown.length === 0) shown.push(names[0]!);

  const hidden = names.length - shown.length;
  return hidden > 0 ? `${shown.join(", ")} +${hidden}` : shown.join(", ");
}

export function ConversationList({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  onProjectSelect,
  registerActions,
  activateRow,
}: ScreenProps) {
  const theme = useTheme();
  const { setEntries, setStatus, setOpenDropdown, setDetailOpen, focusSearch, handleSearchBlur } =
    state;

  const query = state.committedQuery;
  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;

  const { conversations, timeseries } = useConversations(client, {
    org,
    query,
    statsPeriod: state.statsPeriod,
    project,
    environment,
    reloadToken,
  });

  const loading = conversations.state === "loading";
  const since = loadingSince(conversations);

  const rows = valueOf(conversations);
  const error = errorOf(conversations);
  const buckets = valueOf(timeseries);

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      since,
      error: error?.message,
      noun: CONVERSATION_NOUN,
    });
  }, [loading, since, error, conversations, setStatus]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  // Enter toggles an inline panel rather than pushing a view, as the other
  // Explore screens do: the cursor keys keep working while it is open.
  useScreenActions(registerActions, {
    open: () => setDetailOpen((open) => !open),
    back: () => {
      if (!state.detailOpen) return false;
      setDetailOpen(false);
      return true;
    },
  });

  const selected = rows?.[state.selected] ?? null;
  const showDetail = state.detailOpen && selected !== null;
  const hasChart = !showDetail && fitsChart(height) && buckets !== undefined && buckets.length > 0;
  const inner = Math.max(20, width - 2);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInput
        value={state.searchQuery}
        placeholder="Search AI conversations…"
        focused={state.searchFocused}
        width={width}
        onInput={state.setSearchQuery}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sortLabel={rows ? countLabel(rows.length, "conversation") : ""}
        width={width}
        anchorTop={SEARCH_ROWS}
        onProjectChange={onProjectSelect}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      {hasChart && buckets ? (
        <BarChart
          buckets={buckets}
          width={inner}
          height={CHART_ROWS}
          title={CONVERSATION_CHART.yAxis}
          noun={CONVERSATION_CHART.noun}
        />
      ) : null}

      <DataTable
        rows={rows}
        columns={conversationColumns(theme)}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(conversation, index) => `${index}:${conversation.id}`}
        minFlex={TITLE_MIN_FLEX}
        loading={isInitialLoad(conversations)}
        error={error}
        errorTitle="Failed to load conversations"
        onRowClick={activateRow}
        // The web's second line: which conversation, in which project, with
        // whom. `DataTable` makes every row two lines tall, skeleton included.
        renderDetail={(conversation, selected, rowWidth) =>
          renderIdentity(conversation, selected, rowWidth, theme)
        }
        empty={{
          title: "No conversations found.",
          lines: conversationEmptyLines(query),
        }}
        layout={[height, hasChart, showDetail]}
      />

      {showDetail && selected ? <ConversationDetail conversation={selected} width={inner} /> : null}
    </box>
  );
}

/**
 * The row's second line: conversation id, project, and who was talking —
 * the web's `ConversationCell` metadata row (`conversationsTable.tsx:359-374`)
 * without the avatar a terminal has no room for.
 */
function renderIdentity(
  conversation: Conversation,
  _selected: boolean,
  width: number,
  theme: Theme,
) {
  const parts = [
    conversationIdLabel(conversation.id),
    conversation.projectId ? `project ${conversation.projectId}` : undefined,
    conversationUserLabel(conversation.user),
    conversation.traceCount > 1 ? `${conversation.traceCount} traces` : undefined,
  ].filter(Boolean);
  return (
    <text fg={theme.subText} attributes={DIM}>
      {padText(`  ${parts.join("  │  ")}`, width)}
    </text>
  );
}

/**
 * What the conversation was about: the opening prompt and the closing reply,
 * plus the totals the row had no room for.
 */
function ConversationDetail({
  conversation,
  width,
}: {
  conversation: Conversation;
  width: number;
}) {
  const theme = useTheme();
  const inner = Math.max(10, width - 2);
  return (
    <box
      style={{
        flexDirection: "column",
        width,
        border: ["top"],
        borderColor: theme.border,
        paddingTop: 1,
        flexShrink: 0,
      }}
    >
      <text fg={theme.accent} attributes={BOLD}>
        {`▾ ${fitText(conversationTitle(conversation) ?? UNTITLED, width - 2)}`}
      </text>
      {/* Skipped when the heading above already *is* the first message, which
          is what an untitled conversation falls back to. */}
      {conversation.firstInput && conversation.title ? (
        <text fg={theme.text}>{fitText(`  → ${collapse(conversation.firstInput)}`, inner)}</text>
      ) : null}
      {conversation.lastOutput ? (
        <text fg={theme.muted}>{fitText(`  ← ${collapse(conversation.lastOutput)}`, inner)}</text>
      ) : null}
      <text fg={theme.muted}>
        {fitText(
          `  ${countLabel(conversation.llmCalls, "call")}  │  ` +
            `${countLabel(conversation.toolCalls, "tool")}  │  ` +
            `${formatCount(conversation.inputTokens)} in / ${formatCount(conversation.outputTokens)} out  │  ` +
            `${formatCost(conversation.totalCost)}  │  ${formatDuration(conversation.generationDurationMs)}`,
          inner,
        )}
      </text>
      {conversation.traceIds[0] ? (
        <text fg={theme.subText} attributes={DIM}>
          {fitText(`  trace ${conversation.traceIds[0]}`, inner)}
        </text>
      ) : null}
    </box>
  );
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
