import { useEffect, useMemo, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  DEFAULT_QUERY,
  DEFAULT_SORT,
  DEFAULT_STATS_PERIOD,
  PAGE_SIZE,
  SORT_OPTIONS,
  type SortOption,
} from "~/api/issues";
import type { Group } from "~/api/types";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";
import { IssueRow } from "~/ui/components/IssueRow";
import { IssueListEmpty, IssueListError, IssueListSkeleton } from "~/ui/components/IssueListStates";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useIssues } from "~/ui/hooks/useIssues";

export interface IssueStreamProps {
  client: SentryClient | null;
  org: string;
  width: number;
  height: number;
  focused: boolean;
  selectedIndex: number;
  onIssuesChange?: (issues: Group[]) => void;
  onStatusChange?: (status: {
    loading: boolean;
    elapsedMs?: number;
    error?: string;
    count?: number;
  }) => void;
  /**
   * Rows to render instead of the fetched ones. The App owns the list once
   * loaded so optimistic triage updates can rewrite it; also lets tests render
   * a fixed state without a client.
   */
  issuesOverride?: Group[];
  /** Issue ids with a mutation in flight. */
  pendingIds?: ReadonlySet<string>;
}

export function IssueStream({
  client,
  org,
  width,
  height,
  focused,
  selectedIndex,
  onIssuesChange,
  onStatusChange,
  issuesOverride,
  pendingIds,
}: IssueStreamProps) {
  const [query] = useState(DEFAULT_QUERY);
  const [sort] = useState<SortOption>(DEFAULT_SORT);

  const { issues, statsLoading } = useIssues(client, {
    org,
    query,
    sort,
    statsPeriod: DEFAULT_STATS_PERIOD,
  });

  const loading = issues.state === "loading";
  const since = issues.state === "loading" ? issues.since : undefined;
  const elapsed = useElapsed(loading, since);

  const fetched = valueOf(issues);
  const rows = issuesOverride ?? fetched;
  const error = errorOf(issues);
  // Stale rows stay on screen during a refresh, dimmed rather than replaced.
  const stale = rows !== undefined && (loading || error !== undefined);

  // Report what was *fetched*, never the override. Echoing the override back
  // would close a loop — the parent's copy would overwrite each phase-two
  // merge, so counts and sparklines would never arrive.
  useEffect(() => {
    if (fetched) onIssuesChange?.(fetched);
  }, [fetched, onIssuesChange]);

  useEffect(() => {
    onStatusChange?.({
      loading: loading || statsLoading,
      elapsedMs: elapsed ?? elapsedMs(issues, Date.now()),
      error: error?.message,
      count: rows?.length,
    });
  }, [loading, statsLoading, elapsed, error, rows, issues, onStatusChange]);

  const sortLabel = useMemo(
    () => SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort,
    [sort],
  );

  const listWidth = Math.max(20, width - 2);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/* Search query, mirroring the web app's search bar. */}
      <box style={{ flexDirection: "row", width, flexShrink: 0 }}>
        <text fg={theme.muted}>{"/ "}</text>
        <text fg={theme.text}>{fitText(query, listWidth - 2)}</text>
      </box>

      {/* Filter row: project / environment / period, then sort. */}
      <box style={{ flexDirection: "row", width, flexShrink: 0 }}>
        <text fg={theme.muted}>{`[all projects] [all envs] [${DEFAULT_STATS_PERIOD}]`}</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted}>{`Sort: ${sortLabel}`}</text>
      </box>

      <text fg={theme.border}>{"─".repeat(listWidth)}</text>

      <scrollbox focused={focused} style={{ flexGrow: 1, width }}>
        {rows === undefined && isInitialLoad(issues) ? (
          <IssueListSkeleton width={listWidth} rows={PAGE_SIZE} />
        ) : null}

        {rows !== undefined && rows.length === 0 && !loading ? (
          <IssueListEmpty query={query} />
        ) : null}

        {rows?.map((group, index) => (
          <IssueRow
            key={group.id}
            group={group}
            selected={focused && index === selectedIndex}
            width={listWidth}
            pending={pendingIds?.has(group.id) ?? false}
          />
        ))}

        {error && rows === undefined ? <IssueListError error={error} /> : null}
      </scrollbox>

      {stale ? (
        <text fg={theme.muted}>{error ? `⚠ ${fitText(error.message, listWidth - 2)}` : ""}</text>
      ) : null}
    </box>
  );
}
