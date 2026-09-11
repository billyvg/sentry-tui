/**
 * Terminal renderers for the Seer markdown embeds that reference one thing.
 *
 * The web app has a component per embed under
 * `sentry/static/app/components/seer/markdown/embeds/components`; this is the
 * same set, drawn as cards. Where the terminal already has the fetch behind a
 * screen — a monitor, a replay, a saved query — the card goes and gets the
 * real resource rather than reprinting the handful of fields the agent chose
 * to put in the tag. Where it does not, the card says what the reference is
 * and stops, which is still strictly better than the raw Markdoc leaking into
 * the transcript.
 *
 * The query-shaped embeds (`spansQuery` and friends) live in
 * `SeerQueryEmbeds` — they share a preview shape with each other rather than
 * with anything here.
 */

import { useMemo } from "react";

import { getDashboard, type DashboardDetails } from "~/api/dashboards";
import { widgetRenderKind } from "~/api/dashboardWidgets";
import { fetchDetector, type Detector } from "~/api/detectors";
import { fetchGroupSearchView, type GroupSearchView } from "~/api/groupSearchViews";
import { DEFAULT_RELEASE_PERIOD, type Release } from "~/api/releases";
import {
  fetchReplay,
  formatAgent,
  formatReplayDuration,
  shortReplayId,
  type Replay,
} from "~/api/replays";
import { fetchSavedQuery, type SavedQuery, type SavedQuerySource } from "~/api/savedQueries";
import {
  actionTypeLabel,
  fetchWorkflow,
  workflowActionTypes,
  type Workflow,
} from "~/api/workflows";
import { errorOf, valueOf, type AsyncStatus } from "~/core/async";
import { detectorConfigFields, detectorTypeLabel } from "~/core/detectors";
import {
  embedText,
  embedTexts,
  inlineSeerEmbed,
  isDetectorAlertKind,
  relativeTime,
  seerAlertKind,
  SEER_ALERT_LABELS,
  type SeerEmbedLevel,
} from "~/core/seerEmbeds";
import { workflowConditionLines, workflowThrottleText } from "~/core/workflows";
import { sparkline } from "~/lib/sparkline";
import { fitText } from "~/lib/text";
import { dateTimeText } from "~/lib/time";
import { BODY_INDENT } from "~/ui/components/DetailSections";
import { TraceEmbed, ProfileEmbed } from "~/ui/components/SeerPerformanceEmbeds";
import { SeerIssueEmbed } from "~/ui/components/SeerIssueEmbed";
import {
  CARD_CHROME,
  type SeerEmbedProps,
  SeerEmbedCard,
  SeerEmbedFields,
  SeerEmbedStatus,
  SeerEmbedText,
} from "~/ui/components/SeerEmbedCard";
import { WidgetCard } from "~/ui/components/WidgetCard";
import { useWidgetData, widgetKey } from "~/ui/hooks/useDashboardDetail";
import { useDetectorWorkflows } from "~/ui/hooks/useDetectorDetail";
import { useDirectResource, type DirectResourceLoader } from "~/ui/hooks/useDirectResource";
import { useReleases } from "~/ui/hooks/useReleases";
import { BOLD, DIM } from "~/ui/lib/attributes";
import { orderWidgets, widgetCardHeight } from "~/ui/lib/widgetStack";
import { useTheme } from "~/ui/theme";
import { SeerQueryEmbed } from "~/ui/components/SeerQueryEmbeds";

/**
 * Draw one block-level embed.
 *
 * A switch rather than a registry map because each arm renders a different
 * component with its own hooks — the web's `SeerEmbedRegistry` exists to let
 * embeds be registered from anywhere, and nothing in the terminal registers
 * one from outside this file.
 */
