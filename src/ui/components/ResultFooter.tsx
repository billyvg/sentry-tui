import { formatCount } from "~/lib/sparkline";
import { useTheme } from "~/ui/theme";

export interface ResultFooterProps {
  /** Rows returned for the current page; absent while the first page loads. */
  count: number | undefined;
  /** Singular row name, e.g. `issue` or `dashboard`. */
  noun: string;
  /** The API's Link header says another page has results. */
  hasMore?: boolean;
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
 * its first page lands. Its open right side is where pagination controls can
 * live once the screens can request their next and previous cursors.
 */
export function ResultFooter({ count, noun, hasMore = false }: ResultFooterProps) {
  const theme = useTheme();
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
    </box>
  );
}
