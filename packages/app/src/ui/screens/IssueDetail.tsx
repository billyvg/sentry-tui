import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";

import type { ScrollBoxRenderable } from "@opentui/core";

import type { SentryClient } from "~/api/client";
import type { EventSelector } from "~/api/issues";
import { findEntry, GroupStatus, type Breadcrumb, type Group, type SentryEvent } from "~/api/types";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { matchesCommand } from "~/core/commands";
import { issueMessage, issueTitle } from "~/lib/issueText";
import { countLabel, sparklineBlock, timeAgo } from "~/lib/sparkline";
import { buildStackRows } from "~/lib/stacktrace";
import { fitText, measureTextWidth } from "~/lib/text";
import { CHIP_HEIGHT, ChipRow, chipOffsets, type ChipSpec } from "~/ui/components/Chip";
import {
  BODY_INDENT,
  Divider,
  Empty,
  Field,
  KEY_COLUMN,
  keyCell,
  Section,
  useSectionFolds,
} from "~/ui/components/DetailSections";
import { PlatformIcon } from "~/ui/components/PlatformIcon";
import { Placeholder } from "~/ui/components/Placeholder";
import { ExceptionSection, stackFrameKey } from "~/ui/components/StackTrace";
import { Dropdown, type DropdownItem } from "~/ui/components/Dropdown";
import { BOLD } from "~/ui/lib/attributes";
import { consumeKey } from "~/ui/lib/keyRouting";
import { useIssueEvent } from "~/ui/hooks/useIssueEvent";
import { useTheme } from "~/ui/theme";

/** Section ids, mirroring `views/issueDetails/context.tsx`'s SectionKey. */
export type SectionKey = "exception" | "breadcrumbs" | "request" | "tags" | "contexts" | "sdk";

/** Render order, from `groupEventDetailsContent.tsx`. */
const SECTION_ORDER: SectionKey[] = [
  "exception",
  "breadcrumbs",
  "request",
  "tags",
  "contexts",
  "sdk",
];

const SECTION_TITLES: Record<SectionKey, string> = {
  exception: "Stack Trace",
  breadcrumbs: "Breadcrumbs",
  request: "Request",
  tags: "Tags",
  contexts: "Contexts",
  sdk: "SDK",
};

/** One column per hour of the 24h window, when the series is that long. */
const HEADER_SPARKLINE_WIDTH = 24;
/** Rows of block glyphs in the header chart — 24 levels of vertical detail. */
const HEADER_SPARKLINE_ROWS = 3;
/** Renderable id used to keep the frame cursor inside the detail viewport. */
const SELECTED_FRAME_ID = "issue-detail-selected-frame";
/** The header rows above the action chips: title, message, state, and chart. */
const HEADER_ACTIONS_TOP = 8;
const ISSUE_ACTIONS_COMMAND = "sentry.issue.actions";