export function SeerBlockEmbed({
  name,
  data,
  width,
  client,
  org,
}: SeerEmbedProps & { name: string }) {
  switch (name) {
    case "issue":
      return (
        <SeerIssueEmbed
          client={client}
          org={org}
          ids={[embedText(data["id"]) ?? ""]}
          width={width}
        />
      );
    case "issues":
      return (
        <SeerIssueEmbed client={client} org={org} ids={embedTexts(data["ids"])} width={width} />
      );
    case "dsn":
      return <DsnEmbed data={data} width={width} client={client} org={org} />;
    case "chart":
      return <ChartEmbed data={data} width={width} client={client} org={org} />;
    case "autofix":
      return <AutofixEmbed data={data} width={width} client={client} org={org} />;
    case "autofixRef":
      return <AutofixRefEmbed data={data} width={width} client={client} org={org} />;
    case "agentWriteApproval":
      return <AgentWriteApprovalEmbed data={data} width={width} client={client} org={org} />;
    case "trace":
      return <TraceEmbed data={data} width={width} client={client} org={org} />;
    case "profile":
      return <ProfileEmbed data={data} width={width} client={client} org={org} />;
    case "alert":
      return <AlertEmbed data={data} width={width} client={client} org={org} />;
    case "dashboard":
      return <DashboardEmbed data={data} width={width} client={client} org={org} />;
    case "monitor":
      return <MonitorEmbed data={data} width={width} client={client} org={org} />;
    case "release":
      return <ReleaseEmbed data={data} width={width} client={client} org={org} />;
    case "replay":
      return <ReplayEmbed data={data} width={width} client={client} org={org} />;
    case "savedQuery":
      return <SavedQueryEmbed data={data} width={width} client={client} org={org} />;
    case "savedIssueView":
      return <SavedIssueViewEmbed data={data} width={width} client={client} org={org} />;
    default:
      return <SeerQueryEmbed name={name} data={data} width={width} client={client} org={org} />;
  }
}

// ---------------------------------------------------------------------------
// Payload-only cards
// ---------------------------------------------------------------------------

/** A copyable DSN, on its own line so a terminal selection catches all of it. */
function DsnEmbed({ data, width }: SeerEmbedProps) {
  const theme = useTheme();
  return (
    <SeerEmbedCard label="DSN" width={width}>
      <text fg={theme.accent}>{embedText(data["value"]) ?? "DSN unavailable"}</text>
    </SeerEmbedCard>
  );
}

/**
 * Seer's bounded chart payload, as one sparkline per series.
 *
 * The x axis is dropped: at a terminal's horizontal resolution a time axis and
 * a category axis reduce to the same row of blocks, and the label under each
 * series is what says which is which.
 */
function ChartEmbed({ data, width }: SeerEmbedProps) {
  const theme = useTheme();
  const series = Array.isArray(data["series"]) ? data["series"].slice(0, 5) : [];
  const chartWidth = Math.max(8, Math.min(50, width - 4));

  return (
    <SeerEmbedCard
      label="Chart"
      title={embedText(data["title"])}
      subtitle={embedText(data["subtitle"])}
      width={width}
    >
      {series.map((entry, index) => {
        const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        const points = Array.isArray(record["data"])
          ? record["data"].flatMap((point, pointIndex) => {
              if (!point || typeof point !== "object") return [];
              const y = Number((point as Record<string, unknown>)["y"]);
              return Number.isFinite(y) ? ([[pointIndex, y]] as const) : [];
            })
          : [];
        const label =
          embedText(record["label"]) ?? embedText(record["name"]) ?? `Series ${index + 1}`;
        return (
          <box key={`${label}-${index}`} style={{ flexDirection: "column" }}>
            <text fg={index === 0 ? theme.accent : theme.muted}>
              {sparkline(points, chartWidth, { floor: true })}
            </text>
            <text fg={theme.muted} attributes={DIM}>
              {label}
            </text>
          </box>
        );
      })}
    </SeerEmbedCard>
  );
}

/** Title case for the step identifiers the autofix API reports. */
function stepLabel(data: Record<string, unknown>): string {
  return (embedText(data["step"]) ?? "result").replace(/_/g, " ");
}

