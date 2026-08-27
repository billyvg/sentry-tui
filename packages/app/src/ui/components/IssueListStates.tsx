import type { AsyncError } from "~/core/async";
import { formatKey, primaryKey } from "~/core/commands";
import { useTheme } from "~/ui/theme";
import { IssueRowSkeleton, ROW_HEIGHT } from "~/ui/components/IssueRow";

/** Skeleton rows sized to the page, so the list has its final height at once. */
export function IssueListSkeleton({ width, rows }: { width: number; rows: number }) {
  return (
    <box style={{ flexDirection: "column", width }}>
      {Array.from({ length: rows }, (_, i) => (
        <IssueRowSkeleton key={i} width={width} seed={i} />
      ))}
    </box>
  );
}

/**
 * Rendered only in the `ready` state — showing this during a load is the
 * classic flash-of-empty-state bug.
 */
export function IssueListEmpty({ query }: { query: string }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text fg={theme.text}>No issues match this search.</text>
      <text fg={theme.muted}>{query}</text>
      <text fg={theme.muted}>
        {`${formatKey(primaryKey("sentry.nav.search"))} to edit the query`}
      </text>
    </box>
  );
}

/** An error renders in place with a bound retry, rather than crashing the screen. */
export function IssueListError({ error }: { error: AsyncError }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text fg={theme.danger}>Failed to load issues</text>
      <text fg={theme.muted}>{error.message}</text>
      {error.retryable ? (
        <text fg={theme.muted}>{`${formatKey(primaryKey("sentry.app.refresh"))} to retry`}</text>
      ) : null}
    </box>
  );
}

export { ROW_HEIGHT };
