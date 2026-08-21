import { useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  findEntry,
  GroupStatus,
  GroupSubstatus,
  type Breadcrumb,
  type Group,
  type SentryEvent,
} from "~/api/types";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { issueMessage, issueTitle } from "~/lib/issueText";
import { countLabel, sparklineBlock, timeAgo } from "~/lib/sparkline";
import { fitText, measureTextWidth } from "~/lib/text";
import { ChipRow, type ChipSpec } from "~/ui/components/Chip";
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
import { ExceptionSection } from "~/ui/components/StackTrace";
import { BOLD } from "~/ui/lib/attributes";
import { useIssueEvent } from "~/ui/hooks/useIssueEvent";

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

export function IssueDetail({
  client,
  org,
  group,
  width,
  height,
  focused,
  reloadToken,
}: {
  client: SentryClient | null;
  org: string;
  group: Group;
  width: number;
  height: number;
  focused: boolean;
  /** Bump to refetch the issue's event — the app's global refresh. */
  reloadToken?: number;
}) {
  const status = useIssueEvent(client, { org, issueId: group.id, reloadToken });
  const event = valueOf(status);
  const error = errorOf(status);
  const loading = isInitialLoad(status);

  const { collapsed, toggle } = useSectionFolds(SECTION_ORDER, focused);
  const [expandedFrames] = useState<ReadonlySet<number>>(
    // The crashing frame is the one you want to see first.
    () => new Set([0, 1]),
  );

  const inner = Math.max(20, width - 2);

  return (
    /*
     * No `flexDirection` here: a scrollbox lays its own root out as a row —
     * viewport first, vertical scrollbar beside it — and forwards padding to
     * the content box, which stacks its children in a column already. Setting
     * `column` on the root instead stacks the scrollbar *under* the viewport,
     * which halves the visible height and leaves the bar floating in the dead
     * space below the content.
     */
    <scrollbox
      focused={focused}
      // Matches the stream screens: a continuously drawn track reads as a
      // scroll rail rather than as a stray mark at the edge of the pane.
      verticalScrollbarOptions={{
        showArrows: false,
        trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
      }}
      style={{ width, height, paddingLeft: 1 }}
    >
      <IssueHeader group={group} width={inner} />

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
              />
            </Section>
          ))
        : null}
    </scrollbox>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/** Status label and color, collapsing status + substatus the way the web badge does. */
function statusBadge(group: Group): { label: string; color: string } {
  if (group.status === GroupStatus.RESOLVED) {
    return { label: "resolved", color: theme.status.resolved };
  }
  if (group.status === GroupStatus.IGNORED) {
    return { label: "archived", color: theme.status.archived };
  }
  switch (group.substatus) {
    case GroupSubstatus.NEW:
      return { label: "new", color: theme.status.new };
    case GroupSubstatus.REGRESSED:
      return { label: "regressed", color: theme.status.regressed };
    case GroupSubstatus.ESCALATING:
      return { label: "escalating", color: theme.status.escalating };
    default:
      return { label: "unresolved", color: theme.status.ongoing };
  }
}

/**
 * The action chips, derived from the state they'd change.
 *
 * Only bound, implemented actions get a chip: a control that looks pressable
 * and does nothing is worse than no control.
 */
function headerActions(group: Group): ChipSpec[] {
  const chips: ChipSpec[] = [
    group.status === GroupStatus.RESOLVED
      ? { command: "sentry.issue.unresolve", label: "unresolve" }
      : { command: "sentry.issue.resolve", label: "resolve" },
    group.status === GroupStatus.IGNORED
      ? { command: "sentry.issue.archive", label: "unarchive" }
      : { command: "sentry.issue.archive", label: "archive" },
    {
      command: "sentry.issue.bookmark",
      label: group.isBookmarked ? "unbookmark" : "bookmark",
    },
  ];
  if (!group.hasSeen) {
    chips.push({ command: "sentry.issue.markReviewed", label: "review" });
  }
  return chips;
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

function IssueHeader({ group, width }: { group: Group; width: number }) {
  const level = theme.level[group.level] ?? theme.level.unknown;
  const badge = statusBadge(group);
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

      {/*
       * State: what the issue currently *is*. Never pressable. The level is
       * absent because the bar beside the title already carries it in color.
       */}
      <box style={{ flexDirection: "row", width, paddingTop: 1 }}>
        <text>{BODY_INDENT}</text>
        <text fg={badge.color}>{badge.label}</text>
        <Divider />
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
        <ChipRow chips={headerActions(group)} />
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
}: {
  sectionKey: SectionKey;
  event: SentryEvent;
  width: number;
  expandedFrames: ReadonlySet<number>;
}) {
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
              width={width - BODY_INDENT.length}
              expandedFrames={expandedFrames}
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