/** One finished Autofix step, with the write-up the agent already has. */
function AutofixEmbed({ data, width }: SeerEmbedProps) {
  return (
    <SeerEmbedCard
      label="Autofix"
      title={stepLabel(data)}
      subtitle={embedText(data["shortId"])}
      width={width}
      tone="accent"
    >
      <SeerEmbedText width={width - CARD_CHROME}>
        {embedText(data["result"]) ?? "No result returned."}
      </SeerEmbedText>
    </SeerEmbedCard>
  );
}

/**
 * A *live* Autofix step.
 *
 * The web embed polls the run and grows buttons to continue or retry it. The
 * terminal has its own Autofix surface on the issue detail — reached by a key
 * rather than by a button inside a transcript — so this card names the run and
 * points at it instead of opening a second polling path into the same API.
 */
function AutofixRefEmbed({ data, width }: SeerEmbedProps) {
  const theme = useTheme();
  const shortId = embedText(data["shortId"]);
  return (
    <SeerEmbedCard
      label="Autofix"
      title={stepLabel(data)}
      subtitle={shortId}
      width={width}
      tone="accent"
    >
      <SeerEmbedFields
        fields={[
          ["Run", embedText(data["runId"])],
          ["Issue", shortId ?? embedText(data["id"])],
        ]}
        width={width - CARD_CHROME}
      />
      <text fg={theme.muted}>
        {shortId ? `  Open ${shortId} to follow this run.` : "  Open the issue to follow this run."}
      </text>
    </SeerEmbedCard>
  );
}

/** The scopes Seer is asking for before it writes anything. */
function AgentWriteApprovalEmbed({ data, width }: SeerEmbedProps) {
  const theme = useTheme();
  const status = embedText(data["status"]) ?? "pending";
  const scopes = embedTexts(data["requiredScopes"]);
  const tone = status === "rejected" ? "danger" : status === "approved" ? "normal" : "warning";

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        border: true,
        borderColor:
          tone === "danger" ? theme.danger : tone === "warning" ? theme.warning : theme.border,
        paddingLeft: 1,
        flexShrink: 0,
      }}
    >
      <text
        fg={
          status === "approved"
            ? theme.success
            : status === "rejected"
              ? theme.danger
              : theme.warning
        }
        attributes={BOLD}
      >
        {status === "pending" ? "Allow Seer to make changes?" : `Access ${status}`}
      </text>
      {scopes.map((scope) => (
        <text key={scope} fg={theme.muted}>{`  ${scope}`}</text>
      ))}
      {/*
        This card is the only surface drawing the approval keys when the org
        has the embeds feature — `SeerExplorer` suppresses its own pending
        card in exactly that case, so without this the keys go unannounced.
      */}
      {status === "pending" ? <text fg={theme.accent}>[y] approve · [x] reject</text> : null}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Fetching cards
// ---------------------------------------------------------------------------

const loadDashboard: DirectResourceLoader<DashboardDetails> = (client, { org, id, signal }) =>
  getDashboard(client, { org, id, signal });

/** Widgets a dashboard embed draws before it stops and says how many are left. */
const PREVIEW_WIDGETS = 3;

/**
 * A dashboard, previewed by drawing its widgets.
 *
 * The same `WidgetCard` the dashboard screen draws, fed by the same
 * `useWidgetData` — a widget is its numbers, and a list of widget titles is
 * the one thing the web embed's schema explicitly tells the agent not to write
 * out as text.
 *
 * Two things differ from the screen, both because a transcript is not a pane:
 * there is no cursor, so no card is ever selected, and there is no scrollbox,
 * so the preview stops after a few widgets rather than running to the bottom
 * of a thirty-widget dashboard. `upto` is exactly what is drawn, which is also
 * what keeps the embed from firing thirty requests to render three cards.
 */
