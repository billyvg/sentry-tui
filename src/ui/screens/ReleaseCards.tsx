/**
 * Explore › Releases — a card per release, not a table.
 *
 * Mirrors `views/explore/releases/list/releaseCard/`: the version and its
 * deploy on the first line, the package and commit summary under it, then one
 * row per project carrying that project's session health. Sentry draws this as
 * a panel with a sidecard and a nested table for exactly the reason a table
 * can't hold it — a release is one thing with *n* projects inside it, and
 * flattening that into rows loses which release you are looking at.
 *
 * Two async statuses drive it. The list request paints the cards; the health
 * request fills in adoption, crash-free rate and crashes when it lands, and
 * until then those three cells render as pending rather than as zero. That
 * split is upstream's too (`releasesRequest.tsx`, `showHealthPlaceholders`).
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { RenderableEvents, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";

import {
  healthKey,
  type Release,
  type ReleaseHealth,
  type ReleaseHealthIndex,
  type ReleaseProject,
} from "~/api/releases";
import { errorOf, loadingSince, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { formatCount, timeAgo } from "~/lib/sparkline";
import { padText } from "~/lib/text";
import type { Column } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { useCardScrollFollow } from "~/ui/hooks/useCardScrollFollow";
import { useReleaseHealth, useReleases } from "~/ui/hooks/useReleases";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD, ITALIC, UNDERLINE } from "~/ui/lib/attributes";
import { layoutColumns } from "~/ui/lib/tableLayout";
import type { ScreenProps } from "~/ui/screens/types";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Cells the scrollbar takes out of the card list's own width. */
const GUTTER = 2;
/** Cells every line inside a card is indented by, leaving room for the cursor. */
const INDENT = 2;
/** Cells between two columns of the project sub-table. */
const GAP = 1;
/** Version line, meta line, project column header. */
const CARD_HEADER_LINES = 3;
/** Projects a collapsed card shows before it starts counting the rest. */
const COLLAPSED_PROJECTS = 3;
/** Cards drawn while the first page is in flight. */
const SKELETON_CARDS = 4;
/** Projects a skeleton card holds space for. */
const SKELETON_PROJECTS = 2;
/** Cells of the adoption bar itself, before its percentage. */
const ADOPTION_BAR = 12;

/**
 * Crash-free thresholds, verbatim from `releaseCardProjectRow.tsx:46-47`,
 * where they pick between the fire, warning and checkmark icons.
 */
const CRASH_FREE_DANGER = 98;
const CRASH_FREE_WARNING = 99.5;

/** One line of a card's project sub-table. */
interface ProjectRow {
  project: ReleaseProject;
  /** Health for this (release, project) pair, if the index has it. */
  health?: ReleaseHealth;
  /** The health request has not answered yet — draw pending, not absent. */
  pending: boolean;
}

/**
 * The project sub-table's columns, and the order they are given up in.
 *
 * Project and crash-free rate carry no priority, so they survive any width: a
 * release health row that says neither which project nor how healthy it is has
 * nothing left to say. New Issues sheds first (it is the one number that isn't
 * session health), then crashes, then the adoption bar — which is the last to
 * go because a bar is the thing this view renders better than the web does.
 */
const PROJECT_COLUMNS: ReadonlyArray<Column<ProjectRow>> = [
  {
    key: "project",
    label: "Project",
    width: "flex",
    render: (row, _selected, width) => (
      <text fg={theme.text}>{padText(row.project.slug, width)}</text>
    ),
  },
  {
    key: "adoption",
    label: "Adoption",
    width: ADOPTION_BAR + 2 + 4,
    priority: 3,
    render: (row, _selected, width) => <AdoptionCell row={row} width={width} />,
  },
  {
    key: "crashFree",
    label: "Crash-Free",
    width: 11,
    align: "right",
    render: (row, _selected, width) => <CrashFreeCell row={row} width={width} />,
  },
  {
    key: "crashes",
    label: "Crashes",
    width: 8,
    align: "right",
    priority: 2,
    render: (row, _selected, width) =>
      row.pending ? (
        <PendingCell width={width} align="right" />
      ) : (
        <text fg={theme.muted}>
          {padText(row.health ? formatCount(row.health.sessionsCrashed ?? 0) : "—", width, "right")}
        </text>
      ),
  },
  {
    key: "newIssues",
    label: "New Issues",
    width: 10,
    align: "right",
    priority: 1,
    // From the list request, not the health one — it is never pending.
    render: (row, _selected, width) => (
      <text fg={theme.muted}>{padText(formatCount(row.project.newGroups), width, "right")}</text>
    ),
  },
];

