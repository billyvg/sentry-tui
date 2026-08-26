import type { Group, PriorityLevel } from "~/api/types";
import { assigneeInitials } from "~/core/avatars";
import { useTheme } from "~/ui/theme";
import { issueMessage, issueTitle } from "~/lib/issueText";
import { formatCount, sparkline, timeAgo } from "~/lib/sparkline";
import { fitText, measureTextWidth, padText } from "~/lib/text";
import { PlatformIcon, usePlatformIconWidth } from "~/ui/components/PlatformIcon";
import { Placeholder } from "~/ui/components/Placeholder";
import { useImageSupport } from "~/ui/hooks/useImageSupport";
import { BOLD } from "~/ui/lib/attributes";
import { layoutColumns, type ColumnSpec } from "~/ui/lib/tableLayout";

/**
 * The right-hand column strip, mirroring the web stream's table header
 * (`components/stream/group.tsx`: lastSeen 86px, chart 175px, counts 60px).
 * Widths include the gap that precedes each column, so a row is laid out by
 * concatenation without separator elements.
 */
const COLUMN_WIDTH = {
  lastSeen: 10,
  age: 6,
  sparkline: 12,
  events: 7,
  users: 7,
  priority: 6,
  assignee: 5,
} as const;

/**
 * The sparkline fills its cell edge to edge, so unlike the right-aligned text
 * columns it has no whitespace of its own to separate it from its neighbours.
 * It is bracketed instead: gap, rule, glyphs, rule — `COLUMN_WIDTH.sparkline`
 * split four ways.
 */
const SPARKLINE_GLYPHS = COLUMN_WIDTH.sparkline - 3;

/**
 * Footprint of an assignee's avatar, in cells. Two by one is square given a
 * terminal cell's proportions, so the picture sits on the row's first line
 * rather than forcing the row taller — the same trade the platform icon makes.
 */
const AVATAR_WIDTH = 2;
const AVATAR_HEIGHT = 1;

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
 * The issue row's custom renderer still resolves its columns through the same
 * priority-driven layout engine as `DataTable`. Events and the title have no
 * priority, so they survive until the engine's last-resort narrow-pane path;
 * the optional columns encode the stream's established shed order.
 */
const MIN_TITLE_WIDTH = 16;

/** `▸` cursor, `●` unread dot, and the space after them. */
const MARKER_WIDTH = 3;

interface IssueColumnSpec extends ColumnSpec {
  key: "marker" | "title" | ColumnKey;
}

const LAYOUT_COLUMNS: readonly IssueColumnSpec[] = [
  { key: "marker", width: MARKER_WIDTH },
  { key: "title", width: "flex" },
  { key: "lastSeen", width: COLUMN_WIDTH.lastSeen, priority: 6 },
  { key: "age", width: COLUMN_WIDTH.age, priority: 3 },
  { key: "sparkline", width: COLUMN_WIDTH.sparkline, priority: 5 },
  { key: "events", width: COLUMN_WIDTH.events },
  { key: "users", width: COLUMN_WIDTH.users, priority: 4 },
  { key: "priority", width: COLUMN_WIDTH.priority, priority: 2 },
  { key: "assignee", width: COLUMN_WIDTH.assignee, priority: 1 },
];
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
  const resolved = layoutColumns(LAYOUT_COLUMNS, content, { gap: 0, minFlex: MIN_TITLE_WIDTH });
  const title = resolved.find(({ column }) => column.key === "title")?.width ?? MIN_TITLE_WIDTH;
  const visible = new Set(resolved.map(({ column }) => column.key));
  const columns = ALL_COLUMNS.filter((key) => visible.has(key));

  return { content, title, columns };
}

/**
 * The web renders priority as a 3-bar signal icon, but block glyphs next to the
 * Trend column read as a second sparkline. A word carries the same information
 * without competing with the bars beside it.
 */