function DashboardEmbed({ data, width, client, org }: SeerEmbedProps) {
  const theme = useTheme();
  const id = embedText(data["id"]) ?? "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadDashboard });
  const dashboard = valueOf(status);

  const widgets = useMemo(() => orderWidgets(dashboard?.widgets ?? []), [dashboard]);
  const shown = useMemo(() => widgets.slice(0, PREVIEW_WIDGETS), [widgets]);
  const cardWidth = Math.max(20, width - CARD_CHROME);

  const widgetData = useWidgetData(client, {
    org,
    dashboardId: dashboard?.id ?? "",
    widgets: shown,
    upto: shown.length,
  });

  return (
    <SeerEmbedCard
      label="Dashboard"
      title={dashboard?.title ?? embedText(data["title"]) ?? id}
      subtitle={dashboard ? `${widgets.length} widgets` : undefined}
      width={width}
    >
      <SeerEmbedStatus status={status} noun="dashboard" empty={Boolean(dashboard) && !widgets[0]} />
      {shown.map((widget, index) => (
        <WidgetCard
          key={widgetKey(widget, index)}
          widget={widget}
          kind={widgetRenderKind(widget.displayType)}
          status={widgetData.get(widgetKey(widget, index))}
          width={cardWidth}
          // `widgetCardHeight` includes the gap the stacked screen leaves
          // below each card; the last one here sits against the card's own
          // border, so the gap comes off every card and the box closes tight.
          height={widgetCardHeight(widget, widgetRenderKind(widget.displayType)) - 1}
          selected={false}
        />
      ))}
      {widgets.length > shown.length ? (
        <text fg={theme.subText}>
          {`  …and ${widgets.length - shown.length} more on the dashboard`}
        </text>
      ) : null}
    </SeerEmbedCard>
  );
}

const loadDetector: DirectResourceLoader<Detector> = (client, { org, id, signal }) =>
  fetchDetector(client, { org, detectorId: id, signal });

/**
 * A detector, with the type-specific configuration the web embed shows.
 *
 * The rules are what a monitor *is* — a cron's schedule, a metric's threshold —
 * so they come from `detectorConfigFields`, the same projection the detail
 * pane draws, rather than from a hand-picked set of fields here. The three
 * rows after them are the state that config does not carry.
 *
 * Two embeds land here. `{% monitor %}` addresses a detector directly, and
 * `{% alert %}` addresses one for three of its four kinds — metric, uptime and
 * cron alerts are all detectors under the workflow engine, which is the same
 * split the web makes when `alertBlock.tsx` hands those three to the very
 * components the monitor embed draws with. The alert card additionally lists
 * the automations wired to the detector, which is the "configured actions"
 * half of what its block promises; the monitor card does not, and skips that
 * request rather than paying for a section it will not draw.
 */
function DetectorEmbedCard({
  data,
  width,
  client,
  org,
  label,
  fallbackSubtitle,
  withAlerts = false,
}: SeerEmbedProps & {
  label: string;
  /** What the subtitle says before the detector arrives, if anything. */
  fallbackSubtitle?: string;
  withAlerts?: boolean;
}) {
  const id = embedText(data["id"]) ?? "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadDetector });
  const detector = valueOf(status);
  const workflows = useDetectorWorkflows(client, {
    org,
    detectorId: withAlerts ? id : "",
  });
  const inner = width - CARD_CHROME;

  return (
    <SeerEmbedCard
      label={label}
      title={detector?.name ?? embedText(data["name"]) ?? id}
      subtitle={
        detector
          ? `${detectorTypeLabel(detector.type)} monitor${detector.enabled ? "" : " · disabled"}`
          : fallbackSubtitle
      }
      width={width}
    >
      <SeerEmbedStatus status={status} noun="monitor" />
      {detector ? (
        <>
          <SeerEmbedFields
            fields={[
              ...detectorConfigFields(detector).map((entry) => [entry.label, entry.value] as const),
              ["Owner", detector.owner?.name ?? undefined],
              [
                "Last triggered",
                detector.lastTriggered ? relativeTime(detector.lastTriggered) : undefined,
              ],
              ["Last issue", detector.latestGroup?.shortId ?? undefined],
            ]}
            width={inner}
          />
          {withAlerts ? <ConnectedAlerts status={workflows} width={inner} /> : null}
        </>
      ) : null}
    </SeerEmbedCard>
  );
}