export function ReleaseCards({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  onProjectSelect,
  registerActions,
  activateRow,
}: ScreenProps) {
  const { setEntries, setStatus, setOpenDropdown, setDetailOpen, focusSearch, handleSearchBlur } =
    state;
  const listRef = useRef<ScrollBoxRenderable>(null);
  const inputRef = useRef<InputRenderable>(null);

  /**
   * PLACEHOLDER, awaiting `src/ui/components/SearchInput.tsx`.
   *
   * The saved-queries branch is extracting the bordered `/`-prefixed input out
   * of `LogStream` into a shared component. Whichever of the two lands second
   * deletes this callback and the box that uses it and renders that component
   * instead — nothing else in this file touches `inputRef`.
   *
   * Left working rather than stubbed out: `committedQuery` is the version
   * filter the release list is fetched with, so a placeholder that couldn't
   * commit a query would take the filter away with it.
   *
   * Syncs native focus/blur (a mouse click) back to the app's search state.
   */
  const inputRefCallback = useCallback(
    (node: InputRenderable | null) => {
      const previous = inputRef.current;
      if (previous) {
        previous.removeAllListeners(RenderableEvents.FOCUSED);
        previous.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, () => focusSearch());
        node.on(RenderableEvents.BLURRED, () => handleSearchBlur());
      }
    },
    [focusSearch, handleSearchBlur],
  );

  const query = state.committedQuery;
  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;
  const params = { org, query, statsPeriod: state.statsPeriod, project, environment, reloadToken };

  const { releases: releasesStatus } = useReleases(client, params);
  const healthStatus = useReleaseHealth(client, params);

  const releases = valueOf(releasesStatus);
  const listError = errorOf(releasesStatus);
  const health = valueOf(healthStatus);
  const healthError = errorOf(healthStatus);
  const healthPending = health === undefined && healthStatus.state === "loading";

  const loading = releasesStatus.state === "loading";
  const since = loadingSince(releasesStatus);

  useEffect(() => {
    if (releases) setEntries(releases);
  }, [releases, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      since,
      // A failed health request is worth saying out loud: the cards render
      // fine without it, so the only other signal would be three columns of
      // em-dashes that look like absent data rather than a failed fetch.
      error: listError?.message ?? (healthError ? `health: ${healthError.message}` : undefined),
      noun: "releases",
    });
  }, [loading, since, listError, healthError, releasesStatus, setStatus]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  /**
   * Enter expands the card under the cursor to show every project it shipped
   * to, the way the web's `Collapsible` "Show N More" button does. It follows
   * the cursor rather than pinning a release, so j/k keeps working while a
   * card is open and Escape closes it before anything else claims the key.
   */
  useScreenActions(registerActions, {
    open: () => setDetailOpen((open) => !open),
    back: () => {
      if (!state.detailOpen) return false;
      setDetailOpen(false);
      return true;
    },
  });

  const cardWidth = Math.max(20, width - GUTTER);
  const tableWidth = Math.max(10, cardWidth - INDENT);
  const resolved = useMemo(
    () => layoutColumns(PROJECT_COLUMNS, tableWidth, { gap: GAP }),
    [tableWidth],
  );

  /** Card heights, in display order — what the scrollbox is measured against. */
  const heights = useMemo(
    () =>
      (releases ?? []).map((release, index) =>
        cardHeight(release, state.detailOpen && index === state.selected),
      ),
    [releases, state.detailOpen, state.selected],
  );

  useCardScrollFollow(listRef, {
    index: state.selected,
    heights,
    layout: [height],
  });

  const showSkeleton = releases === undefined && loading;
  const showEmpty = releases !== undefined && releases.length === 0 && !loading;

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/* PLACEHOLDER: replaced by `SearchInput` — see `inputRefCallback` above. */}
      <box
        style={{
          flexDirection: "row",
          width,
          flexShrink: 0,
          height: SEARCH_ROWS,
          border: true,
          borderStyle: "rounded",
          borderColor: state.searchFocused ? theme.accent : theme.border,
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={state.searchFocused ? theme.accent : theme.text} attributes={UNDERLINE}>
          {"/"}
        </text>
        <text> </text>
        <input
          ref={inputRefCallback}
          value={state.searchQuery}
          placeholder="Search releases…"
          focused={state.searchFocused}
          onInput={state.setSearchQuery}
          style={{
            flexGrow: 1,
            textColor: theme.text,
            backgroundColor: theme.panel,
            focusedTextColor: theme.text,
            focusedBackgroundColor: theme.panel,
            placeholderColor: theme.subText,
          }}
        />
      </box>

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sortLabel={releases ? `${releases.length} releases` : ""}
        width={width}
        anchorTop={SEARCH_ROWS}
        onProjectChange={onProjectSelect}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      <scrollbox
        ref={listRef}
        focused={focused}
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
        }}
        style={{ flexGrow: 1, flexBasis: 0, width }}
      >
        {showSkeleton
          ? Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <SkeletonCard key={i} resolved={resolved} width={cardWidth} seed={i} />
            ))
          : null}

        {showEmpty ? (
          <box style={{ flexDirection: "column", padding: 1 }}>
            <text fg={theme.text}>No releases found.</text>
            {query ? <text fg={theme.muted}>{query}</text> : null}
            <text fg={theme.muted}>
              Try widening the time range or clearing the version filter.
            </text>
            <text fg={theme.muted}>This organization may not have release tracking set up.</text>
          </box>
        ) : null}

        {releases?.map((release, index) => (
          <ReleaseCard
            key={release.version}
            release={release}
            index={index}
            health={health}
            healthPending={healthPending}
            resolved={resolved}
            width={cardWidth}
            selected={focused && index === state.selected}
            expanded={state.detailOpen && index === state.selected}
            onPress={activateRow}
          />
        ))}

        {listError && releases === undefined ? (
          <box style={{ flexDirection: "column", padding: 1 }}>
            <text fg={theme.danger}>Failed to load releases</text>
            <text fg={theme.muted}>{listError.message}</text>
            {listError.retryable ? <text fg={theme.muted}>R to retry</text> : null}
          </box>
        ) : null}
      </scrollbox>
    </box>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