const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  high: "high",
  medium: "med",
  low: "low",
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
  const theme = useTheme();
  const glyph = selectionAbove ? "▀" : selectionBelow ? "▄" : "─";
  const fg = selectionAbove || selectionBelow ? theme.selected : theme.border;

  return <text fg={fg}>{glyph.repeat(Math.max(0, width))}</text>;
}

/**
 * The Trend cell — bracketed content at exactly `COLUMN_WIDTH.sparkline`.
 * Shared by the header, the row and the skeleton so the rules stay in one
 * column all the way down the list.
 *
 * @param content Cell body, already `SPARKLINE_GLYPHS` wide.
 * @param rules Draw the bracketing rules. The header blanks them — its label
 *   is already set apart by the row rule beneath it — while still spending the
 *   cells, so the column stays aligned with the rows.
 */
function TrendCell({
  content,
  fg,
  rules = true,
}: {
  content: string;
  fg: string;
  rules?: boolean;
}) {
  const theme = useTheme();
  const rule = rules ? "│" : " ";

  return (
    <>
      <text> </text>
      <text fg={theme.border}>{rule}</text>
      <text fg={fg}>{content}</text>
      <text fg={theme.border}>{rule}</text>
    </>
  );
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
  const theme = useTheme();
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
        {layout.columns.map((key) =>
          key === "sparkline" ? (
            <TrendCell
              key={key}
              content={padText(COLUMN_LABEL[key], SPARKLINE_GLYPHS, "center")}
              fg={theme.muted}
              rules={false}
            />
          ) : (
            <text key={key} fg={theme.muted}>
              {padText(COLUMN_LABEL[key], COLUMN_WIDTH[key], "right")}
            </text>
          ),
        )}
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
  assigneeAvatarUrl,
  onClick,
}: {
  group: Group;
  selected: boolean;
  width: number;
  /** A mutation is in flight for this issue. */
  pending?: boolean;
  /**
   * The assignee's own avatar, when they have one. Resolved by the list rather
   * than the row: the lookup costs one request for the whole organization, so
   * it can't be per-row work.
   */
  assigneeAvatarUrl?: string;
  /**
   * The row *below* this one is selected. A rule is shared between the two
   * rows it separates, so the row above the selection paints its own rule to
   * close the top edge of the highlight.
   */
  selectionBelow?: boolean;
  /** The row was clicked. What that means is the list owner's call. */
  onClick?: () => void;
}) {
  const theme = useTheme();
  const layout = resolveRowLayout(width);
  const bg = selected ? theme.selected : undefined;
  const title = issueTitle(group);
  const message = issueMessage(group);
  const iconWidth = usePlatformIconWidth();
  const meta = metaRow(group, Math.max(0, layout.content - 5), message, iconWidth);

  return (
    // The handler sits on the outer box so every cell of the row answers to a
    // click, the shared rule included — a three-line row with dead columns in
    // it would read as an unreliable target.
    <box style={{ flexDirection: "column", width, flexShrink: 0 }} onMouseDown={onClick}>
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
            <Column key={key} column={key} group={group} avatarUrl={assigneeAvatarUrl} />
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
          <text fg={theme.muted}>{meta.lead}</text>
          {meta.showIcon ? <PlatformIcon platform={group.project?.platform} /> : null}
          <text fg={theme.muted}>{meta.rest}</text>
        </box>
      </box>

      <RowRule width={width} selectionAbove={selected} selectionBelow={selectionBelow} />
    </box>
  );
}

/**
 * The Asgn cell — the assignee's own picture when there is one to show, and
 * their initials otherwise.
 *
 * The image is right-aligned into the same cells the initials occupy, padded
 * with a text run rather than a margin so the column keeps its exact width
 * either way and the metric columns to its left stay in one line down the
 * list.
 *
 * @param avatarUrl Remote URL of the assignee's avatar, if they set one.
 */