/**
 * The alerts wired to a monitor, and where each one notifies.
 *
 * The web's alert block lists three and no more (`limit: 3` in
 * `alertTypes/detector.tsx`); a transcript card has even less room than that
 * drawer, so the same three, and a count for the rest.
 */
function ConnectedAlerts({ status, width }: { status: AsyncStatus<Workflow[]>; width: number }) {
  const theme = useTheme();
  const rows = valueOf(status);
  const error = errorOf(status);

  return (
    <>
      <text fg={theme.subText} attributes={BOLD}>
        {`${BODY_INDENT}Alerts`}
      </text>
      {error ? (
        <text fg={theme.danger}>{`${BODY_INDENT}  Could not load alerts: ${error.message}`}</text>
      ) : null}
      {!error && !rows ? <text fg={theme.muted}>{`${BODY_INDENT}  Loading alerts…`}</text> : null}
      {rows?.length === 0 ? (
        <text fg={theme.subText}>{`${BODY_INDENT}  No alerts are connected.`}</text>
      ) : null}
      {(rows ?? []).slice(0, CONNECTED_ALERT_LIMIT).map((workflow) => {
        const actions = workflowActionTypes(workflow).map(actionTypeLabel).join(", ");
        const name = workflow.name || `Alert ${workflow.id}`;
        return (
          <text key={workflow.id} fg={theme.text}>
            {`${BODY_INDENT}  ${fitText(actions ? `${name} — ${actions}` : name, Math.max(8, width - 4))}`}
          </text>
        );
      })}
      {rows && rows.length > CONNECTED_ALERT_LIMIT ? (
        <text fg={theme.subText}>
          {`${BODY_INDENT}  …and ${rows.length - CONNECTED_ALERT_LIMIT} more`}
        </text>
      ) : null}
    </>
  );
}

/** Connected alerts drawn on a detector card, matching the web's own cap. */
const CONNECTED_ALERT_LIMIT = 3;

const loadWorkflow: DirectResourceLoader<Workflow> = (client, { org, id, signal }) =>
  fetchWorkflow(client, { org, workflowId: id, signal });

/**
 * An issue alert, with the conditions and actions that make it fire.
 *
 * The one alert kind the workflow engine models as an automation rather than a
 * detector, so it is the one that comes from `workflows/` — everything else
 * `{% alert %}` can name is a monitor and goes through `DetectorEmbedCard`.
 */
function IssueAlertEmbed({ data, width, client, org }: SeerEmbedProps) {
  const theme = useTheme();
  const id = embedText(data["id"]) ?? "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadWorkflow });
  const workflow = valueOf(status);
  const inner = width - CARD_CHROME;

  return (
    <SeerEmbedCard
      label="Alert"
      title={workflow?.name ?? embedText(data["name"]) ?? id}
      subtitle={
        workflow
          ? `Issue alert${workflow.enabled === false ? " · disabled" : ""}`
          : SEER_ALERT_LABELS.issue
      }
      width={width}
    >
      <SeerEmbedStatus status={status} noun="alert" />
      {workflow ? (
        <>
          <SeerEmbedFields
            fields={[
              ["Environment", workflow.environment || "All environments"],
              ["Throttling", workflowThrottleText(workflow)],
              [
                "Last triggered",
                workflow.lastTriggered ? relativeTime(workflow.lastTriggered) : "Never",
              ],
              ["Monitors", countText(workflow.detectorIds?.length ?? 0, "monitor")],
            ]}
            width={inner}
          />
          {workflowConditionLines(workflow).map((line, index) => (
            <text
              key={index}
              fg={line.heading ? theme.subText : theme.text}
              attributes={line.heading ? BOLD : undefined}
            >
              {line.heading
                ? `${BODY_INDENT}${fitText(line.text, Math.max(8, inner - 2))}`
                : `${BODY_INDENT}  ${fitText(line.text, Math.max(8, inner - 4))}`}
            </text>
          ))}
        </>
      ) : null}
    </SeerEmbedCard>
  );
}

