/**
 * One monitor, in full — pushed onto the view stack by Enter on a detector row.
 *
 * The same object as the issue detail, and built from the same chrome
 * (`ui/components/DetailSections.tsx`): a scrollbox of numbered sections, each
 * foldable by the digit in its own header. What differs is the content —
 * configuration, check-in timeline, open periods, connected alerts, details.
 *
 * The configuration section is the row's second line with room to breathe, and
 * it comes from the same place: `core/detectors.ts` formats a detector's
 * type-dependent fields once, compactly for the row and labelled for here.
 *
 * Read-only. The web offers enable/disable and edit from this page; this
 * client offers neither, so no chip pretends to.
 */

import { useEffect, useMemo } from "react";

import type { SentryClient } from "~/api/client";
import { fetchDetector, type Detector, type DetectorOpenPeriod } from "~/api/detectors";
import { DEFAULT_STATS_PERIOD } from "~/api/issues";
import { actionTypeLabel, workflowActionTypes, type Workflow } from "~/api/workflows";
import { errorOf, valueOf, type AsyncStatus } from "~/core/async";
import {
  detectorAssigneeLabel,
  detectorConfigFields,
  detectorEnvironment,
  detectorTypeLabel,
} from "~/core/detectors";
import { useTheme } from "~/ui/theme";
import { timeAgo } from "~/lib/sparkline";
import { fitText } from "~/lib/text";
import { dateTimeText, elapsedText } from "~/lib/time";
import { DirectDetailStatus } from "~/ui/components/DirectDetailStatus";
import {
  BODY_INDENT,
  Divider,
  Empty,
  Field,
  Section,
  useSectionFolds,
} from "~/ui/components/DetailSections";
import type { Notice } from "~/ui/components/StatusBar";
import {
  useDetectorOpenPeriods,
  useDetectorWorkflows,
  type DetectorOpenPeriodsPage,
} from "~/ui/hooks/useDetectorDetail";
import { useDirectResource, type DirectResourceLoader } from "~/ui/hooks/useDirectResource";
import { useOrganizationMembers } from "~/ui/hooks/useOrganizationMembers";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import { issueUrlView } from "~/ui/screens/IssueFeed";
import { DetectorTimelineSection, hasDetectorTimeline } from "~/ui/screens/monitorTimelineSlot";
import type { DetailContext, ViewStackEntry } from "~/ui/screens/types";

/** The sections, in the order their headers appear. */
type SectionKey = "config" | "timeline" | "periods" | "alerts" | "details";

const SECTION_TITLES: Record<SectionKey, string> = {
  config: "Configuration",
  timeline: "Check-ins",
  periods: "Open Periods",
  alerts: "Connected Alerts",
  details: "Details",
};

/**
 * A monitor's detail, ready to push.
 *
 * No `stateKey`: this is a static detail pane, not a screen — it has no cursor
 * of its own. It captures the list's selected date window when pushed, and
 * Escape leaves that list exactly where it was, cursor and filters included.
 *
 * @param detector The row Enter was pressed on. Complete as it stands — the
 *   list endpoint returns the same serializer the detail endpoint does — so
 *   the pane paints immediately and only fetches what a row never carried.
 * @param projectSlug Its project, already resolved from `projectId` by the
 *   list, which has the mapping loaded.
 * @param statsPeriod Date window selected on the list; direct URL views use
 *   Sentry's standard default.
 */
export function monitorDetailView(
  detector: Detector,
  projectSlug?: string,
  statsPeriod = DEFAULT_STATS_PERIOD,
): ViewStackEntry {
  return {
    id: `monitor:${detector.id}`,
    sentryLocation: {
      screen: "monitors.all",
      detail: { kind: "monitor", detectorId: detector.id },
    },
    label: detector.name,
    render: (ctx) => (
      <MonitorDetail
        {...ctx}
        detector={detector}
        projectSlug={projectSlug}
        statsPeriod={statsPeriod}
      />
    ),
  };
}

const loadDetector: DirectResourceLoader<Detector> = (client, { org, id, signal }) =>
  fetchDetector(client, { org, detectorId: id, signal });

/** A monitor detail addressed by a copied URL rather than a loaded list row. */
export function monitorUrlView(detectorId: string): ViewStackEntry {
  return {
    id: `monitor:${detectorId}`,
    sentryLocation: {
      screen: "monitors.all",
      detail: { kind: "monitor", detectorId },
    },
    label: `Monitor ${detectorId}`,
    render: (ctx) => <MonitorFromUrl {...ctx} detectorId={detectorId} />,
  };
}