function AssigneeCell({ group, avatarUrl }: { group: Group; avatarUrl?: string }) {
  const theme = useTheme();
  const width = COLUMN_WIDTH.assignee;
  const { supportsHighRes } = useImageSupport();

  // Without kitty or sixel an avatar degrades to half-block mush, which reads
  // as neither a face nor a name — initials say more in the same two cells.
  if (!avatarUrl || !supportsHighRes) {
    return (
      <text fg={theme.muted}>{padText(assigneeInitials(group.assignedTo), width, "right")}</text>
    );
  }

  return (
    <>
      <text>{" ".repeat(Math.max(0, width - AVATAR_WIDTH))}</text>
      <image
        source={avatarUrl}
        fit="fit"
        style={{ width: AVATAR_WIDTH, height: AVATAR_HEIGHT, flexShrink: 0 }}
      />
    </>
  );
}

function Column({
  column,
  group,
  avatarUrl,
}: {
  column: ColumnKey;
  group: Group;
  avatarUrl?: string;
}) {
  const theme = useTheme();
  const width = COLUMN_WIDTH[column];

  switch (column) {
    case "sparkline":
      return (
        <TrendCell content={sparkline(group.stats?.["24h"], SPARKLINE_GLYPHS)} fg={theme.muted} />
      );
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
          {padText(group.priority ? PRIORITY_LABEL[group.priority] : "", width, "right")}
        </text>
      );
    case "assignee":
      return <AssigneeCell group={group} avatarUrl={avatarUrl} />;
  }
}

/** An absent timestamp is pending phase two, not "just now". */
function relative(iso: string | undefined, suffix = false): string {
  if (!iso) return "··";
  const ago = timeAgo(iso);
  return suffix && ago ? `${ago} ago` : ago;
}

/** The meta row, split either side of the project slug's icon. */
interface MetaRow {
  /** Everything before the project slug, including its trailing divider. */
  lead: string;
  /** The project slug onward. */
  rest: string;
  /** Whether the gap between them holds a platform icon. */
  showIcon: boolean;
}

/**
 * Build the dense divider-separated meta row from `groupMetaRow.tsx`.
 *
 * Returned in two pieces rather than one string because the platform icon is
 * an image element, which cannot live inside a text run. `iconWidth` comes off
 * the budget up front so the row still totals `width` cells with the icon in it.
 */
function metaRow(group: Group, width: number, message: string, iconWidth: number): MetaRow {
  const slug = group.project?.slug;
  const before = [group.shortId].filter((part): part is string => Boolean(part));
  const after = [
    slug,
    group.isUnhandled ? "Unhandled" : null,
    // When there is no exception value the message line *is* the culprit, so
    // repeating it here would print the same string twice in one row.
    group.culprit === message ? null : group.culprit,
    group.numComments > 0 ? `💬 ${group.numComments}` : null,
    group.logger,
  ].filter((part): part is string => Boolean(part));

  const showIcon = Boolean(slug) && iconWidth > 0;
  const budget = Math.max(0, width - (showIcon ? iconWidth : 0));

  // With no leading parts the row starts at the slug, so there is no divider
  // to carry and `lead` is empty.
  const lead = before.length > 0 ? fitText(`${before.join(" │ ")} │ `, budget) : "";
  const rest = fitText(after.join(" │ "), Math.max(0, budget - measureTextWidth(lead)));

  return { lead, rest, showIcon };
}

/**
 * A row-shaped placeholder at the exact geometry of a real row, so content
 * never jumps when the data lands.
 */
export function IssueRowSkeleton({ width, seed }: { width: number; seed: number }) {
  const theme = useTheme();
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
        {layout.columns.map((key) =>
          key === "sparkline" ? (
            <TrendCell key={key} content={"╌".repeat(SPARKLINE_GLYPHS)} fg={theme.panelAlt} />
          ) : (
            <text key={key} fg={theme.panelAlt}>
              {padText("··", COLUMN_WIDTH[key], "right")}
            </text>
          ),
        )}
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