/** `3 monitors`, `1 monitor`, `No monitors` — a count that reads as a phrase. */
function countText(count: number, noun: string): string {
  if (count === 0) return `No ${noun}s`;
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/**
 * An alert, drawn as whatever Sentry calls it now.
 *
 * `alert` is Seer's name for the tag, and its `kind` is the only axis that
 * changes how the thing behind it is fetched: `issue` is an automation, and
 * the other three are detectors — which the product renamed to monitors and
 * this client lists under `Monitors`. So the dispatch is the web's, and the
 * labels are the sidebar's.
 */
function AlertEmbed(props: SeerEmbedProps) {
  const kind = seerAlertKind(props.data["kind"]);
  return isDetectorAlertKind(kind) ? (
    <DetectorEmbedCard
      {...props}
      label="Monitor"
      fallbackSubtitle={kind ? SEER_ALERT_LABELS[kind] : undefined}
      withAlerts
    />
  ) : (
    <IssueAlertEmbed {...props} />
  );
}

/** A monitor, addressed by the detector id the `monitor` schema asks for. */
function MonitorEmbed(props: SeerEmbedProps) {
  return <DetectorEmbedCard {...props} label="Monitor" />;
}

/**
 * A release.
 *
 * Fetched through the list endpoint filtered to one version rather than the
 * per-release detail endpoint: the list serializer already carries the commit,
 * author and deploy counts this card shows, and it is the request the releases
 * screen already knows how to make.
 */
function ReleaseEmbed({ data, width, client, org }: SeerEmbedProps) {
  const version = embedText(data["version"]) ?? "";
  const projectId = embedText(data["projectId"]);
  const state = useReleases(version ? client : null, {
    org,
    query: version,
    statsPeriod: DEFAULT_RELEASE_PERIOD,
    project: projectId ? [projectId] : undefined,
  });
  const releases = valueOf(state.releases) ?? [];
  const release: Release | undefined =
    releases.find((entry) => entry.version === version) ?? releases[0];

  return (
    <SeerEmbedCard
      label="Release"
      title={release?.shortVersion ?? version}
      subtitle={release ? dateTimeText(release.dateReleased ?? release.dateCreated) : undefined}
      width={width}
    >
      <SeerEmbedStatus
        status={state.releases}
        noun="release"
        empty={state.releases.state === "ready" && !release}
      />
      {release ? (
        <SeerEmbedFields
          fields={[
            ["Package", release.package],
            ["Commits", String(release.commitCount)],
            ["Authors", String(release.authorCount)],
            ["Projects", release.projects.map((project) => project.slug).join(", ") || undefined],
            ["Last deploy", release.lastDeploy?.environment],
          ]}
          width={width - CARD_CHROME}
        />
      ) : null}
    </SeerEmbedCard>
  );
}

const loadReplay: DirectResourceLoader<Replay> = (client, { org, id, signal }) =>
  fetchReplay(client, { org, replayId: id, signal });

/** One replay, with the counts the replay list shows for it. */
function ReplayEmbed({ data, width, client, org }: SeerEmbedProps) {
  const id = embedText(data["id"]) ?? "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadReplay });
  const replay = valueOf(status);
  const eventTimestamp = embedText(data["eventTimestamp"]);

  return (
    <SeerEmbedCard
      label="Replay"
      title={replay?.user.displayName ?? (id ? shortReplayId(id) : undefined)}
      subtitle={replay ? formatReplayDuration(replay.durationSec) : undefined}
      width={width}
    >
      <SeerEmbedStatus status={status} noun="replay" />
      {replay ? (
        <SeerEmbedFields
          fields={[
            ["Started", dateTimeText(replay.startedAt)],
            ["Browser", formatAgent(replay.browser)],
            ["OS", formatAgent(replay.os)],
            ["Errors", replay.countErrors === undefined ? undefined : String(replay.countErrors)],
            [
              "Rage clicks",
              replay.countRageClicks === undefined ? undefined : String(replay.countRageClicks),
            ],
            ["Around", eventTimestamp ? dateTimeText(eventTimestamp) : undefined],
          ]}
          width={width - CARD_CHROME}
        />
      ) : null}
    </SeerEmbedCard>
  );
}

/**
 * Load a saved query, which needs its source as well as its id.
 *
 * The embed names a dataset instead, so the source is inferred: `discover` is
 * the errors/transactions endpoint and everything Explore saves — spans, logs,
 * metrics, replays — lives under `explore`.
 */
function savedQuerySource(dataset: string | undefined): SavedQuerySource {
  return dataset === "errors" || dataset === "transactions" || dataset === "discover"
    ? "discover"
    : "explore";
}

const loadSavedQuery: DirectResourceLoader<SavedQuery> = (client, { org, id, signal }) => {
  const separator = id.indexOf(":");
  return fetchSavedQuery(client, {
    org,
    source: id.slice(0, separator) as SavedQuerySource,
    queryId: id.slice(separator + 1),
    signal,
  });
};

/** A saved Explore query, showing the query itself rather than only its name. */
function SavedQueryEmbed({ data, width, client, org }: SeerEmbedProps) {
  const queryId = embedText(data["id"]) ?? "";
  const dataset = embedText(data["dataset"]);
  const id = queryId ? `${savedQuerySource(dataset)}:${queryId}` : "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadSavedQuery });
  const query = valueOf(status);

  return (
    <SeerEmbedCard
      label="Saved query"
      title={query?.name ?? embedText(data["name"]) ?? queryId}
      subtitle={query?.datasetLabel ?? dataset}
      width={width}
    >
      <SeerEmbedStatus status={status} noun="saved query" />
      {query ? (
        <SeerEmbedFields
          fields={[
            ["Filter", query.query || "—"],
            ["Columns", query.fields.join(", ") || undefined],
            ["Sort", query.sort],
            ["Period", query.statsPeriod],
          ]}
          width={width - CARD_CHROME}
        />
      ) : null}
    </SeerEmbedCard>
  );
}

const loadSavedView: DirectResourceLoader<GroupSearchView> = (client, { org, id, signal }) =>
  fetchGroupSearchView(client, { org, viewId: id, signal });

/**
 * A saved issue view, previewed by the issues it currently matches.
 *
 * Two requests, in sequence rather than in parallel: the view is what carries
 * the query, so there is nothing to ask the issue endpoint until it lands.
 */
function SavedIssueViewEmbed({ data, width, client, org }: SeerEmbedProps) {
  const id = embedText(data["id"]) ?? "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadSavedView });
  const view = valueOf(status);

  return (
    <SeerEmbedCard
      label="Issue view"
      title={view?.name ?? embedText(data["name"]) ?? id}
      subtitle={view?.query}
      width={width}
    >
      <SeerEmbedStatus status={status} noun="issue view" />
      {view ? (
        <SeerQueryEmbed
          name="issuesQuery"
          data={{
            query: view.query,
            sort: view.querySort,
            statsPeriod: view.timeFilters.period,
            projects: view.projects.filter((project) => project > 0).map(String),
            environments: view.environments,
          }}
          width={width - CARD_CHROME}
          client={client}
          org={org}
          bare
        />
      ) : null}
    </SeerEmbedCard>
  );
}

/** The one-line fallback, for a block name with no card of its own. */
export function SeerInlineEmbedText({
  name,
  data,
  level,
}: {
  name: string;
  data: Record<string, unknown>;
  level: SeerEmbedLevel;
}) {
  const theme = useTheme();
  return (
    <text fg={level === "block" ? theme.text : theme.muted}>{inlineSeerEmbed(name, data)}</text>
  );
}
