import type { SentryClient } from "~/api/client";
import { DEFAULT_STATS_PERIOD } from "~/api/issues";
import { errorOf, isInitialLoad, valueOf } from "~/core/async";
import { IssueListHeader, IssueRow, IssueRowSkeleton } from "~/ui/components/IssueRow";
import { useIssues } from "~/ui/hooks/useIssues";
import { BOLD } from "~/ui/lib/attributes";
import { useTheme } from "~/ui/theme";

const MAX_EMBEDDED_ISSUES = 25;

/**
 * Render issue references with the same rich rows as the issue stream.
 *
 * Seer's web embed queries by short id (`issue:PROJECT-123`) rather than the
 * numeric group id, so this path deliberately goes through the list endpoint
 * too. That also lets the standard two-phase stats fetch fill in trends,
 * counts, and seen times without duplicating issue-stream behavior.
 */
export function SeerIssueEmbed({
  client,
  org,
  ids,
  width,
}: {
  client: SentryClient | null;
  org: string;
  ids: string[];
  width: number;
}) {
  const theme = useTheme();
  const issueIds = [...new Set(ids.filter(Boolean))].slice(0, MAX_EMBEDDED_ISSUES);
  const query = issueIds.length === 1 ? `issue:${issueIds[0]}` : `issue:[${issueIds.join(",")}]`;
  const state = useIssues(issueIds.length > 0 ? client : null, {
    org,
    query,
    sort: "date",
    statsPeriod: DEFAULT_STATS_PERIOD,
    limit: Math.max(1, issueIds.length),
  });
  const groups = valueOf(state.issues) ?? [];
  const error = errorOf(state.issues);
  const listWidth = Math.max(24, width - 2);
  const multiple = issueIds.length > 1;

  if (issueIds.length === 0) {
    return <text fg={theme.muted}>No issues referenced.</text>;
  }

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        border: true,
        borderColor: error ? theme.danger : theme.border,
        flexShrink: 0,
      }}
    >
      {multiple ? <IssueListHeader width={listWidth} /> : null}
      {state.issues.state === "idle" || isInitialLoad(state.issues) ? (
        <IssueRowSkeleton width={listWidth} seed={0} />
      ) : null}
      {error && groups.length === 0 ? (
        <box style={{ flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
          <text fg={theme.danger} attributes={BOLD}>
            Could not load {multiple ? "issues" : issueIds[0]}
          </text>
          <text fg={theme.muted}>{error.message}</text>
        </box>
      ) : null}
      {!error && state.issues.state === "ready" && groups.length === 0 ? (
        <text
          fg={theme.muted}
        >{` No matching ${multiple ? "issues" : `issue ${issueIds[0]}`} found.`}</text>
      ) : null}
      {groups.map((group) => (
        <IssueRow key={group.id} group={group} selected={false} width={listWidth} />
      ))}
      {ids.length > MAX_EMBEDDED_ISSUES ? (
        <text fg={theme.muted}>{` Showing the first ${MAX_EMBEDDED_ISSUES} issues.`}</text>
      ) : null}
    </box>
  );
}