interface ResolvedColumn {
  column: Column<ProjectRow>;
  width: number;
}

/** Projects a card draws, and how many it is holding back. */
function cardProjects(
  release: Release,
  expanded: boolean,
): { shown: readonly ReleaseProject[]; hidden: number } {
  // Alphabetical, as `releaseCard/index.tsx:97-104` sorts them, so a card's
  // rows don't reshuffle between two releases of the same projects.
  const sorted = [...release.projects].sort((a, b) => a.slug.localeCompare(b.slug));
  if (expanded || sorted.length <= COLLAPSED_PROJECTS) return { shown: sorted, hidden: 0 };
  return {
    shown: sorted.slice(0, COLLAPSED_PROJECTS),
    hidden: sorted.length - COLLAPSED_PROJECTS,
  };
}

/**
 * Lines a card occupies.
 *
 * Kept next to the renderer and derived from the same `cardProjects` call, so
 * the scroll offsets can't drift from what is actually drawn.
 */
export function cardHeight(release: Release, expanded: boolean): number {
  const { shown, hidden } = cardProjects(release, expanded);
  return CARD_HEADER_LINES + shown.length + (hidden > 0 ? 1 : 0) + 1;
}

function ReleaseCard({
  release,
  index,
  health,
  healthPending,
  resolved,
  width,
  selected,
  expanded,
  onPress,
}: {
  release: Release;
  index: number;
  health?: ReleaseHealthIndex;
  healthPending: boolean;
  resolved: readonly ResolvedColumn[];
  width: number;
  selected: boolean;
  expanded: boolean;
  onPress: (index: number) => void;
}) {
  const { shown, hidden } = cardProjects(release, expanded);
  const tableWidth = Math.max(10, width - INDENT);

  // `dateFinished || dateCreated`, and the environment only when there was a
  // deploy — `releaseCard/index.tsx:153-157`.
  const when = timeAgo(release.lastDeploy?.dateFinished ?? release.dateCreated);
  const suffix = release.lastDeploy ? ` │ ${release.lastDeploy.environment}` : "";
  const stamp = `${when}${suffix}`;
  // The version keeps at least four cells at any width; the deploy stamp gives
  // up the rest of the line rather than pushing the row past the card's width.
  const stampWidth = Math.min(stamp.length + 1, Math.max(0, width - INDENT - 4));
  const versionWidth = Math.max(4, width - INDENT - stampWidth);

  return (
    <box
      style={{ flexDirection: "column", width, flexShrink: 0 }}
      onMouseDown={() => onPress(index)}
    >
      <box
        style={{
          flexDirection: "row",
          width,
          backgroundColor: selected ? theme.selected : undefined,
        }}
      >
        <text fg={theme.accent}>{selected ? "❯ " : "  "}</text>
        <text fg={theme.text} attributes={BOLD}>
          {padText(release.shortVersion || release.version, versionWidth)}
        </text>
        <text fg={theme.subText}>{padText(stamp, stampWidth, "right")}</text>
      </box>

      <text fg={theme.muted}>{padText(`  ${releaseSummary(release)}`, width)}</text>

      <box style={{ flexDirection: "row", width }}>
        <text>{" ".repeat(INDENT)}</text>
        {resolved.map(({ column, width: cellWidth }, i) => (
          <text key={column.key} fg={theme.subText}>
            {(i > 0 ? " ".repeat(GAP) : "") +
              padText(column.label, cellWidth, column.align ?? "left")}
          </text>
        ))}
      </box>

      {shown.map((project) => (
        <box key={project.id} style={{ flexDirection: "row", width }}>
          <text>{" ".repeat(INDENT)}</text>
          {resolved.map(({ column, width: cellWidth }, i) => (
            <box key={column.key} style={{ flexDirection: "row", flexShrink: 0 }}>
              {i > 0 ? <text>{" ".repeat(GAP)}</text> : null}
              {column.render(
                {
                  project,
                  health: health?.get(healthKey(release.version, project.id)),
                  pending: healthPending,
                },
                selected,
                cellWidth,
              )}
            </box>
          ))}
        </box>
      ))}

      {hidden > 0 ? (
        <text fg={theme.subText} attributes={ITALIC}>
          {padText(
            `  +${hidden} more ${hidden === 1 ? "project" : "projects"} — enter to expand`,
            width,
          )}
        </text>
      ) : null}

      <text fg={theme.border}>{"─".repeat(Math.max(0, tableWidth + INDENT))}</text>
    </box>
  );
}

