import type { Group, PriorityLevel } from "~/api/types";
import { theme } from "~/core/theme";
import { issueMessage, issueTitle } from "~/lib/issueText";
import { formatCount, sparkline, timeAgo } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { Placeholder } from "~/ui/components/Placeholder";
import { BOLD } from "~/ui/lib/attributes";

/**
 * The right-hand column strip, mirroring the web stream's table header
 * (`components/stream/group.tsx`: lastSeen 86px, chart 175px, counts 60px).
 * Widths include the gap that precedes each column, so a row is laid out by
 * concatenation without separator elements.
 */
const COLUMN_WIDTH = {
  lastSeen: 10,
  age: 6,
  sparkline: 11,
  events: 7,
  users: 7,
  priority: 6,
  assignee: 5,
} as const;

export type ColumnKey = keyof typeof COLUMN_WIDTH;

const COLUMN_LABEL: Record<ColumnKey, string> = {
  lastSeen: "Last Seen",
  age: "Age",
  sparkline: "Trend",
  events: "Events",
  users: "Users",
  priority: "Prio",
  assignee: "Asgn",
};

const ALL_COLUMNS: ColumnKey[] = [
  "lastSeen",
  "age",
  "sparkline",
  "events",
  "users",
  "priority",
  "assignee",
];

/**
 * Shed columns right-to-left as the terminal narrows. Last to go are the ones
 * the stream is scanned and sorted by; the title always wins, because a row
 * whose title is three characters wide tells you nothing.
 */
const DROP_ORDER: ColumnKey[] = ["assignee", "priority", "age", "users", "sparkline", "lastSeen"];
const MIN_TITLE_WIDTH = 16;

/** `▸` cursor, `●` unread dot, and the space after them. */
const MARKER_WIDTH = 3;
/** Horizontal padding inside each row, matching the web's cell padding. */
export const ROW_PADDING = 1;
/** Three text lines (title / message / meta) plus the separating rule. */
export const ROW_HEIGHT = 4;

export interface RowLayout {
  /** Width available inside the row's padding. */
  content: number;
  title: number;
  columns: ColumnKey[];
}

/**
 * Resolve the row's column set for a given width. Shared by the header, the
 * real row and the skeleton so the three cannot drift apart.
 *
 * @param width Width of the row box, padding included.
 */
export function resolveRowLayout(width: number): RowLayout {
  const content = Math.max(MIN_TITLE_WIDTH + MARKER_WIDTH, width - ROW_PADDING * 2);
  const columns = [...ALL_COLUMNS];

  const titleFor = (cols: ColumnKey[]) =>
    content - MARKER_WIDTH - cols.reduce((sum, key) => sum + COLUMN_WIDTH[key], 0);

  for (const key of DROP_ORDER) {
    if (titleFor(columns) >= MIN_TITLE_WIDTH) break;
    columns.splice(columns.indexOf(key), 1);
  }

  return { content, title: Math.max(MIN_TITLE_WIDTH, titleFor(columns)), columns };
}

/** Sentry renders priority as a 3-bar signal icon; these are its glyphs. */
const PRIORITY_GLYPH: Record<PriorityLevel, string> = {
  high: "▁▄█",
  medium: "▁▄ ",
  low: "▁  ",
};

/**
 * The rule between two rows, drawn as a text line rather than a box border so
 * the selection can meet it exactly.
 *
 * A separator owns a whole terminal cell while the rule itself is a hairline
 * through the middle of it, so neither a plain nor a filled cell lands the
 * highlight on the rule: leaving the cell unpainted stops the band a full line
 * short, and painting it pushes the band half a cell past the rule. Against
 * the selection the rule therefore becomes a half block — filled on the side
 * the selection is on, empty on the other — which puts the edge of the
 * highlight exactly where the hairline was.
 */
function RowRule({
  width,
  selectionAbove = false,
  selectionBelow = false,
}: {
  width: number;
  /** The row immediately above this rule is selected. */
  selectionAbove?: boolean;
  /** The row immediately below this rule is selected. */
  selectionBelow?: boolean;
}) {
  const glyph = selectionAbove ? "▀" : selectionBelow ? "▄" : "─";
  const fg = selectionAbove || selectionBelow ? theme.selected : theme.border;

  return <text fg={fg}>{glyph.repeat(Math.max(0, width))}</text>;
}

/** Column headers, aligned with the rows below them. */
export function IssueListHeader({
  width,
  selectionBelow = false,
}: {
  width: number;
  /** The first row of the list — the one under this rule — is selected. */
  selectionBelow?: boolean;
}) {
  const layout = resolveRowLayout(width);

  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      <box
        style={{
          flexDirection: "row",
          paddingLeft: ROW_PADDING,
          paddingRight: ROW_PADDING,
        }}
      >
        <text fg={theme.muted}>{padText("Issue", MARKER_WIDTH + layout.title)}</text>
        {layout.columns.map((key) => (
          <text key={key} fg={theme.muted}>
            {padText(COLUMN_LABEL[key], COLUMN_WIDTH[key], "right")}
          </text>
        ))}
      </box>
      <RowRule width={width} selectionBelow={selectionBelow} />
    </box>
  );
}

