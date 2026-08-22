import { useCallback, useEffect, useMemo, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listEnvironments, type Environment } from "~/api/issues";
import { theme } from "~/core/theme";
import { fitText, measureTextWidth } from "~/lib/text";
import {
  ChipRow,
  CHIP_GAP,
  CHIP_HEIGHT,
  chipOffsets,
  chipWidth,
  type ChipSpec,
} from "~/ui/components/Chip";
import { Dropdown, type DropdownItem } from "~/ui/components/Dropdown";
import { useProjectSearch } from "~/ui/hooks/useProjects";

/**
 * Rows the search box occupies: its input line plus the border above and
 * below. The filter row starts immediately after it.
 */
export const SEARCH_ROWS = 3;

/** Pre-defined date range options matching Sentry's web UI. */
const DATE_OPTIONS: readonly DropdownItem[] = [
  { label: "1 hour", value: "1h" },
  { label: "24 hours", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "14 days", value: "14d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

export type FilterDropdownType = "project" | "env" | "date" | null;

/** Chip order in the filter row, so a click and the open state agree. */
const CHIP_ORDER = ["project", "env", "date"] as const satisfies ReadonlyArray<
  Exclude<FilterDropdownType, null>
>;

/** One ellipsis cell for each dynamic filter label. */
const MIN_FITTED_LABEL_WIDTH = 1;

/**
 * Share a cell budget fairly, then give any cells a short label did not need
 * to the longer one.
 */
function filterLabelWidths(
  projectLabel: string,
  envLabel: string,
  budget: number,
): [project: number, environment: number] {
  const available = Math.max(0, Math.floor(budget));
  const projectWanted = measureTextWidth(projectLabel);
  const envWanted = measureTextWidth(envLabel);
  let project = Math.min(projectWanted, Math.ceil(available / 2));
  let environment = Math.min(envWanted, Math.floor(available / 2));
  const spare = available - project - environment;

  if (project === projectWanted) {
    environment += Math.min(spare, envWanted - environment);
  } else if (environment === envWanted) {
    project += Math.min(spare, projectWanted - project);
  }

  return [project, environment];
}

export interface FilterBarProps {
  client: SentryClient | null;
  org: string;
  /** Which dropdown is open (null = none). Owned by the parent for key routing. */
  openDropdown: FilterDropdownType;
  /**
   * Selected project refs, empty for all — a slug from this component's own
   * dropdown, or a numeric id from a saved view. Resolved to slugs for display.
   */
  selectedProjects: string[];
  /** Selected environment names (empty = all). */
  selectedEnvs: string[];
  /** Selected stats period. */
  statsPeriod: string;
  sortLabel: string;
  /** Cells the row has, used to fit its labels without overflowing. */
  width: number;
  /**
   * Row offset from the top of the terminal where the filter bar area starts.
   * The component adds its own leading gap when placing dropdowns.
   */
  anchorTop: number;
  onProjectChange: (projects: string[]) => void;
  onEnvChange: (envs: string[]) => void;
  onPeriodChange: (period: string) => void;
  onDropdownClose: () => void;
  /** Open a dropdown by clicking its chip; the keyboard route lives in `App`. */
  onDropdownOpen?: (which: FilterDropdownType) => void;
}

/**
 * How many `FilterBar`s are mounted.
 *
 * `P` / `E` / `D` are in the command table for every screen, but only a screen
 * that renders a filter row can answer them — it is the thing that mounts the
 * `Dropdown`. Opening one on a screen without a filter row used to leave
 * `openDropdown` set with nothing on screen to clear it, and because the
 * router hands every key to the focused widget while a dropdown is open, the
 * app stopped answering the keyboard at all.
 *
 * The router asks this before setting the state, so those keys are a no-op on
 * a screen with no filter row rather than a mode with no exit. Checking the
 * mount rather than the state is what makes it race-free: a filter row is part
 * of its screen's render and is already there when the key arrives, unlike the
 * `Dropdown` the key itself is what mounts.
 */
let mountedFilterBars = 0;

/** Is a filter row on screen to answer the filter keys? */
export function isFilterBarMounted(): boolean {
  return mountedFilterBars > 0;
}

/**
 * The filter row below the search bar: project / environment / date selectors,
 * plus the sort indicator. When a dropdown is active, it renders as an
 * absolutely-positioned overlay.
 */
export function FilterBar({
  client,
  org,
  openDropdown,
  selectedProjects,
  selectedEnvs,
  statsPeriod,
  sortLabel,
  width,
  anchorTop,
  onProjectChange,
  onEnvChange,
  onPeriodChange,
  onDropdownClose,
  onDropdownOpen,
}: FilterBarProps) {
  // What has been typed into the project picker, held here rather than inside
  // the dropdown because the search that answers it goes to the API.
  const [projectQuery, setProjectQuery] = useState("");
  const { projects, loading: projectsLoading } = useProjectSearch(client, org, projectQuery);
  const [environments, setEnvironments] = useState<Environment[]>([]);

  // Counted here so the router can ask whether a filter row is on screen
  // before it opens one of these dropdowns.
  useEffect(() => {
    mountedFilterBars += 1;
    return () => {
      mountedFilterBars -= 1;
    };
  }, []);

  // A closed picker holds no query, so reopening it starts on the full list
  // rather than on whatever the last visit narrowed it to.
  useEffect(() => {
    if (openDropdown !== "project") setProjectQuery("");
  }, [openDropdown]);

  // Fetch environments once when the client is available. Short enough that
  // one request holds them all, unlike the projects above.
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();

    void listEnvironments(client, { org, signal: controller.signal })
      .then((data) => setEnvironments(data))
      .catch(() => {});

    return () => controller.abort();
  }, [client, org]);

  // Slugs only, never display names: the slug is what the chip shows once a
  // project is picked, what the API takes, and what a filter query is typed
  // against — a second name for the same row only makes the list harder to
  // scan.
  // A selected project always has a row, even when the search that is showing
  // has nothing to do with it: the picker opens on the selection, and one
  // outside the fetched set would otherwise lose both its dot and the cursor.
  const projectItems: DropdownItem[] = useMemo(() => {
    const items = projects.map((p) => ({
      label: p.slug,
      value: p.slug,
      platform: p.platform ?? null,
    }));
    const listed = new Set(items.map((item) => item.value));
    const missing = projectQuery.trim()
      ? []
      : selectedProjects
          .filter((slug) => !listed.has(slug))
          .map((slug) => ({ label: slug, value: slug, platform: null }));
    return [...missing, ...items];
  }, [projects, selectedProjects, projectQuery]);

  const envItems: DropdownItem[] = useMemo(
    () => environments.map((e) => ({ label: e.name, value: e.name })),
    [environments],
  );

  // A ref may be an id (a saved view's form) or a slug (the dropdown's), and
  // only slugs are worth showing or matching a dropdown row against. An id
  // that resolves to nothing is left as it stands rather than dropped — the
  // filter *is* applied, so hiding it would be the lie the id form exists to
  // avoid. Before the project list lands nothing resolves, and the chip
  // settles on the slug a moment later.
  const selectedSlugs = useMemo(() => {
    const slugById = new Map(projects.map((p) => [p.id, p.slug]));
    return selectedProjects.map((ref) => slugById.get(ref) ?? ref);
  }, [projects, selectedProjects]);

  const fullProjectLabel = selectedSlugs.length === 0 ? "all projects" : selectedSlugs.join(", ");
  const fullEnvLabel = selectedEnvs.length === 0 ? "all envs" : selectedEnvs.join(", ");

  const projectChip: ChipSpec = {
    command: "sentry.view.filterProject",
    label: fullProjectLabel,
    caret: true,
  };
  const envChip: ChipSpec = {
    command: "sentry.view.filterEnv",
    label: fullEnvLabel,
    caret: true,
  };
  const dateChip: ChipSpec = {
    command: "sentry.view.filterDate",
    label: statsPeriod,
    caret: true,
  };

  // The chip frames, keys, gaps and date are fixed. Sort gets the next claim
  // on the row; the two org-owned labels fairly share what remains.
  const fixedWidth =
    chipWidth({ ...projectChip, label: "" }) +
    chipWidth({ ...envChip, label: "" }) +
    chipWidth(dateChip) +
    CHIP_GAP * 2;
  const sortText = `Sort: ${sortLabel}`;
  const sortWidth = sortLabel.length > 0 ? CHIP_GAP + measureTextWidth(sortText) : 0;
  const showSort =
    sortLabel.length > 0 && width >= fixedWidth + sortWidth + MIN_FITTED_LABEL_WIDTH * 2;
  const labelBudget = width - fixedWidth - (showSort ? sortWidth : 0);
  const [projectLabelWidth, envLabelWidth] = filterLabelWidths(
    fullProjectLabel,
    fullEnvLabel,
    labelBudget,
  );

  // The filter row is three chips; each dropdown drops from its own left edge.
  const chips: ChipSpec[] = [
    { ...projectChip, label: fitText(fullProjectLabel, projectLabelWidth) },
    { ...envChip, label: fitText(fullEnvLabel, envLabelWidth) },
    dateChip,
  ];
  const offsets = chipOffsets(chips);
  const [projectAnchorLeft = 0, envAnchorLeft = 0, dateAnchorLeft = 0] = offsets;
  // A dropdown hangs off the bottom edge of its chip. The chip's own height
  // now covers the whole row, sliver edges included, so clearing it clears
  // everything — an overlay pinned any higher would paint over the pill's
  // bottom edge just as the chip it belongs to lights up.
  const dropdownTop = anchorTop + CHIP_HEIGHT;

  const handleProjectSelect = useCallback(
    (values: string[]) => {
      onProjectChange(values);
    },
    [onProjectChange],
  );

  const handleEnvSelect = useCallback(
    (values: string[]) => {
      onEnvChange(values);
    },
    [onEnvChange],
  );

  const handleDateSelect = useCallback(
    (values: string[]) => {
      onPeriodChange(values[0] ?? "14d");
      onDropdownClose();
    },
    [onPeriodChange, onDropdownClose],
  );

  return (
    <>
      {/*
       * Pinned to one line and clipped. The two org-owned labels are fitted to
       * the measured row before rendering; on a terminal too narrow for even
       * their ellipses plus Sort, Sort is the part that yields.
       */}
      <box
        style={{
          flexDirection: "row",
          // The sort label is one row and the chips are three; centering sits
          // it on the row their text is on rather than up against the pills'
          // top edges.
          alignItems: "center",
          flexShrink: 0,
          height: CHIP_HEIGHT,
          overflow: "hidden",
        }}
      >
        <ChipRow
          chips={chips}
          activeIndex={openDropdown ? CHIP_ORDER.indexOf(openDropdown) : undefined}
          onPress={(_chip, index) => onDropdownOpen?.(CHIP_ORDER[index] ?? null)}
        />
        <box style={{ flexGrow: 1 }} />
        {showSort ? <text fg={theme.muted}>{sortText}</text> : null}
      </box>

      {openDropdown === "project" ? (
        <Dropdown
          title="Project"
          items={projectItems}
          selected={selectedSlugs}
          anchorLeft={projectAnchorLeft}
          anchorTop={dropdownTop}
          // An org's project list runs to hundreds of rows — more than one
          // page holds, so this box searches the API rather than only what
          // came back. The environment and date lists are a handful each, so
          // neither is worth a row of filter box.
          filterable
          remoteFilter
          multiple
          loading={projectsLoading}
          onQueryChange={setProjectQuery}
          placeholder="No projects"
          onSelect={handleProjectSelect}
          onClose={onDropdownClose}
        />
      ) : null}

      {openDropdown === "env" ? (
        <Dropdown
          title="Environment"
          items={envItems}
          selected={selectedEnvs}
          anchorLeft={envAnchorLeft}
          anchorTop={dropdownTop}
          multiple
          onSelect={handleEnvSelect}
          onClose={onDropdownClose}
        />
      ) : null}

      {openDropdown === "date" ? (
        <Dropdown
          title="Date Range"
          items={DATE_OPTIONS as DropdownItem[]}
          selected={[statsPeriod]}
          anchorLeft={dateAnchorLeft}
          anchorTop={dropdownTop}
          showAll={false}
          onSelect={handleDateSelect}
          onClose={onDropdownClose}
        />
      ) : null}
    </>
  );
}