/**
 * The card's second line: package and commit summary.
 *
 * `"%s commits by %s authors"` is `releaseCardCommits.tsx:36-40`, which
 * renders nothing at all when a release has no commits — hence the join rather
 * than a fixed format.
 */
function releaseSummary(release: Release): string {
  const parts: string[] = [];
  if (release.package) parts.push(release.package);
  if (release.commitCount > 0) {
    const commits = `${release.commitCount} ${release.commitCount === 1 ? "commit" : "commits"}`;
    const authors = `${release.authorCount} ${release.authorCount === 1 ? "author" : "authors"}`;
    parts.push(`${commits} by ${authors}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "no commits associated";
}

// ---------------------------------------------------------------------------
// Health cells
// ---------------------------------------------------------------------------

/**
 * Adoption as a proportional bar plus its percentage.
 *
 * The web draws a 24-hour mini bar chart here and puts the percentage beside
 * it. A terminal has neither the pixels for the chart nor a tooltip to explain
 * it, but it renders a proportion better than a browser does, so the bar shows
 * the share itself rather than the series behind it.
 */
function AdoptionCell({ row, width }: { row: ProjectRow; width: number }) {
  const barWidth = Math.max(1, width - 6);
  if (row.pending) return <PendingCell width={width} />;

  const adoption = row.health?.adoption;
  if (adoption === undefined) {
    return <text fg={theme.subText}>{padText("—", width)}</text>;
  }

  const clamped = Math.max(0, Math.min(100, adoption));
  const filled = Math.round((clamped / 100) * barWidth);
  return (
    <>
      <text fg={theme.accent}>{"█".repeat(filled)}</text>
      <text fg={theme.panelAlt}>{"░".repeat(barWidth - filled)}</text>
      <text fg={theme.muted}>{padText(`${Math.round(clamped)}%`, width - barWidth, "right")}</text>
    </>
  );
}

/** Crash-free rate, coloured by the same thresholds the web picks icons with. */
function CrashFreeCell({ row, width }: { row: ProjectRow; width: number }) {
  if (row.pending) return <PendingCell width={width} align="right" />;

  const rate = row.health?.crashFreeSessions;
  if (rate === undefined) {
    return <text fg={theme.subText}>{padText("—", width, "right")}</text>;
  }

  const [color, marker] =
    rate < CRASH_FREE_DANGER
      ? [theme.danger, "✗"]
      : rate < CRASH_FREE_WARNING
        ? [theme.warning, "!"]
        : [theme.success, "✓"];

  return (
    <text fg={color}>{padText(`${marker} ${displayCrashFreePercent(rate)}`, width, "right")}</text>
  );
}

/**
 * A cell whose value is still in flight.
 *
 * Deliberately the same dash bar the `DataTable` skeleton draws: a card whose
 * list has landed and whose health has not is a half-loaded thing, and saying
 * so in the vocabulary the rest of the app already uses for pending content is
 * what keeps it from reading as broken.
 */
function PendingCell({ width, align = "left" }: { width: number; align?: "left" | "right" }) {
  return (
    <text fg={theme.panelAlt}>
      {padText("─".repeat(Math.max(1, Math.floor(width * 0.6))), width, align)}
    </text>
  );
}

/**
 * Crash-free percentages the way Sentry formats them
 * (`views/explore/releases/utils/index.tsx:38-58`): three decimals above 90%,
 * none below, `<1%` for anything between zero and one, and never rounded up to
 * a flat 100% when it isn't.
 */
export function displayCrashFreePercent(percent: number): string {
  if (Number.isNaN(percent)) return "—";
  if (percent > 0 && percent < 1) return "<1%";

  const places = percent > 90 ? 3 : 0;
  const factor = 10 ** places;
  let rounded = Math.round(percent * factor) / factor;
  if (rounded === 100 && percent < 100) rounded = Math.floor(percent * factor) / factor;
  return `${rounded}%`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * A card-shaped placeholder at the geometry of a real card: same indent, same
 * resolved columns, same number of lines, so nothing shifts when the releases
 * land. Bar lengths vary deterministically with the card index, as the table
 * skeleton's do.
 */
function SkeletonCard({
  resolved,
  width,
  seed,
}: {
  resolved: readonly ResolvedColumn[];
  width: number;
  seed: number;
}) {
  const tableWidth = Math.max(10, width - INDENT);
  return (
    <box style={{ flexDirection: "column", width, flexShrink: 0 }}>
      <text fg={theme.panelAlt}>{padText(`  ${bar(24, seed)}`, width)}</text>
      <text fg={theme.panelAlt}>{padText(`  ${bar(32, seed + 3)}`, width)}</text>
      <box style={{ flexDirection: "row", width }}>
        <text>{" ".repeat(INDENT)}</text>
        {resolved.map(({ column, width: cellWidth }, i) => (
          <text key={column.key} fg={theme.subText}>
            {(i > 0 ? " ".repeat(GAP) : "") +
              padText(column.label, cellWidth, column.align ?? "left")}
          </text>
        ))}
      </box>
      {Array.from({ length: SKELETON_PROJECTS }, (_, row) => (
        <box key={row} style={{ flexDirection: "row", width }}>
          <text>{" ".repeat(INDENT)}</text>
          {resolved.map(({ column, width: cellWidth }, i) => (
            <text key={column.key} fg={theme.panelAlt}>
              {(i > 0 ? " ".repeat(GAP) : "") +
                padText(bar(cellWidth, seed + row + i), cellWidth, column.align ?? "left")}
            </text>
          ))}
        </box>
      ))}
      <text fg={theme.border}>{"─".repeat(Math.max(0, tableWidth + INDENT))}</text>
    </box>
  );
}

/** A dash bar of a deterministic fraction of the cell, never wider than it. */
function bar(width: number, seed: number): string {
  if (width <= 0) return "";
  const fraction = 0.4 + ((seed * 17) % 45) / 100;
  return "─".repeat(Math.max(1, Math.min(width, Math.floor(width * fraction))));
}
