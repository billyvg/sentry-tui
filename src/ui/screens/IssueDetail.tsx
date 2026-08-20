import { useCallback, useState } from "react";
import { useKeyboard } from "@opentui/react";

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
import { matchesCommand } from "~/core/commands";
import { theme } from "~/core/theme";
import { issueMessage, issueTitle } from "~/lib/issueText";
import { countLabel, sparkline, timeAgo } from "~/lib/sparkline";
import { fitText, measureTextWidth, padText } from "~/lib/text";
import { ChipRow, type ChipSpec } from "~/ui/components/Chip";
import { Placeholder } from "~/ui/components/Placeholder";
import { ExceptionSection } from "~/ui/components/StackTrace";
import { BOLD } from "~/ui/lib/attributes";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";
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

/**
 * Every section body starts here, empty states included.
 *
 * The old screen indented some bodies and not others, which left the fold
 * markers as the only thing holding the page together — and they sit in the
 * same column as half the content.
 */
const BODY_INDENT = "  ";
/** Key column in the two-column bodies (tags, contexts, breadcrumb categories). */
const KEY_COLUMN = 18;
/** One glyph per hour of the 24h window, when the series is that long. */
const HEADER_SPARKLINE_WIDTH = 24;

export function IssueDetail({
  client,
  org,
  group,
  width,
  height,
  focused,
}: {
  client: SentryClient | null;
  org: string;
  group: Group;
  width: number;
  height: number;
  focused: boolean;
}) {
  const status = useIssueEvent(client, { org, issueId: group.id });
  const event = valueOf(status);
  const error = errorOf(status);
  const loading = isInitialLoad(status);

  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(() => new Set());
  const [expandedFrames] = useState<ReadonlySet<number>>(
    // The crashing frame is the one you want to see first.
    () => new Set([0, 1]),
  );

  const toggle = useCallback((key: SectionKey) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Folds everything unless everything is already folded. Keying off "any
  // section is open" instead would make the same keystroke expand or collapse
  // depending on state the user can't see all of at once.
  const toggleAll = useCallback(() => {
    setCollapsed((current) =>
      current.size === SECTION_ORDER.length ? new Set() : new Set(SECTION_ORDER),
    );
  }, []);

  useKeyboard((key) => {
    // The scrollbox owns j/k and the page keys here, so folding is bound to the
    // digits printed in each section header instead of a cursor of its own.
    if (!focused) return;
    routeKeyOwnership(
      [
        () => {
          if (matchesCommand("sentry.view.toggleAllSections", key)) {
            toggleAll();
            return "mine";
          }
          if (matchesCommand("sentry.view.toggleSection", key)) {
            const target = SECTION_ORDER[Number(key.name) - 1];
            if (!target) return "notMine";
            toggle(target);
            return "mine";
          }
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  const inner = Math.max(20, width - 2);

  return (
    <scrollbox focused={focused} style={{ width, height, flexDirection: "column", paddingLeft: 1 }}>
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
 * The header's own sparkline, sized to the data rather than to a column.
 *
 * `sparkline` left-pads a short series so a stream column stays right-aligned;
 * here there is no column to align to, and that padding just opens a gap
 * between the "24h" label and its chart.
 */
function headerSparkline(group: Group): string {
  const series = group.stats?.["24h"];
  const width = series?.length ? Math.min(HEADER_SPARKLINE_WIDTH, series.length) : 0;
  return sparkline(series, width || HEADER_SPARKLINE_WIDTH, { floor: true });
}

function IssueHeader({ group, width }: { group: Group; width: number }) {
  const level = theme.level[group.level] ?? theme.level.unknown;
  const badge = statusBadge(group);

  // Both metrics share a right edge, so the pair reads as one column rather
  // than two strings that happen to end near each other.
  const events = countLabel(group.count, "event");
  const users = countLabel(group.userCount, "user");
  const metricWidth = Math.max(measureTextWidth(events), measureTextWidth(users));
  // "┃ " on the left, a two-space gutter before the metric column.
  const titleWidth = Math.max(12, width - 2 - metricWidth - 2);

  return (
    <box style={{ flexDirection: "column", width }}>
      <text fg={theme.muted}>{`Issues / ${group.shortId}`}</text>

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
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted}>{padText(events, metricWidth, "right")}</text>
      </box>

      <box style={{ flexDirection: "row", width }}>
        <text fg={level}>{"┃ "}</text>
        <Placeholder
          text={issueMessage(group)}
          fallback="(no error message)"
          width={titleWidth}
          fg={theme.muted}
        />
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted}>{padText(users, metricWidth, "right")}</text>
      </box>

      {/* State: what the issue currently *is*. Never pressable. */}
      <box style={{ flexDirection: "row", width, paddingTop: 1 }}>
        <text>{BODY_INDENT}</text>
        <text fg={badge.color}>{badge.label}</text>
        <Divider />
        <text fg={level}>{group.level}</text>
        <Divider />
        <text fg={theme.muted}>{group.project.slug}</text>
        <Divider />
        <text fg={theme.muted}>
          {group.priority ? `${group.priority} priority` : "no priority"}
        </text>
        <Divider />
        <text fg={theme.muted}>{group.assignedTo?.name ?? "unassigned"}</text>
      </box>

      <box style={{ flexDirection: "row", width }}>
        <text>{BODY_INDENT}</text>
        <text fg={theme.muted}>{"24h "}</text>
        <text fg={theme.accent}>{headerSparkline(group)}</text>
        <Divider />
        <text fg={theme.muted}>{`first seen ${timeAgo(group.firstSeen)} ago`}</text>
        <Divider />
        <text fg={theme.muted}>{`last seen ${timeAgo(group.lastSeen)} ago`}</text>
      </box>

      {/* Actions: what you can *do*. Always pressable. */}
      <box style={{ flexDirection: "row", width }}>
        <text>{BODY_INDENT}</text>
        <ChipRow chips={headerActions(group)} />
      </box>

      <text fg={theme.border}>{"─".repeat(width)}</text>
    </box>
  );
}

/** The ` · ` that separates metadata items, dimmer than what it separates. */
function Divider() {
  return <text fg={theme.subText}>{" · "}</text>;
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

function Section({
  index,
  title,
  count,
  collapsed,
  width,
  onToggle,
  children,
}: {
  /** The digit that folds this section, printed so the binding is discoverable. */
  index: number;
  title: string;
  count?: number;
  collapsed: boolean;
  width: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const label = count === undefined ? title : `${title} (${count})`;
  const prefix = `${collapsed ? "▸" : "▾"} ${index} `;
  // The rule runs the header out to the full width, which is what separates one
  // section from the next now that the bodies share an indent.
  const rule = Math.max(0, width - measureTextWidth(prefix) - measureTextWidth(label) - 1);

  return (
    <box style={{ flexDirection: "column", width, paddingTop: 1 }}>
      <box style={{ flexDirection: "row", width }} onMouseDown={onToggle}>
        <text fg={theme.accent}>{prefix}</text>
        <text fg={theme.text} attributes={BOLD}>
          {label}
        </text>
        <text fg={theme.border}>{` ${"─".repeat(rule)}`}</text>
      </box>
      {collapsed ? null : children}
    </box>
  );
}

/** An indented "there is nothing here" line, in the one place that decides how. */
function Empty({ children }: { children: string }) {
  return <text fg={theme.subText}>{`${BODY_INDENT}${children}`}</text>;
}

/**
 * A key padded into its column, always leaving a gutter before the value.
 *
 * Padding a key that already fills the column produces `Sec-WebSocket-Ver…13`,
 * where the ellipsis and the value collide and the row stops parsing as two
 * fields — so the key is fitted one cell short of the column it pads into.
 */
function keyCell(name: string): string {
  return padText(fitText(name, KEY_COLUMN - 1), KEY_COLUMN);
}

/**
 * An indented `key   value` row.
 *
 * Splitting the color is what makes a block of sixteen tags scannable: the eye
 * follows the bright column and treats the dim one as a ruler.
 */
function Field({ name, value, width }: { name: string; value: string; width: number }) {
  return (
    <box style={{ flexDirection: "row", width }}>
      <text fg={theme.muted}>{`${BODY_INDENT}${keyCell(name)}`}</text>
      <text fg={theme.text}>
        {fitText(value, Math.max(0, width - KEY_COLUMN - BODY_INDENT.length))}
      </text>
    </box>
  );
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