export function IssueRow({
  group,
  selected,
  width,
  pending = false,
  selectionBelow = false,
}: {
  group: Group;
  selected: boolean;
  width: number;
  /** A mutation is in flight for this issue. */
  pending?: boolean;
  /**
   * The row *below* this one is selected. A rule is shared between the two
   * rows it separates, so the row above the selection paints its own rule to
   * close the top edge of the highlight.
   */
  selectionBelow?: boolean;
}) {
  const layout = resolveRowLayout(width);
  const bg = selected ? theme.selected : undefined;
  const title = issueTitle(group);
  const message = issueMessage(group);

  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      {/*
       * The highlight is painted here rather than on the outer box so the rule
       * below can opt in or out of it on its own — see `RowRule`.
       */}
      <box
        style={{
          flexDirection: "column",
          paddingLeft: ROW_PADDING,
          paddingRight: ROW_PADDING,
          backgroundColor: bg,
        }}
      >
        {/* Line 1 — unread dot, exception type, and the metric columns. */}
        <box style={{ flexDirection: "row" }}>
          <text fg={selected ? theme.accent : theme.muted}>{selected ? "▸" : " "}</text>
          {/* An in-flight mutation takes the dot's slot; unread otherwise. */}
          <text fg={theme.accent}>{pending ? "⟳" : group.hasSeen ? " " : "●"}</text>
          <text> </text>
          <Placeholder
            text={title}
            fallback="(no title)"
            width={layout.title}
            fg={theme.text}
            attributes={BOLD}
          />
          {layout.columns.map((key) => (
            <Column key={key} column={key} group={group} />
          ))}
        </box>

        {/* Line 2 — level bar and the exception value, as `EventMessage` does. */}
        <box style={{ flexDirection: "row" }}>
          <text>{"   "}</text>
          <text fg={theme.level[group.level] ?? theme.level.unknown}>┃</text>
          <text> </text>
          <Placeholder
            text={message}
            fallback="(no error message)"
            width={Math.max(0, layout.content - 5)}
            fg={theme.muted}
          />
        </box>

        {/* Line 3 — the dense divider-separated meta row from `groupMetaRow.tsx`. */}
        <box style={{ flexDirection: "row" }}>
          <text>{"     "}</text>
          <text fg={theme.muted}>{metaLine(group, Math.max(0, layout.content - 5), message)}</text>
        </box>
      </box>

      <RowRule width={width} selectionAbove={selected} selectionBelow={selectionBelow} />
    </box>
  );
}

function Column({ column, group }: { column: ColumnKey; group: Group }) {
  const width = COLUMN_WIDTH[column];

  switch (column) {
    case "sparkline":
      return <text fg={theme.muted}>{sparkline(group.stats?.["24h"], width)}</text>;
    case "events":
      return <text fg={theme.text}>{padText(formatCount(group.count), width, "right")}</text>;
    case "users":
      return <text fg={theme.text}>{padText(formatCount(group.userCount), width, "right")}</text>;
    case "lastSeen":
      return (
        <text fg={theme.muted}>{padText(relative(group.lastSeen, true), width, "right")}</text>
      );
    case "age":
      return <text fg={theme.muted}>{padText(relative(group.firstSeen), width, "right")}</text>;
    case "priority":
      return (
        <text fg={theme.muted}>
          {padText(group.priority ? PRIORITY_GLYPH[group.priority] : "", width, "right")}
        </text>
      );
    case "assignee":
      return <text fg={theme.muted}>{padText(initials(group), width, "right")}</text>;
  }
}

/** An absent timestamp is pending phase two, not "just now". */
function relative(iso: string | undefined, suffix = false): string {
  if (!iso) return "··";
  const ago = timeAgo(iso);
  return suffix && ago ? `${ago} ago` : ago;
}

function initials(group: Group): string {
  const name = group.assignedTo?.name;
  if (!name) return "·";
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]!.toUpperCase());
  return letters.join("") || "·";
}

function metaLine(group: Group, width: number, message: string): string {
  const parts = [
    group.shortId,
    group.project?.slug,
    group.isUnhandled ? "Unhandled" : null,
    // When there is no exception value the message line *is* the culprit, so
    // repeating it here would print the same string twice in one row.
    group.culprit === message ? null : group.culprit,
    group.numComments > 0 ? `💬 ${group.numComments}` : null,
    group.logger,
  ].filter((part): part is string => Boolean(part));

  return fitText(parts.join(" │ "), width);
}

/**
 * A row-shaped placeholder at the exact geometry of a real row, so content
 * never jumps when the data lands.
 */
export function IssueRowSkeleton({ width, seed }: { width: number; seed: number }) {
  const layout = resolveRowLayout(width);
  // Vary the bar widths so the list reads as pending content, not a progress
  // bar. Deterministic in the index so frames are stable across renders.
  const titleBar = Math.floor(layout.title * (0.45 + ((seed * 17) % 40) / 100));
  const messageBar = Math.floor((layout.content - 4) * (0.5 + ((seed * 29) % 35) / 100));
  const metaBar = Math.floor((layout.content - 4) * (0.3 + ((seed * 23) % 25) / 100));

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        paddingLeft: ROW_PADDING,
        paddingRight: ROW_PADDING,
        border: ["bottom"],
        borderColor: theme.border,
        flexShrink: 0,
      }}
    >
      <box style={{ flexDirection: "row" }}>
        <text>{"   "}</text>
        <text fg={theme.panelAlt}>{padText("─".repeat(titleBar), layout.title)}</text>
        {layout.columns.map((key) => (
          <text key={key} fg={theme.panelAlt}>
            {padText(
              key === "sparkline" ? "╌".repeat(COLUMN_WIDTH[key]) : "··",
              COLUMN_WIDTH[key],
              "right",
            )}
          </text>
        ))}
      </box>
      <box style={{ flexDirection: "row" }}>
        <text>{"   "}</text>
        <text fg={theme.border}>┃</text>
        <text fg={theme.panelAlt}>{` ${"─".repeat(messageBar)}`}</text>
      </box>
      <box style={{ flexDirection: "row" }}>
        <text>{"     "}</text>
        <text fg={theme.panelAlt}>{"─".repeat(metaBar)}</text>
      </box>
    </box>
  );
}
