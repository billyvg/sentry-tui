import type { Group, PriorityLevel } from "~/api/types";
import { theme } from "~/core/theme";
import { formatCount, sparkline, timeAgo } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";

/**
 * Column widths, in cells. Proportional to the web app's
 * (`components/stream/group.tsx`: lastSeen 86px, chart 175px, counts 60px).
 * Skeleton and real rows share these so the layout cannot shift when data
 * lands.
 */
export const COLUMNS = {
  marker: 2,
  sparkline: 10,
  events: 6,
  users: 5,
  age: 5,
  priority: 4,
} as const;

const FIXED_WIDTH =
  COLUMNS.marker +
  COLUMNS.sparkline +
  COLUMNS.events +
  COLUMNS.users +
  COLUMNS.age +
  COLUMNS.priority +
  6; // inter-column spaces

/** Sentry renders priority as a 3-bar signal icon; these are its glyphs. */
const PRIORITY_GLYPH: Record<PriorityLevel, string> = {
  high: "▁▄█",
  medium: "▁▄ ",
  low: "▁  ",
};

export const ROW_HEIGHT = 2;

export function IssueRow({
  group,
  selected,
  width,
}: {
  group: Group;
  selected: boolean;
  width: number;
}) {
  const titleWidth = Math.max(10, width - FIXED_WIDTH);
  const bg = selected ? theme.selected : undefined;

  return (
    <box style={{ flexDirection: "column", width, backgroundColor: bg }}>
      <box style={{ flexDirection: "row", width }}>
        <text fg={selected ? theme.accent : theme.muted}>{selected ? "▸" : " "}</text>
        {/* Unread dot, as the web app shows for !hasSeen. */}
        <text fg={theme.accent}>{group.hasSeen ? " " : "●"}</text>
        {/* Level bar — the terminal analogue of errorLevel.tsx's 3px rule. */}
        <text fg={theme.level[group.level] ?? theme.level.unknown}>│</text>
        <text fg={theme.text} attributes={group.hasSeen ? 0 : 1 /* BOLD when unread */}>
          {padText(group.title, titleWidth)}
        </text>
        <text fg={theme.muted}>{sparkline(group.stats?.["24h"], COLUMNS.sparkline)}</text>
        <text fg={theme.text}>{padText(formatCount(group.count), COLUMNS.events, "right")}</text>
        <text fg={theme.text}>{padText(formatCount(group.userCount), COLUMNS.users, "right")}</text>
        <text fg={theme.muted}>
          {padText(group.priority ? PRIORITY_GLYPH[group.priority] : "", COLUMNS.priority, "right")}
        </text>
      </box>

      <box style={{ flexDirection: "row", width, paddingLeft: 3 }}>
        <text fg={theme.muted}>{metaLine(group, width - 4)}</text>
      </box>
    </box>
  );
}

/** The dense divider-separated meta row from `groupMetaRow.tsx`. */
function metaLine(group: Group, width: number): string {
  const parts = [
    group.shortId,
    group.isUnhandled ? "Unhandled" : null,
    group.culprit,
    group.numComments > 0 ? `💬 ${group.numComments}` : null,
    group.logger,
    `${timeAgo(group.lastSeen)} old`,
  ].filter((part): part is string => Boolean(part));

  return fitText(parts.join(" │ "), width);
}

/**
 * A row-shaped placeholder at the exact geometry of a real row, so content
 * never jumps when the data lands.
 */
export function IssueRowSkeleton({ width, seed }: { width: number; seed: number }) {
  const titleWidth = Math.max(10, width - FIXED_WIDTH);
  // Vary the bar widths so the list reads as pending content, not a progress
  // bar. Deterministic in the index so frames are stable across renders.
  const titleBar = Math.floor(titleWidth * (0.45 + ((seed * 17) % 40) / 100));
  const metaBar = Math.floor((width - 4) * (0.3 + ((seed * 29) % 25) / 100));

  return (
    <box style={{ flexDirection: "column", width }}>
      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.panelAlt}>{"  "}</text>
        <text fg={theme.border}>│</text>
        <text fg={theme.panelAlt}>{padText("─".repeat(titleBar), titleWidth)}</text>
        <text fg={theme.panelAlt}>{"╌".repeat(COLUMNS.sparkline)}</text>
        <text fg={theme.panelAlt}>{padText("··", COLUMNS.events, "right")}</text>
        <text fg={theme.panelAlt}>{padText("··", COLUMNS.users, "right")}</text>
        <text fg={theme.panelAlt}>{padText("", COLUMNS.priority, "right")}</text>
      </box>
      <box style={{ flexDirection: "row", width, paddingLeft: 3 }}>
        <text fg={theme.panelAlt}>{"─".repeat(metaBar)}</text>
      </box>
    </box>
  );
}
