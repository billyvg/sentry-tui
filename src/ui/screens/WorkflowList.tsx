/**
 * Monitors › Alerts — the automations (workflows) list.
 *
 * Not the legacy alert rules: the sidebar's Alerts item points at
 * `views/automations/list.tsx`, so this is one table over
 * `GET /organizations/{org}/workflows/` with the web's columns
 * (`automationListTable/index.tsx:146-167`):
 *
 * ```text
 * Name · Last Triggered · Actions · Projects · Monitors
 * ```
 *
 * It keeps its own state slice rather than joining `monitors.detectors`: the
 * `type:` filters that tell the seven detector screens apart mean nothing to a
 * list of workflows, and the two disagree about the row type.
 *
 * Read-only, like the rest of the app — nothing here enables, disables, or
 * edits a workflow, and Enter does nothing until there is a detail to open.
 */

import { useEffect, useMemo } from "react";

import type { Detector } from "~/api/detectors";
import {
  WORKFLOW_SORT_OPTIONS,
  actionTypeLabel,
  workflowActionTypes,
  workflowSort,
  type Workflow,
} from "~/api/workflows";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { useTheme } from "~/ui/theme";
import type { Theme } from "~/core/theme";
import { timeAgo } from "~/lib/sparkline";
import { padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { SEARCH_ROWS } from "~/ui/components/FilterBar";
import { SearchInput } from "~/ui/components/SearchInput";
import { SortBar } from "~/ui/components/SortBar";
import { useProjects } from "~/ui/hooks/useProjects";
import { useWorkflowDetectors, useWorkflows } from "~/ui/hooks/useWorkflows";
import { BOLD } from "~/ui/lib/attributes";
import type { ScreenProps } from "~/ui/screens/types";

/** The two lines of screen heading between the search box and the table. */
const HEADING_ROWS = 4;

/**
 * Narrowest a workflow name may be squeezed to before the table sheds a column
 * instead. The name is the only thing identifying a row, and the default floor
 * of eight cells lets every column "fit" while the name says nothing.
 */
const MIN_NAME_WIDTH = 24;

/** Stand-in for a cell the workflow has no value for, as the web's `EmptyCell`. */
const EMPTY = "—";

/** One workflow, with every cell already resolved to the string it draws. */
interface WorkflowRow {
  workflow: Workflow;
  id: string;
  name: string;
  /** Disabled workflows draw faded, as `variant={enabled ? 'default' : 'faded'}`. */
  enabled: boolean;
  lastTriggered: string;
  actions: string;
  projects: string;
  monitors: string;
}

/**
 * The columns, and the order they are given up in.
 *
 * Priorities run in the web's own shedding order, read backwards out of the
 * container queries in `automationListTable/index.tsx:227-274` — the last
 * column to appear is the first to go: Monitors, then Last Triggered, then
 * Actions, then Projects. The name has no priority, so it always survives.
 */
function workflowColumns(theme: Theme): ReadonlyArray<Column<WorkflowRow>> {
  return [
    {
      key: "name",
      label: "Name",
      width: "flex",
      render: (row, selected, width) => (
        <text fg={nameColor(row, selected, theme)} attributes={selected ? BOLD : 0}>
          {padText(row.name, width)}
        </text>
      ),
    },
    {
      key: "lastTriggered",
      label: "Last Triggered",
      // Exactly the header's own width: the label is the widest thing in the
      // column, and a truncated `Last Trigger…` reads as a bug.
      width: 14,
      priority: 2,
      render: (row, _selected, width) => (
        <text fg={theme.subText}>{padText(row.lastTriggered, width)}</text>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      width: 18,
      priority: 3,
      render: (row, _selected, width) => (
        <text fg={row.enabled ? theme.text : theme.subText}>{padText(row.actions, width)}</text>
      ),
    },
    {
      key: "projects",
      label: "Projects",
      width: 18,
      priority: 4,
      render: (row, _selected, width) => (
        <text fg={row.enabled ? theme.muted : theme.subText}>{padText(row.projects, width)}</text>
      ),
    },
    {
      key: "monitors",
      label: "Monitors",
      width: 11,
      priority: 1,
      render: (row, _selected, width) => (
        <text fg={row.enabled ? theme.muted : theme.subText}>{padText(row.monitors, width)}</text>
      ),
    },
  ];
}

export function WorkflowList(props: ScreenProps) {
  const theme = useTheme();
  const { client, org, state, focused, width, height, reloadToken } = props;
  const { setEntries, setStatus, setOpenDropdown, focusSearch, handleSearchBlur } = state;

  const sort = workflowSort(state.sort);
  const status = useWorkflows(client, {
    org,
    query: state.committedQuery,
    sortBy: sort,
    reloadToken,
  });

  const workflows = valueOf(status);
  const error = errorOf(status);
  const loading = status.state === "loading";
  const since = loadingSince(status);

  // A workflow carries detector *ids*; the Projects column wants the project
  // behind each, which is a detector lookup and then an id → slug mapping the
  // rest of the app already keeps.
  const detectors = useWorkflowDetectors(client, org, workflows);
  const projects = useProjects(client, org);
  const slugById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.slug);
    return map;
  }, [projects]);

  const rows = useMemo(
    () =>
      workflows?.map((workflow) => toRow(workflow, detectors.byId, detectors.loading, slugById)),
    [workflows, detectors, slugById],
  );

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({ loading, since, error: error?.message, noun: "alerts" });
  }, [loading, since, error, setStatus]);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInput
        value={state.searchQuery}
        placeholder="Search alerts by name…"
        focused={state.searchFocused}
        width={width}
        onInput={state.setSearchQuery}
        onFocus={focusSearch}
        onBlur={handleSearchBlur}
      />

      {/*
       * Both heading lines are pinned to one row and clipped: the width here
       * is the pane's, which on a narrow terminal is too little for the
       * description, and text that wraps would push the table down by a line
       * the skeleton never budgeted for.
       */}
      <box
        style={{
          flexDirection: "row",
          width,
          height: 1,
          flexShrink: 0,
          overflow: "hidden",
          paddingLeft: 1,
        }}
      >
        <text fg={theme.text} attributes={BOLD}>
          Alerts
        </text>
        <text fg={theme.muted}>{"  Automations that run when a monitor fires."}</text>
      </box>
      <SortBar
        value={sort}
        items={WORKFLOW_SORT_OPTIONS}
        summaryLabel={rows ? countLabel(rows.length) : ""}
        open={state.openDropdown === "sort"}
        width={width}
        anchorTop={SEARCH_ROWS + 1}
        onChange={state.setSort}
        onOpen={() => setOpenDropdown("sort")}
        onClose={() => setOpenDropdown(null)}
      />

      <DataTable
        rows={rows}
        columns={workflowColumns(theme)}
        width={width}
        minFlex={MIN_NAME_WIDTH}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(row) => row.id}
        loading={isInitialLoad(status)}
        error={error}
        errorTitle="Failed to load alerts"
        onRowClick={props.activateRow}
        empty={{
          title: "No alerts found.",
          // A search that matched nothing is a fact about the query; an empty
          // unfiltered list is more often an org without the new alerts and
          // monitors, which is a feature flag the client cannot read. Saying
          // both at once would be wrong in each case.
          lines: state.committedQuery
            ? [`No alert name matches "${state.committedQuery}".`]
            : [
                "Alerts are the automations that run when a monitor fires.",
                "This organization may not have the new alerts and monitors enabled.",
              ],
        }}
        layout={[height, HEADING_ROWS]}
      />
    </box>
  );
}