/** Resolve the detector record before handing it to the existing detail pane. */
function MonitorFromUrl({
  client,
  org,
  detectorId,
  reloadToken,
  width,
  height,
  updateView,
  ...ctx
}: DetailContext & { detectorId: string }) {
  const status = useDirectResource(client, {
    org,
    id: detectorId,
    reloadToken,
    load: loadDetector,
  });
  const detector = valueOf(status);

  useEffect(() => {
    if (detector) updateView(`monitor:${detectorId}`, { label: detector.name });
  }, [detector, detectorId, updateView]);

  if (!detector) {
    return <DirectDetailStatus status={status} noun="monitor" width={width} height={height} />;
  }
  return (
    <MonitorDetail
      {...ctx}
      client={client}
      org={org}
      detector={detector}
      projectSlug={detector.latestGroup?.project?.slug}
      reloadToken={reloadToken}
      width={width}
      height={height}
      updateView={updateView}
    />
  );
}

interface MonitorDetailProps extends DetailContext {
  detector: Detector;
  projectSlug?: string;
  /** Window inherited from the monitor list's date filter. */
  statsPeriod?: string;
}

export function MonitorDetail({
  client,
  org,
  detector,
  projectSlug,
  statsPeriod = DEFAULT_STATS_PERIOD,
  width,
  height,
  focused,
  reloadToken,
  notify,
  pushView,
  registerActions,
}: MonitorDetailProps) {
  const theme = useTheme();
  const latestIssueId = detector.latestGroup?.id;
  useScreenActions(registerActions, {
    openDetail: latestIssueId ? () => pushView(issueUrlView(latestIssueId)) : undefined,
  });
  const periods = useDetectorOpenPeriods(client, {
    org,
    detectorId: detector.id,
    statsPeriod,
    reloadToken,
  });
  const workflows = useDetectorWorkflows(client, { org, detectorId: detector.id, reloadToken });

  const inner = Math.max(20, width - 2);

  // Whether there is a check-in timeline to show is the slot's answer, and it
  // has to be known before the sections are numbered — see
  // `monitorTimelineSlot.tsx`.
  const showTimeline = hasDetectorTimeline(detector);

  const order = useMemo(
    (): SectionKey[] => [
      "config",
      ...(showTimeline ? (["timeline"] as const) : []),
      "periods",
      "alerts",
      "details",
    ],
    [showTimeline],
  );
  const { collapsed, toggle } = useSectionFolds(order, focused);

  const periodPage = valueOf(periods);
  const workflowRows = valueOf(workflows);

  const counts: Partial<Record<SectionKey, number | string | undefined>> = {
    config: undefined,
    periods: openPeriodsCount(periodPage),
    alerts: workflowRows?.length,
  };

  return (
    /*
     * No `flexDirection`: a scrollbox lays its own root out as a row, and
     * setting `column` here stacks the scrollbar under the viewport — see the
     * same comment in `IssueDetail`.
     */
    <scrollbox
      focused={focused}
      verticalScrollbarOptions={{
        showArrows: false,
        trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
      }}
      style={{ width, height, paddingLeft: 1 }}
    >
      <MonitorHeader detector={detector} projectSlug={projectSlug} width={inner} />

      {order.map((key, index) => (
        <Section
          key={key}
          index={index + 1}
          title={SECTION_TITLES[key]}
          count={counts[key]}
          collapsed={collapsed.has(key)}
          width={inner}
          onToggle={() => toggle(key)}
        >
          <SectionBody
            sectionKey={key}
            detector={detector}
            width={inner}
            client={client}
            org={org}
            reloadToken={reloadToken}
            notify={notify}
            statsPeriod={statsPeriod}
            periods={periods}
            workflows={workflows}
          />
        </Section>
      ))}
    </scrollbox>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function MonitorHeader({
  detector,
  projectSlug,
  width,
}: {
  detector: Detector;
  projectSlug?: string;
  width: number;
}) {
  const theme = useTheme();
  // The bar carries the enabled state in color, the way the issue header's
  // carries the level — so the word beneath it is a label, not the only signal.
  const bar = detector.enabled ? theme.accent : theme.muted;
  const titleWidth = Math.max(12, width - 2);

  return (
    <box style={{ flexDirection: "column", width }}>
      <box style={{ flexDirection: "row", width }}>
        <text fg={bar}>{"┃ "}</text>
        <text fg={theme.text} attributes={BOLD}>
          {fitText(detector.name, titleWidth)}
        </text>
      </box>

      <box style={{ flexDirection: "row", width }}>
        <text fg={bar}>{"┃ "}</text>
        <text fg={theme.muted}>
          {fitText(detector.description || "(no description)", titleWidth)}
        </text>
      </box>

      {/* What the monitor currently *is*. Never pressable — nothing here writes. */}
      <box style={{ flexDirection: "row", width, paddingTop: 1 }}>
        <text>{BODY_INDENT}</text>
        <text fg={detector.enabled ? theme.success : theme.muted}>
          {detector.enabled ? "enabled" : "disabled"}
        </text>
        <Divider />
        <text fg={theme.muted}>{detectorTypeLabel(detector.type)}</text>
        {projectSlug ? (
          <>
            <Divider />
            <text fg={theme.muted}>{projectSlug}</text>
          </>
        ) : null}
        <Divider />
        <text fg={theme.muted}>
          {detector.owner ? detectorAssigneeLabel(detector.owner) : "unassigned"}
        </text>
        <Divider />
        <text fg={theme.muted}>{lastTriggeredLabel(detector)}</text>
      </box>

      <text fg={theme.border}>{"─".repeat(width)}</text>
    </box>
  );
}

/**
 * When this monitor last did something.
 *
 * `lastTriggered` is not on the wire for a *list* row — the serializer omits
 * the key entirely, verified against real cron monitors that fire hourly — and
 * a list row is what this pane is opened from. So the latest issue's
 * `lastSeen` is the fallback, and "never triggered" is claimed only when
 * neither exists: a pane that says "never triggered" above a section listing
 * twenty open periods is worse than one that says nothing.
 */
function lastTriggeredLabel(detector: Detector): string {
  const triggered = detector.lastTriggered ? timeAgo(detector.lastTriggered) : "";
  if (triggered) return `last triggered ${triggered} ago`;
  const fired = timeAgo(detector.latestGroup?.lastSeen);
  return fired ? `last issue ${fired} ago` : "never triggered";
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SectionBody({
  sectionKey,
  detector,
  width,
  client,
  org,
  reloadToken,
  notify,
  statsPeriod,
  periods,
  workflows,
}: {
  sectionKey: SectionKey;
  detector: Detector;
  width: number;
  client: SentryClient | null;
  org: string;
  reloadToken: number;
  notify: (notice: Notice) => void;
  statsPeriod: string;
  periods: AsyncStatus<DetectorOpenPeriodsPage>;
  workflows: AsyncStatus<Workflow[]>;
}) {
  switch (sectionKey) {
    case "config": {
      const fields = detectorConfigFields(detector);
      if (fields.length === 0) {
        return detector.type === "error" ? (
          <Empty>
            An error monitor has no settings — every error in its project opens an issue.
          </Empty>
        ) : (
          <Empty>No configuration was returned for this monitor.</Empty>
        );
      }
      return (
        <box style={{ flexDirection: "column", width }}>
          {fields.map((field) => (
            <Field key={field.label} name={field.label} value={field.value} width={width} />
          ))}
        </box>
      );
    }

    case "timeline":
      return (
        <DetectorTimelineSection
          detector={detector}
          width={width}
          client={client}
          org={org}
          reloadToken={reloadToken}
          notify={notify}
        />
      );

    case "periods":
      return <OpenPeriods status={periods} statsPeriod={statsPeriod} width={width} />;

    case "alerts":
      return <ConnectedAlerts status={workflows} width={width} />;

    case "details":
      return <Details detector={detector} width={width} client={client} org={org} />;
  }
}

/**
 * When the monitor's issue was open, most recent first.
 *
 * The endpoint answers for the detector's *latest* issue inside the inherited
 * date window. Its cursor and `X-Hits` total are kept so the heading and
 * summary distinguish a complete result from the first twenty rows.
 */
function OpenPeriods({
  status,
  statsPeriod,
  width,
}: {
  status: AsyncStatus<DetectorOpenPeriodsPage>;
  statsPeriod: string;
  width: number;
}) {
  const page = valueOf(status);
  const error = errorOf(status);

  if (error) return <Empty>{`Failed to load open periods: ${error.message}`}</Empty>;
  if (!page) return <Empty>Loading open periods…</Empty>;
  if (page.rows.length === 0) return <Empty>{`No open periods in the last ${statsPeriod}.`}</Empty>;

  return (
    <box style={{ flexDirection: "column", width }}>
      <Empty>{openPeriodsSummary(page, statsPeriod)}</Empty>
      {page.rows.map((period) => (
        <OpenPeriodRow key={period.id} period={period} width={width} />
      ))}
    </box>
  );
}

/** Count shown in the section heading without presenting a capped page as a total. */
function openPeriodsCount(page: DetectorOpenPeriodsPage | undefined): number | string | undefined {
  if (!page) return undefined;
  if (page.totalCount !== undefined && page.totalCount > page.rows.length) {
    return `${page.rows.length} of ${page.totalCount}`;
  }
  return page.nextCursor === null ? page.rows.length : `${page.rows.length}+`;
}

/** Explain the selected window and exactly what the capped response omitted when possible. */
function openPeriodsSummary(page: DetectorOpenPeriodsPage, statsPeriod: string): string {
  const shown = page.rows.length;
  const hidden = page.totalCount === undefined ? undefined : Math.max(0, page.totalCount - shown);
  if (hidden && hidden > 0) {
    return `Newest ${shown} in the last ${statsPeriod}; ${hidden} older not shown.`;
  }
  if (page.nextCursor !== null) {
    return `Newest ${shown} in the last ${statsPeriod}; older periods not shown.`;
  }
  return `All ${shown} in the last ${statsPeriod}, newest first.`;
}

/** `#142  2026-08-20 09:00 → ongoing   4h`, in UTC like every other timestamp. */
function OpenPeriodRow({ period, width }: { period: DetectorOpenPeriod; width: number }) {
  const theme = useTheme();
  const open = period.isOpen || !period.end;
  return (
    <box style={{ flexDirection: "row", width }}>
      <text fg={theme.subText}>{`${BODY_INDENT}#${period.id}  `}</text>
      <text fg={theme.text}>{dateTimeText(period.start)}</text>
      <text fg={theme.subText}>{" → "}</text>
      <text fg={open ? theme.warning : theme.text}>
        {open ? "ongoing" : dateTimeText(period.end)}
      </text>
      <text fg={theme.muted}>{`  ${elapsedText(period.start, period.end)}`}</text>
    </box>
  );
}

/**
 * The alerts wired to this monitor.
 *
 * Sentry calls them automations now and the sidebar calls them Alerts; this
 * says Alerts, matching the nav item they are listed under.
 */
function ConnectedAlerts({ status, width }: { status: AsyncStatus<Workflow[]>; width: number }) {
  const rows = valueOf(status);
  const error = errorOf(status);

  if (error) return <Empty>{`Failed to load alerts: ${error.message}`}</Empty>;
  if (!rows) return <Empty>Loading alerts…</Empty>;
  if (rows.length === 0) return <Empty>No alerts are connected to this monitor.</Empty>;

  return (
    <box style={{ flexDirection: "column", width }}>
      {rows.map((workflow) => (
        <AlertRow key={workflow.id} workflow={workflow} width={width} />
      ))}
    </box>
  );
}

function AlertRow({ workflow, width }: { workflow: Workflow; width: number }) {
  const theme = useTheme();
  const actions = workflowActionTypes(workflow).map(actionTypeLabel).join(", ");
  const triggered = workflow.lastTriggered ? `${timeAgo(workflow.lastTriggered)} ago` : "never";
  const enabled = workflow.enabled !== false;

  return (
    <box style={{ flexDirection: "column", width }}>
      <box style={{ flexDirection: "row", width }}>
        <text fg={enabled ? theme.text : theme.muted}>
          {`${BODY_INDENT}${fitText(workflow.name || `Alert ${workflow.id}`, Math.max(8, width - 4))}`}
        </text>
      </box>
      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.subText}>{`${BODY_INDENT}  `}</text>
        <text fg={enabled ? theme.muted : theme.subText}>{enabled ? "enabled" : "disabled"}</text>
        {actions ? (
          <>
            <Divider />
            <text fg={theme.muted}>{actions}</text>
          </>
        ) : null}
        <Divider />
        <text fg={theme.muted}>{`last fired ${triggered}`}</text>
      </box>
    </box>
  );
}

/** The facts that are true of every monitor whatever its type. */
function Details({
  detector,
  width,
  client,
  org,
}: {
  detector: Detector;
  width: number;
  client: SentryClient | null;
  org: string;
}) {
  const environment = detectorEnvironment(detector);
  const group = detector.latestGroup;
  const members = useOrganizationMembers(client, org, Boolean(detector.createdBy));
  const createdBy = detector.createdBy
    ? members.state === "ready"
      ? (members.value.get(detector.createdBy)?.user?.name ?? "Deactivated user")
      : members.state === "error"
        ? "Unavailable"
        : "Loading…"
    : "Sentry";

  return (
    <box style={{ flexDirection: "column", width }}>
      <Field name="Monitor ID" value={detector.id} width={width} />
      {environment ? <Field name="Environment" value={environment} width={width} /> : null}
      {group ? (
        <Field
          name="Last issue"
          value={lastIssueValue(group.title, group.shortId, group.lastSeen)}
          width={width}
        />
      ) : null}
      <Field name="Created" value={dateTimeText(detector.dateCreated)} width={width} />
      <Field name="Created by" value={createdBy} width={width} />
      <Field name="Last modified" value={dateTimeText(detector.dateUpdated)} width={width} />
    </box>
  );
}

/** `SENTRY-5T5Y · TypeError: … · 4h ago`, as much of it as the row can hold. */
function lastIssueValue(
  title: string | undefined,
  shortId: string | undefined,
  lastSeen: string | undefined,
): string {
  const age = timeAgo(lastSeen);
  return [shortId, title, age ? `${age} ago` : undefined].filter(Boolean).join(" · ");
}
