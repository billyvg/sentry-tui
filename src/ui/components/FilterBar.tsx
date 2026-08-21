import { useCallback, useEffect, useMemo, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listEnvironments, type Environment } from "~/api/issues";
import { theme } from "~/core/theme";
import { measureTextWidth } from "~/lib/text";
import {
  ChipRow,
  CHIP_GAP,
  CHIP_HEIGHT,
  chipOffsets,
  chipWidth,
  type ChipSpec,
} from "~/ui/components/Chip";
import { Dropdown, type DropdownItem } from "~/ui/components/Dropdown";
import { useProjects } from "~/ui/hooks/useProjects";

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

/** Blank rows rendered above and below the selector row to give it breathing room. */
const ROW_GAP = 1;

/** Chip order in the filter row, so a click and the open state agree. */
const CHIP_ORDER = ["project", "env", "date"] as const satisfies ReadonlyArray<
  Exclude<FilterDropdownType, null>
>;

export interface FilterBarProps {
  client: SentryClient | null;
  org: string;
  /** Which dropdown is open (null = none). Owned by the parent for key routing. */
  openDropdown: FilterDropdownType;
  /** Selected project slugs (empty = all). */
  selectedProjects: string[];
  /** Selected environment names (empty = all). */
  selectedEnvs: string[];
  /** Selected stats period. */
  statsPeriod: string;
  sortLabel: string;
  /**
   * Cells the row has. Given one, the sort label is dropped when the chips
   * leave no room for it; without one the label is clipped instead.
   */
  width?: number;
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
  const projects = useProjects(client, org);
  const [environments, setEnvironments] = useState<Environment[]>([]);

  // Fetch environments once when the client is available; projects come from
  // the shared hook, which the saved-views screen reads too.
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
  const projectItems: DropdownItem[] = useMemo(
    () =>
      projects.map((p) => ({
        label: p.slug,
        value: p.slug,
        platform: p.platform ?? null,
      })),
    [projects],
  );

  const envItems: DropdownItem[] = useMemo(
    () => environments.map((e) => ({ label: e.name, value: e.name })),
    [environments],
  );

  const projectLabel =
    selectedProjects.length === 0
      ? "all projects"
      : selectedProjects.length === 1
        ? selectedProjects[0]!
        : `${selectedProjects.length} projects`;

  const envLabel =
    selectedEnvs.length === 0
      ? "all envs"
      : selectedEnvs.length === 1
        ? selectedEnvs[0]!
        : `${selectedEnvs.length} envs`;

  // The filter row is three chips; each dropdown drops from its own left edge.
  const chips: ChipSpec[] = [
    { command: "sentry.view.filterProject", label: projectLabel, caret: true },
    { command: "sentry.view.filterEnv", label: envLabel, caret: true },
    { command: "sentry.view.filterDate", label: statsPeriod, caret: true },
  ];
  const offsets = chipOffsets(chips);
  const [projectAnchorLeft = 0, envAnchorLeft = 0, dateAnchorLeft = 0] = offsets;

  /**
   * The sort label, or nothing when the chips already fill the row.
   *
   * Below about 90 columns the two together are wider than the pane. The label
   * is the half worth losing — it restates a count the status bar also carries
   * — and dropping it beats a truncated fragment of one.
   */
  const sortText = `Sort: ${sortLabel}`;
  const chipsWidth = (offsets.at(-1) ?? 0) + chipWidth(chips.at(-1)!);
  const showSort =
    sortLabel.length > 0 &&
    (width === undefined || chipsWidth + CHIP_GAP + measureTextWidth(sortText) <= width);
  // A dropdown hangs off the bottom edge of its chip, so it clears the gap
  // above the row *and* the chip's own height, border included.
  const dropdownTop = anchorTop + ROW_GAP + CHIP_HEIGHT;

  const handleProjectSelect = useCallback(
    (values: string[]) => {
      onProjectChange(values);
      onDropdownClose();
    },
    [onProjectChange, onDropdownClose],
  );

  const handleEnvSelect = useCallback(
    (values: string[]) => {
      onEnvChange(values);
      onDropdownClose();
    },
    [onEnvChange, onDropdownClose],
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
       * Pinned to one line and clipped. Below about 90 columns the chips and
       * the sort label together are wider than the pane, and a `<text>` that
       * doesn't fit wraps — which turned the filter row into an eight-line
       * column of one-word fragments that pushed the list off screen. The
       * label is the half worth losing: it restates a count the status bar
       * also carries.
       */}
      <box
        style={{
          flexDirection: "row",
          flexShrink: 0,
          height: CHIP_HEIGHT,
          overflow: "hidden",
          marginTop: ROW_GAP,
          marginBottom: ROW_GAP,
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
          selected={selectedProjects}
          anchorLeft={projectAnchorLeft}
          anchorTop={dropdownTop}
          // An org's project list runs to hundreds of rows; the environment
          // and date lists are a handful each, so only this one is worth a row
          // of filter box.
          filterable
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