/** `3 alerts`, agreeing in number. */
function countLabel(count: number): string {
  return `${count} ${count === 1 ? "alert" : "alerts"}`;
}

/**
 * An enabled alert's name wears the accent, the cursor row plain text, and a
 * disabled one the faded grey the web's `variant="faded"` row draws.
 *
 * The name is the one column that never sheds, so losing its colour is the
 * only cue for "this alert is off" that survives a narrow terminal.
 */
function nameColor(row: WorkflowRow, selected: boolean, theme: Theme): string {
  if (!row.enabled) return theme.subText;
  return selected ? theme.text : theme.accent;
}

/** Resolve one workflow into the strings its row draws. */
function toRow(
  workflow: Workflow,
  detectorsById: ReadonlyMap<string, Detector>,
  detectorsLoading: boolean,
  slugById: ReadonlyMap<string, string>,
): WorkflowRow {
  const detectorIds = workflow.detectorIds ?? [];
  return {
    workflow,
    id: workflow.id,
    name: workflow.name || `Alert ${workflow.id}`,
    enabled: workflow.enabled !== false,
    lastTriggered: workflow.lastTriggered ? timeAgo(workflow.lastTriggered) : EMPTY,
    actions: actionsLabel(workflow),
    projects: projectsLabel(detectorIds, detectorsById, detectorsLoading, slugById),
    monitors: detectorIds.length === 0 ? EMPTY : monitorsLabel(detectorIds.length),
  };
}

/**
 * The Actions cell: the distinct integrations this workflow notifies.
 *
 * `AutomationActionSummary` (`automationActionSummary.tsx:22-53`) shows the one
 * action's name, or every name comma-joined behind a count badge. The terminal
 * has no badge, so the joined list is the cell and `padText` ellipsises it.
 */
function actionsLabel(workflow: Workflow): string {
  const types = workflowActionTypes(workflow);
  if (types.length === 0) return EMPTY;
  return types.map(actionTypeLabel).join(", ");
}

/**
 * The Projects cell, following `projectsCell.tsx:14-42`.
 *
 * A workflow connected to the org-wide detector (`projectId: null`) covers
 * every project, and says so instead of listing forty slugs. Otherwise it is
 * the distinct projects of its connected detectors — and while that lookup is
 * still in flight, an ellipsis, so an unresolved id doesn't read as "none".
 */
function projectsLabel(
  detectorIds: readonly string[],
  detectorsById: ReadonlyMap<string, Detector>,
  detectorsLoading: boolean,
  slugById: ReadonlyMap<string, string>,
): string {
  if (detectorIds.length === 0) return EMPTY;

  const detectors = detectorIds.map((id) => detectorsById.get(id)).filter(isDetector);
  if (detectors.length === 0) return detectorsLoading ? "…" : EMPTY;
  if (detectors.some((detector) => detector.projectId === null)) return "All Projects";

  const slugs = [
    ...new Set(
      detectors
        .map((detector) => (detector.projectId ? slugById.get(detector.projectId) : undefined))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ];
  if (slugs.length === 0) return detectorsLoading ? "…" : EMPTY;
  return slugs.join(", ");
}

function isDetector(detector: Detector | undefined): detector is Detector {
  return detector !== undefined;
}

/** `3 monitors`, agreeing in number — `tn('%s monitor', '%s monitors', n)`. */
function monitorsLabel(count: number): string {
  return `${count} ${count === 1 ? "monitor" : "monitors"}`;
}