export function IssueDetail({
  client,
  org,
  group,
  width,
  height,
  focused,
  eventId,
  reloadToken,
  runIssueAction,
  openIssueAutofix,
}: {
  client: SentryClient | null;
  org: string;
  group: Group;
  width: number;
  height: number;
  focused: boolean;
  /** Exact event selected by a copied web URL; defaults to the latest. */
  eventId?: EventSelector;
  /** Bump to refetch the issue's event — the app's global refresh. */
  reloadToken?: number;
  /** Run a triage action through the app's shared optimistic mutation path. */
  runIssueAction: (commandId: string, issue: Group) => void;
  /** Open Seer over this detail and ask it to investigate the issue. */
  openIssueAutofix: (issue: Group) => void;
}) {
  const theme = useTheme();
  const status = useIssueEvent(client, { org, issueId: group.id, eventId, reloadToken });
  const event = valueOf(status);
  const error = errorOf(status);
  const loading = isInitialLoad(status);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const { collapsed, toggle } = useSectionFolds(SECTION_ORDER, focused);
  const [selectedFrameKey, setSelectedFrameKey] = useState<string>();
  const selectedFrameKeyRef = useRef(selectedFrameKey);
  const [frameExpansion, setFrameExpansion] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const frameRows = event
    ? (findEntry(event.entries, "exception")?.data.values ?? []).flatMap((value, exceptionIndex) =>
        buildStackRows(value.stacktrace)
          .filter((row) => row.kind === "frame")
          .map((row) => ({
            key: stackFrameKey(event.id, exceptionIndex, row.index),
            row,
          })),
      )
    : [];
  const selectedFrame = frameRows.find((frame) => frame.key === selectedFrameKey) ?? frameRows[0];
  const defaultExpandedFrame = frameRows[0]?.key;
  const expandedFrames = new Set(
    frameRows
      .filter((frame) => frameExpansion.get(frame.key) ?? frame.key === defaultExpandedFrame)
      .map((frame) => frame.key),
  );

  useLayoutEffect(() => {
    if (selectedFrameKey === selectedFrame?.key) return;
    selectedFrameKeyRef.current = selectedFrame?.key;
    setSelectedFrameKey(selectedFrame?.key);
  }, [selectedFrame?.key, selectedFrameKey]);

  /** Expand or collapse one visible frame without disturbing the others. */
  const toggleFrame = useCallback(
    (key: string) => {
      setFrameExpansion((current) => {
        const next = new Map(current);
        const expanded = current.get(key) ?? key === defaultExpandedFrame;
        next.set(key, !expanded);
        return next;
      });
    },
    [defaultExpandedFrame],
  );

  /** Select one visible frame and synchronously expose it to the next key event. */
  const selectFrameAt = useCallback(
    (position: number) => {
      const next = frameRows[Math.max(0, Math.min(position, frameRows.length - 1))];
      if (!next) return;
      selectedFrameKeyRef.current = next.key;
      setSelectedFrameKey(next.key);
    },
    [frameRows],
  );

  /** Put a clicked frame under the cursor and toggle its context directly. */
  const clickFrame = useCallback(
    (key: string) => {
      const position = frameRows.findIndex((frame) => frame.key === key);
      if (position < 0) return;
      selectFrameAt(position);
      toggleFrame(key);
    },
    [frameRows, selectFrameAt, toggleFrame],
  );

  useKeyboard((key) => {
    if (!focused) return;
    if (matchesCommand(ISSUE_ACTIONS_COMMAND, key)) {
      setActionsOpen((open) => !open);
      consumeKey(key);
      return;
    }
    if (actionsOpen || collapsed.has("exception") || !selectedFrame) return;
    if (matchesCommand("sentry.nav.down", key)) {
      const current = Math.max(
        0,
        frameRows.findIndex((frame) => frame.key === selectedFrameKeyRef.current),
      );
      // Once the last frame is selected, give the key back to the focused
      // scrollbox so j/down can continue into the sections below the trace.
      if (current >= frameRows.length - 1) return;
      selectFrameAt(current + 1);
      consumeKey(key);
      return;
    }
    if (matchesCommand("sentry.nav.up", key)) {
      const current = Math.max(
        0,
        frameRows.findIndex((frame) => frame.key === selectedFrameKeyRef.current),
      );
      // The matching top boundary lets k/up reach the issue header again.
      if (current === 0) return;
      selectFrameAt(current - 1);
      consumeKey(key);
      return;
    }
    if (matchesCommand("sentry.nav.open", key)) {
      const liveFrame =
        frameRows.find((frame) => frame.key === selectedFrameKeyRef.current) ?? selectedFrame;
      toggleFrame(liveFrame.key);
      consumeKey(key);
    }
  });

  useEffect(() => {
    scrollRef.current?.scrollChildIntoView(SELECTED_FRAME_ID);
  }, [selectedFrame?.key, frameExpansion, height]);

  const inner = Math.max(20, width - 2);
  const actions = headerActions(group);
  const actionsIndex = actions.findIndex((chip) => chip.command === ISSUE_ACTIONS_COMMAND);
  const actionsAnchorLeft =
    BODY_INDENT.length + (chipOffsets(actions)[Math.max(0, actionsIndex)] ?? 0);
  const actionItems: DropdownItem[] = [
    {
      value: "sentry.issue.bookmark",
      label: group.isBookmarked ? "Unbookmark" : "Bookmark",
    },
    ...(!group.hasSeen
      ? [
          {
            value: "sentry.issue.markReviewed",
            label: "Mark reviewed",
          },
        ]
      : []),
    { value: "autofix", label: "Autofix" },
  ];

  /** Run the selected menu action, then reveal the updated detail underneath. */
  const selectAction = useCallback(
    (values: string[]) => {
      const action = values[0];
      setActionsOpen(false);
      if (action === "autofix") {
        openIssueAutofix(group);
      } else if (action) {
        runIssueAction(action, group);
      }
    },
    [group, openIssueAutofix, runIssueAction],
  );

  /** Mouse presses use the same command paths as their keyboard equivalents. */
  const pressHeaderAction = useCallback(
    (chip: ChipSpec) => {
      if (chip.command === ISSUE_ACTIONS_COMMAND) {
        setActionsOpen((open) => !open);
      } else {
        runIssueAction(chip.command, group);
      }
    },
    [group, runIssueAction],
  );

  return (
    <>
      {/*
       * No `flexDirection` here: a scrollbox lays its own root out as a row —
       * viewport first, vertical scrollbar beside it — and forwards padding to
       * the content box, which stacks its children in a column already. Setting
       * `column` on the root instead stacks the scrollbar *under* the viewport,
       * which halves the visible height and leaves the bar floating in the dead
       * space below the content.
       */}
      <scrollbox
        ref={scrollRef}
        focused={focused}
        // Matches the stream screens: a continuously drawn track reads as a
        // scroll rail rather than as a stray mark at the edge of the pane.
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
        }}
        style={{ width, height, paddingLeft: 1 }}
      >
        <IssueHeader
          group={group}
          width={inner}
          actions={actions}
          actionsOpen={actionsOpen}
          onActionPress={pressHeaderAction}
        />

        {loading ? <text fg={theme.muted}>{`${BODY_INDENT}Loading event…`}</text> : null}

        {error ? (
          <box style={{ flexDirection: "column", paddingTop: 1 }}>
            <text fg={theme.danger}>{`${BODY_INDENT}Failed to load event`}</text>
            <text fg={theme.muted}>{fitText(`${BODY_INDENT}${error.message}`, inner)}</text>
          </box>
        ) : null}

        {event
          ? SECTION_ORDER.map((key, i) => (
              <Section
                key={key}
                index={i + 1}
                title={SECTION_TITLES[key]}
                count={sectionCount(key, event)}
                collapsed={collapsed.has(key)}
                width={inner}
                onToggle={() => toggle(key)}
              >
                <SectionBody
                  sectionKey={key}
                  event={event}
                  width={inner}
                  expandedFrames={expandedFrames}
                  selectedFrame={selectedFrame?.key}
                  selectedFrameId={SELECTED_FRAME_ID}
                  onFrameClick={clickFrame}
                />
              </Section>
            ))
          : null}
      </scrollbox>

      {actionsOpen ? (
        <Dropdown
          title="Actions"
          items={actionItems}
          selected={[]}
          anchorLeft={actionsAnchorLeft}
          anchorTop={HEADER_ACTIONS_TOP + CHIP_HEIGHT}
          availableWidth={width}
          showAll={false}
          showSelection={false}
          onSelect={selectAction}
          onClose={() => setActionsOpen(false)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * The action chips, derived from the state they'd change.
 *
 * Only bound, implemented actions get a chip: a control that looks pressable
 * and does nothing is worse than no control.
 */
function headerActions(group: Group): ChipSpec[] {
  return [
    group.status === GroupStatus.RESOLVED
      ? { command: "sentry.issue.unresolve", label: "unresolve", inlineHotkey: true }
      : { command: "sentry.issue.resolve", label: "resolve", inlineHotkey: true },
    group.status === GroupStatus.IGNORED
      ? { command: "sentry.issue.archive", label: "unarchive", inlineHotkey: true }
      : { command: "sentry.issue.archive", label: "archive", inlineHotkey: true },
    { command: ISSUE_ACTIONS_COMMAND, label: "actions", inlineHotkey: true, caret: true },
  ];
}

/**
 * The header's own chart, sized to the data rather than to a column.
 *
 * `sparklineBlock` left-pads a short series so a stream column stays
 * right-aligned; here there is no column to align to, and that padding would
 * just open a gap between the "24h" label and its chart.
 */
function headerSparkline(group: Group): string[] {
  const series = group.stats?.["24h"];
  const width = series?.length ? Math.min(HEADER_SPARKLINE_WIDTH, series.length) : 0;
  return sparklineBlock(series, width || HEADER_SPARKLINE_WIDTH, HEADER_SPARKLINE_ROWS, {
    floor: true,
  });
}

function IssueHeader({
  group,
  width,
  actions,
  actionsOpen,
  onActionPress,
}: {
  group: Group;
  width: number;
  actions: readonly ChipSpec[];
  actionsOpen: boolean;
  onActionPress: (chip: ChipSpec) => void;
}) {
  const theme = useTheme();
  const level = theme.level[group.level] ?? theme.level.unknown;
  const titleWidth = Math.max(12, width - 2);
  const chart = headerSparkline(group);
  // Pinned rather than left to the content: the rows are equal length by
  // construction, but their trailing cells are blank whenever the last hours
  // were quiet, so an auto-sized column would be as wide as the issue happened
  // to be busy and the metadata beside it would shift from issue to issue.
  const chartWidth = Math.max(...chart.map(measureTextWidth));

  return (
    <box style={{ flexDirection: "column", width }}>
      {/* The level bar spans both title lines, as it does in the stream row. */}
      <box style={{ flexDirection: "row", width }}>
        <text fg={level}>{"┃ "}</text>
        <Placeholder
          text={issueTitle(group)}
          fallback="(no title)"
          width={titleWidth}
          fg={theme.text}
          attributes={BOLD}
        />
      </box>

      <box style={{ flexDirection: "row", width }}>
        <text fg={level}>{"┃ "}</text>
        <Placeholder
          text={issueMessage(group)}
          fallback="(no error message)"
          width={titleWidth}
          fg={theme.muted}
        />
      </box>

      {/* Metadata not already represented by an action chip. */}
      <box style={{ flexDirection: "row", width, paddingTop: 1 }}>
        <text>{BODY_INDENT}</text>
        <PlatformIcon platform={group.project.platform} />
        <text fg={theme.muted}>{group.project.slug}</text>
        <Divider />
        <text fg={theme.muted}>
          {group.priority ? `${group.priority} priority` : "no priority"}
        </text>
        <Divider />
        <text fg={theme.muted}>{group.assignedTo?.name ?? "unassigned"}</text>
      </box>

      {/*
       * Volume. The counts sit beside the timestamps because they answer the
       * same question — how much, over what span — and the chart is the same
       * answer drawn. Everything but the chart is one line tall, so it centers
       * against the chart's middle row rather than sitting on its baseline.
       */}
      <box style={{ flexDirection: "row", width, alignItems: "center", paddingTop: 1 }}>
        <text>{BODY_INDENT}</text>
        <text fg={theme.muted}>{"24h "}</text>
        <box
          style={{
            flexDirection: "column",
            alignItems: "flex-start",
            width: chartWidth,
            flexShrink: 0,
          }}
        >
          {chart.map((row, i) => (
            <text key={i} fg={theme.accent}>
              {row}
            </text>
          ))}
        </box>
        <text> </text>
        <text fg={theme.muted}>{countLabel(group.count, "event")}</text>
        <Divider />
        <text fg={theme.muted}>{countLabel(group.userCount, "user")}</text>
        <Divider />
        <text fg={theme.muted}>{`first seen ${timeAgo(group.firstSeen)} ago`}</text>
        <Divider />
        <text fg={theme.muted}>{`last seen ${timeAgo(group.lastSeen)} ago`}</text>
      </box>

      {/* Actions: what you can *do*. Always pressable. */}
      {/* No padding above: a chip's top sliver row is the gap. */}
      <box style={{ flexDirection: "row", width }}>
        <text>{BODY_INDENT}</text>
        <ChipRow
          chips={actions}
          activeIndex={actionsOpen ? actions.length - 1 : undefined}
          onPress={onActionPress}
        />
      </box>

      <text fg={theme.border}>{"─".repeat(width)}</text>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** How many rows a section is hiding when folded, where that number is cheap. */
function sectionCount(key: SectionKey, event: SentryEvent): number | undefined {
  switch (key) {
    case "breadcrumbs":
      return findEntry(event.entries, "breadcrumbs")?.data.values?.length;
    case "tags":
      return event.tags?.length;
    case "contexts":
      return Object.keys(event.contexts ?? {}).length;
    default:
      return undefined;
  }
}

function SectionBody({
  sectionKey,
  event,
  width,
  expandedFrames,
  selectedFrame,
  selectedFrameId,
  onFrameClick,
}: {
  sectionKey: SectionKey;
  event: SentryEvent;
  width: number;
  expandedFrames: ReadonlySet<string>;
  selectedFrame?: string;
  selectedFrameId: string;
  onFrameClick: (key: string) => void;
}) {
  const theme = useTheme();
  switch (sectionKey) {
    case "exception": {
      const exception = findEntry(event.entries, "exception");
      const values = exception?.data.values ?? [];
      if (values.length === 0) {
        return <Empty>No exception on this event.</Empty>;
      }
      return (
        <box style={{ flexDirection: "column", paddingLeft: BODY_INDENT.length }}>
          {values.map((value, i) => (
            <ExceptionSection
              key={i}
              value={value}
              traceId={event.id}
              exceptionIndex={i}
              width={width - BODY_INDENT.length}
              expandedFrames={expandedFrames}
              selectedFrame={selectedFrame}
              selectedFrameId={selectedFrameId}
              onFrameClick={onFrameClick}
              includeSystemFrames={false}
            />
          ))}
        </box>
      );
    }

    case "breadcrumbs": {
      const crumbs = findEntry(event.entries, "breadcrumbs")?.data.values ?? [];
      if (crumbs.length === 0) return <Empty>No breadcrumbs.</Empty>;
      // Most recent last, as they led to the error.
      return (
        <box style={{ flexDirection: "column", width }}>
          {crumbs.map((crumb, i) => (
            <Crumb key={i} crumb={crumb} width={width} />
          ))}
        </box>
      );
    }

    case "request": {
      const request = findEntry(event.entries, "request")?.data;
      if (!request?.url) return <Empty>No request data.</Empty>;
      return (
        <box style={{ flexDirection: "column", width }}>
          <text fg={theme.text}>
            {fitText(`${BODY_INDENT}${request.method ?? "GET"} ${request.url}`, width)}
          </text>
          {(request.headers ?? []).map(([name, value]) => (
            <Field key={name} name={name} value={value} width={width} />
          ))}
        </box>
      );
    }

    case "tags": {
      const tags = event.tags ?? [];
      if (tags.length === 0) return <Empty>No tags.</Empty>;
      return (
        <box style={{ flexDirection: "column", width }}>
          {tags.map((tag) => (
            <Field key={tag.key} name={tag.key} value={tag.value} width={width} />
          ))}
        </box>
      );
    }

    case "contexts": {
      const contexts = Object.entries(event.contexts ?? {});
      if (contexts.length === 0) return <Empty>No contexts.</Empty>;
      return (
        <box style={{ flexDirection: "column", width }}>
          {contexts.map(([name, values]) => (
            <Field key={name} name={name} value={summarize(values)} width={width} />
          ))}
        </box>
      );
    }

    case "sdk":
      // Not a key/value pair: the SDK name *is* the value, and package names
      // run well past the key column.
      if (!event.sdk) return <Empty>Unknown SDK.</Empty>;
      return (
        <box style={{ flexDirection: "row", width }}>
          <text fg={theme.text}>{`${BODY_INDENT}${event.sdk.name}`}</text>
          <text fg={theme.muted}>{` ${event.sdk.version}`}</text>
        </box>
      );
  }
}

/**
 * One breadcrumb: time, category, message.
 *
 * The category column is wide enough to tell two crumbs apart — at the old
 * twelve cells every entry from a Python logger truncated to the same prefix.
 */
function Crumb({ crumb, width }: { crumb: Breadcrumb; width: number }) {
  const theme = useTheme();
  const time = crumb.timestamp ? crumb.timestamp.slice(11, 19) : "--:--:--";
  const category = crumb.category ?? crumb.type;
  const message = crumb.message ?? summarize(crumb.data ?? {});
  const used = BODY_INDENT.length + time.length + 2 + KEY_COLUMN;

  return (
    <box style={{ flexDirection: "row", width }}>
      <text fg={theme.subText}>{`${BODY_INDENT}${time}  `}</text>
      <text fg={theme.muted}>{keyCell(category)}</text>
      <text fg={theme.text}>{fitText(message, Math.max(0, width - used))}</text>
    </box>
  );
}

function summarize(values: Record<string, unknown>): string {
  return Object.entries(values)
    .filter(([key]) => key !== "type")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
