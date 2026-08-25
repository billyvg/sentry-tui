import { formatCount } from "~/lib/sparkline";
import { KeyHint } from "~/ui/components/KeyHint";
import { useTheme } from "~/ui/theme";

export interface ResultPagination {
  /** One-based page number currently on screen. */
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Prevent a second request while either direction is already loading. */
  loading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export interface ResultFooterProps {
  /** Rows returned for the current page; absent while the first page loads. */
  count: number | undefined;
  /** Singular row name, e.g. `issue` or `dashboard`. */
  noun: string;
  /** The API's Link header says another page has results. */
  hasMore?: boolean;
  /** Cursor controls, when this result surface implements paging. */
  pagination?: ResultPagination;
}

/** A page count that keeps the API's more-results signal: `25+ issues`. */
export function resultCountLabel(count: number, noun: string, hasMore = false): string {
  const suffix = hasMore ? "+" : "";
  const label = count === 1 && !hasMore ? noun : `${noun}s`;
  return `${formatCount(count)}${suffix} ${label}`;
}

/**
 * Footer below a result surface.
 *
 * The row is reserved while loading so the table does not lose a line when
 * its first page lands. Cursor-backed screens put their page controls on the
 * right; other result surfaces keep that space open.
 */
export function ResultFooter({ count, noun, hasMore = false, pagination }: ResultFooterProps) {
  const theme = useTheme();
  const canPrevious = pagination?.hasPrevious && !pagination.loading;
  const canNext = pagination?.hasNext && !pagination.loading;
  return (
    <box
      style={{
        flexDirection: "row",
        flexShrink: 0,
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={theme.subText}>
        {count === undefined ? "" : resultCountLabel(count, noun, hasMore)}
      </text>
      <box style={{ flexGrow: 1 }} />
      {pagination ? (
        <box style={{ flexDirection: "row", flexShrink: 0 }}>
          {pagination.hasPrevious ? (
            <box
              style={{ flexDirection: "row" }}
              onMouseDown={canPrevious ? pagination.onPrevious : undefined}
            >
              <KeyHint command="sentry.nav.pageUp" />
              <text fg={canPrevious ? theme.muted : theme.subText}>{" ‹  "}</text>
            </box>
          ) : null}
          <text fg={theme.subText}>{pagination.page}</text>
          {pagination.hasNext ? (
            <box
              style={{ flexDirection: "row" }}
              onMouseDown={canNext ? pagination.onNext : undefined}
            >
              <text fg={canNext ? theme.muted : theme.subText}>{"  › "}</text>
              <KeyHint command="sentry.nav.pageDown" />
            </box>
          ) : null}
        </box>
      ) : null}
    </box>
  );
}
