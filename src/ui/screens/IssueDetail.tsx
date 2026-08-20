import { useState } from "react";

import type { SentryClient } from "~/api/client";
import { findEntry, type Breadcrumb, type Group, type SentryEvent } from "~/api/types";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { formatCount, sparkline, timeAgo } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { ExceptionSection } from "~/ui/components/StackTrace";
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

  const inner = Math.max(20, width - 2);

  return (
    <scrollbox focused={focused} style={{ width, height, flexDirection: "column" }}>
      <IssueHeader group={group} width={inner} />

      {loading ? <text fg={theme.muted}>Loading event…</text> : null}

      {error ? (
        <box style={{ flexDirection: "column", paddingTop: 1 }}>
          <text fg={theme.danger}>Failed to load event</text>
          <text fg={theme.muted}>{fitText(error.message, inner)}</text>
        </box>
      ) : null}

      {event
        ? SECTION_ORDER.map((key) => (
            <Section
              key={key}
              title={SECTION_TITLES[key]}
              collapsed={collapsed.has(key)}
              width={inner}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
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

function IssueHeader({ group, width }: { group: Group; width: number }) {
  return (
    <box style={{ flexDirection: "column", width }}>
      <text fg={theme.muted}>{`Issues / ${group.shortId}`}</text>

      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.level[group.level] ?? theme.level.unknown}>│</text>
        <text fg={theme.text} attributes={1 /* BOLD */}>
          {fitText(group.title, width - 24)}
        </text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted}>{`${padText(formatCount(group.count), 7, "right")} events`}</text>
      </box>

      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.muted}>{fitText(group.culprit, width - 24)}</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted}>{`${padText(formatCount(group.userCount), 7, "right")} users`}</text>
      </box>

      {/* Action bar, mirroring GroupActions. */}
      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.muted}>
          {group.status === "resolved" ? "[u] Unresolve" : "[r] Resolve"}
        </text>
        <text fg={theme.muted}>
          {group.status === "ignored" ? "  [a] Unarchive" : "  [a] Archive"}
        </text>
        <text fg={theme.muted}>{`  [p] ${group.priority ?? "—"}`}</text>
        <text fg={theme.muted}>{`  [A] ${group.assignedTo?.name ?? "unassigned"}`}</text>
      </box>

      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.muted}>{sparkline(group.stats?.["24h"], 24)}</text>
        <text fg={theme.muted}>
          {`  first ${timeAgo(group.firstSeen)} ago · last ${timeAgo(group.lastSeen)} ago`}
        </text>
      </box>

      <text fg={theme.border}>{"─".repeat(width)}</text>
    </box>
  );
}

function Section({
  title,
  collapsed,
  width,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  width: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <box style={{ flexDirection: "column", width, paddingTop: 1 }}>
      <text fg={theme.accent} attributes={1} onMouseDown={onToggle}>
        {`${collapsed ? "▸" : "▾"} ${title}`}
      </text>
      {collapsed ? null : children}
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
        return <text fg={theme.muted}>No exception on this event.</text>;
      }
      return (
        <box style={{ flexDirection: "column", width }}>
          {values.map((value, i) => (
            <ExceptionSection
              key={i}
              value={value}
              width={width}
              expandedFrames={expandedFrames}
              includeSystemFrames={false}
            />
          ))}
        </box>
      );
    }

    case "breadcrumbs": {
      const crumbs = findEntry(event.entries, "breadcrumbs")?.data.values ?? [];
      if (crumbs.length === 0) {
        return <text fg={theme.muted}>No breadcrumbs.</text>;
      }
      // Most recent last, as they led to the error.
      return (
        <box style={{ flexDirection: "column", width }}>
          {crumbs.map((crumb, i) => (
            <text key={i} fg={theme.muted}>
              {fitText(formatCrumb(crumb), width)}
            </text>
          ))}
        </box>
      );
    }

    case "request": {
      const request = findEntry(event.entries, "request")?.data;
      if (!request?.url) return <text fg={theme.muted}>No request data.</text>;
      return (
        <box style={{ flexDirection: "column", width }}>
          <text fg={theme.text}>{fitText(`${request.method ?? "GET"} ${request.url}`, width)}</text>
          {(request.headers ?? []).map(([name, value]) => (
            <text key={name} fg={theme.muted}>
              {fitText(`  ${name}: ${value}`, width)}
            </text>
          ))}
        </box>
      );
    }

    case "tags":
      return (
        <box style={{ flexDirection: "column", width }}>
          {(event.tags ?? []).map((tag) => (
            <text key={tag.key} fg={theme.muted}>
              {fitText(`  ${padText(tag.key, 18)} ${tag.value}`, width)}
            </text>
          ))}
        </box>
      );

    case "contexts":
      return (
        <box style={{ flexDirection: "column", width }}>
          {Object.entries(event.contexts ?? {}).map(([name, values]) => (
            <text key={name} fg={theme.muted}>
              {fitText(`  ${padText(name, 18)} ${summarize(values)}`, width)}
            </text>
          ))}
        </box>
      );

    case "sdk":
      return (
        <text fg={theme.muted}>
          {event.sdk ? `  ${event.sdk.name} ${event.sdk.version}` : "  unknown"}
        </text>
      );
  }
}

function formatCrumb(crumb: Breadcrumb): string {
  const time = crumb.timestamp ? crumb.timestamp.slice(11, 19) : "--:--:--";
  const label = crumb.message ?? summarize(crumb.data ?? {});
  return `  ${time}  ${padText(crumb.category ?? crumb.type, 12)} ${label}`;
}

function summarize(values: Record<string, unknown>): string {
  return Object.entries(values)
    .filter(([key]) => key !== "type")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
