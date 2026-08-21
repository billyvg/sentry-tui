/**
 * Column specs for the Monitors detector table.
 *
 * Kept beside `MonitorList` rather than inside it for the reason
 * `exploreColumns.tsx` gives: a column is a renderer, and a table this wide is
 * most of a file on its own. It is also the seam the check-in timeline hangs
 * off — `monitorColumns` takes an optional visualization column and, when it
 * gets one, gives up the three middle columns to make room, exactly as the
 * web's grid does (`detectorListTable/index.tsx:390-420`, "when there is a
 * visualization, prioritize showing it over other columns").
 *
 * The row's second line is `renderDetectorDetail`, whose content comes from
 * `core/detectors.ts` so the detail view can print the same facts.
 */

import type { ReactNode } from "react";

import type { Detector } from "~/api/detectors";
import {
  DETAIL_SEPARATOR,
  detectorAssigneeLabel,
  detectorDetailParts,
  detectorTypeLabel,
} from "~/core/detectors";
import { theme } from "~/core/theme";
import { timeAgo } from "~/lib/sparkline";
import { padText } from "~/lib/text";
import type { Column } from "~/ui/components/DataTable";
import { BOLD } from "~/ui/lib/attributes";

/**
 * Cells the name column keeps before anything sheds.
 *
 * A monitor's name is the only thing identifying its row — the type and the
 * assignee beside it are shared by dozens of rows — so it holds a readable
 * width and a fixed column goes instead. `DataTable`'s eight-cell default
 * would let four fixed columns squeeze `nightly-billing-rollup` down to
 * `nigh…` while Assignee keeps sixteen cells for one name.
 */
export const MONITOR_MIN_FLEX = 22;

/** What the columns need to know about the page they are drawn on. */
export interface MonitorColumnContext {
  /**
   * Project slug by project id, for the detail line. Detectors carry a
   * `projectId`; the row wants the slug, which only the projects list knows.
   */
  projectSlugs?: ReadonlyMap<string, string>;
  /**
   * A visualization drawn in place of Last Issue, Assignee and Alerts — the
   * cron and uptime check-in timeline. Given one, the row becomes
   * `Name · Type · <visualization>`, which is what the web narrows to when a
   * timeline is present.
   */
  visualization?: Column<Detector>;
}

/**
 * A disabled detector's whole row is drawn muted, matching the web's
 * `variant={detector.enabled ? 'default' : 'faded'}`
 * (`detectorListRow.tsx:29`). Colors already at or below `muted` are left
 * alone — dimming them further would only cost the row legibility it has
 * already given up.
 */
function rowFg(detector: Detector, color: string): string {
  return detector.enabled ? color : theme.muted;
}

const NAME_COLUMN: Column<Detector> = {
  key: "name",
  label: "Name",
  width: "flex",
  render: (detector, selected, width) => (
    <text
      fg={rowFg(detector, selected ? theme.text : theme.accent)}
      attributes={selected && detector.enabled ? BOLD : 0}
    >
      {padText(detector.name, width)}
    </text>
  ),
};

const TYPE_COLUMN: Column<Detector> = {
  key: "type",
  label: "Type",
  width: 12,
  // Last of the four to go: with the timeline column present it is the only
  // thing left saying what kind of monitor the row is.
  priority: 4,
  render: (detector, _selected, width) => (
    <text fg={rowFg(detector, theme.text)}>{padText(detectorTypeLabel(detector.type), width)}</text>
  ),
};

const LAST_ISSUE_COLUMN: Column<Detector> = {
  key: "last-issue",
  label: "Last Issue",
  width: 26,
  priority: 2,
  render: (detector, _selected, width) => (
    <text fg={theme.subText}>{padText(lastIssueLabel(detector), width)}</text>
  ),
};

const ASSIGNEE_COLUMN: Column<Detector> = {
  key: "assignee",
  label: "Assignee",
  width: 16,
  priority: 3,
  render: (detector, _selected, width) => (
    <text fg={theme.subText}>{padText(detectorAssigneeLabel(detector.owner), width)}</text>
  ),
};

const ALERTS_COLUMN: Column<Detector> = {
  key: "alerts",
  label: "Alerts",
  width: 6,
  align: "right",
  priority: 1,
  render: (detector, _selected, width) => {
    const count = detector.workflowIds?.length ?? 0;
    return (
      <text fg={count > 0 ? rowFg(detector, theme.text) : theme.subText}>
        {padText(count > 0 ? String(count) : "—", width, "right")}
      </text>
    );
  },
};

/**
 * The row's columns, in the web's order and with its shed order.
 *
 * Shed order is read off the container queries in
 * `detectorListTable/index.tsx:330-380`: Alerts appears last (widest
 * breakpoint) so it goes first, then Last Issue, then Assignee, then Type.
 * The name never sheds.
 */
export function monitorColumns({ visualization }: MonitorColumnContext = {}): ReadonlyArray<
  Column<Detector>
> {
  if (visualization) return [NAME_COLUMN, TYPE_COLUMN, visualization];
  return [NAME_COLUMN, TYPE_COLUMN, LAST_ISSUE_COLUMN, ASSIGNEE_COLUMN, ALERTS_COLUMN];
}

/**
 * The row's second line: the type-dependent detail, `│`-separated.
 *
 * Indented two cells so it reads as belonging to the name above it, and
 * trimmed as one string rather than per field — a detail line that has to
 * lose something loses its tail, which is where the least identifying field
 * already sits.
 */
export function renderDetectorDetail(
  detector: Detector,
  width: number,
  { projectSlugs }: MonitorColumnContext = {},
): ReactNode {
  const projectSlug = detector.projectId
    ? (projectSlugs?.get(detector.projectId) ?? detector.latestGroup?.project?.slug)
    : undefined;
  const parts = detectorDetailParts(detector, { projectSlug });
  return (
    <text fg={theme.muted}>{padText(`  ${parts.join(DETAIL_SEPARATOR)}`, Math.max(0, width))}</text>
  );
}

/**
 * The Last Issue cell: the issue's title, and how long ago it was last seen.
 *
 * The web draws a project avatar, the title and a live `Last seen 5m` on two
 * lines (`gridCell/issueCell.tsx`). One terminal line fits the title and the
 * age, and the age goes last so the title is what survives a narrow pane.
 */
function lastIssueLabel(detector: Detector): string {
  const group = detector.latestGroup;
  if (!group) return "—";
  const title = group.title || group.shortId || group.id;
  const age = timeAgo(group.lastSeen);
  return age ? `${title} · ${age}` : title;
}
