import { useCallback, useEffect, useMemo, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listEnvironments, listProjects, type Environment } from "~/api/issues";
import type { Project } from "~/api/types";
import { theme } from "~/core/theme";
import { Dropdown, type DropdownItem } from "~/ui/components/Dropdown";

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
   * Row offset from the top of the terminal where the filter bar area starts.
   * The component adds its own leading gap when placing dropdowns.
   */
  anchorTop: number;
  onProjectChange: (projects: string[]) => void;
  onEnvChange: (envs: string[]) => void;
  onPeriodChange: (period: string) => void;
  onDropdownClose: () => void;
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
  anchorTop,
  onProjectChange,
  onEnvChange,
  onPeriodChange,
  onDropdownClose,
}: FilterBarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);

  // Fetch projects and environments once when the client is available.
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();

    void listProjects(client, { org, signal: controller.signal })
      .then((data) => setProjects(data))
      .catch(() => {});

    void listEnvironments(client, { org, signal: controller.signal })
      .then((data) => setEnvironments(data))
      .catch(() => {});

    return () => controller.abort();
  }, [client, org]);

  const projectItems: DropdownItem[] = useMemo(
    () => projects.map((p) => ({ label: p.name || p.slug, value: p.slug })),
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

  // Compute anchor positions for each dropdown.
  // The filter row shows: [projects] [envs] [period]
  const projectAnchorLeft = 0;
  const projectChip = `[${projectLabel}]`;
  const envAnchorLeft = projectChip.length + 1;
  const envChip = `[${envLabel}]`;
  const dateAnchorLeft = envAnchorLeft + envChip.length + 1;

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
      <box
        style={{
          flexDirection: "row",
          flexShrink: 0,
          marginTop: ROW_GAP,
          marginBottom: ROW_GAP,
        }}
      >
        <text fg={openDropdown === "project" ? theme.accent : theme.muted}>{projectChip}</text>
        <text fg={theme.muted}> </text>
        <text fg={openDropdown === "env" ? theme.accent : theme.muted}>{envChip}</text>
        <text fg={theme.muted}> </text>
        <text fg={openDropdown === "date" ? theme.accent : theme.muted}>{`[${statsPeriod}]`}</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted}>{`Sort: ${sortLabel}`}</text>
      </box>

      {openDropdown === "project" ? (
        <Dropdown
          title="Project"
          items={projectItems}
          selected={selectedProjects}
          anchorLeft={projectAnchorLeft}
          anchorTop={anchorTop + ROW_GAP}
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
          anchorTop={anchorTop + ROW_GAP}
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
          anchorTop={anchorTop + ROW_GAP}
          showAll={false}
          onSelect={handleDateSelect}
          onClose={onDropdownClose}
        />
      ) : null}
    </>
  );
}
