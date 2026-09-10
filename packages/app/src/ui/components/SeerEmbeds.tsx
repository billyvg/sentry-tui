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

import type { SentryClient } from "~/api/client";
import { getDashboard, type DashboardDetails } from "~/api/dashboards";
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
import { valueOf } from "~/core/async";
import {
  embedText,
  embedTexts,
  inlineSeerEmbed,
  relativeTime,
  type SeerEmbedLevel,
} from "~/core/seerEmbeds";
import { sparkline } from "~/lib/sparkline";
import { dateTimeText } from "~/lib/time";
import { SeerIssueEmbed } from "~/ui/components/SeerIssueEmbed";
import {
  CARD_CHROME,
  SeerEmbedCard,
  SeerEmbedFields,
  SeerEmbedStatus,
  SeerEmbedText,
} from "~/ui/components/SeerEmbedCard";
import { useDirectResource, type DirectResourceLoader } from "~/ui/hooks/useDirectResource";
import { useReleases } from "~/ui/hooks/useReleases";
import { BOLD, DIM } from "~/ui/lib/attributes";
import { useTheme } from "~/ui/theme";
import { SeerQueryEmbed } from "~/ui/components/SeerQueryEmbeds";

/** Everything a block embed needs to draw itself. */
export interface SeerEmbedProps {
  data: Record<string, unknown>;
  width: number;
  client: SentryClient | null;
  org: string;
}

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

/**
 * A trace reference.
 *
 * No fetch: the terminal has no waterfall to draw into a transcript, and the
 * span tree behind a trace id is the one piece of Sentry data that is all
 * structure — reduced to a card it would say less than the id does.
 */
function TraceEmbed({ data, width }: SeerEmbedProps) {
  const traceId = embedText(data["traceId"]);
  return (
    <SeerEmbedCard label="Trace" title={traceId} width={width}>
      <SeerEmbedFields
        fields={[
          ["Span", embedText(data["spanId"])],
          ["Timestamp", dateTimeText(embedText(data["timestamp"]))],
        ]}
        width={width - CARD_CHROME}
      />
    </SeerEmbedCard>
  );
}

/** A profile reference — a flamegraph is as terminal-hostile as a waterfall. */
function ProfileEmbed({ data, width }: SeerEmbedProps) {
  const profileId = embedText(data["profileId"]);
  return (
    <SeerEmbedCard label="Profile" title={profileId} width={width}>
      <SeerEmbedFields
        fields={[["Project", embedText(data["projectSlug"])]]}
        width={width - CARD_CHROME}
      />
    </SeerEmbedCard>
  );
}

/**
 * An alert reference.
 *
 * The four alert kinds are four different rule shapes behind three different
 * endpoints, and the terminal reaches alerts through the workflow list rather
 * than by id, so this names the alert rather than loading its conditions.
 */
function AlertEmbed({ data, width }: SeerEmbedProps) {
  const kind = embedText(data["kind"]);
  return (
    <SeerEmbedCard
      label="Alert"
      title={embedText(data["name"]) ?? embedText(data["id"])}
      subtitle={kind ? `${kind} alert` : undefined}
      width={width}
    >
      <SeerEmbedFields fields={[["Id", embedText(data["id"])]]} width={width - CARD_CHROME} />
    </SeerEmbedCard>
  );
}

// ---------------------------------------------------------------------------
// Fetching cards
// ---------------------------------------------------------------------------

const loadDashboard: DirectResourceLoader<DashboardDetails> = (client, { org, id, signal }) =>
  getDashboard(client, { org, id, signal });

/** A dashboard, previewed by the widgets it holds. */
function DashboardEmbed({ data, width, client, org }: SeerEmbedProps) {
  const theme = useTheme();
  const id = embedText(data["id"]) ?? "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadDashboard });
  const dashboard = valueOf(status);
  const widgets = dashboard?.widgets ?? [];

  return (
    <SeerEmbedCard
      label="Dashboard"
      title={dashboard?.title ?? embedText(data["title"]) ?? id}
      subtitle={dashboard ? `${widgets.length} widgets` : undefined}
      width={width}
    >
      <SeerEmbedStatus status={status} noun="dashboard" empty={Boolean(dashboard) && !widgets[0]} />
      {widgets.slice(0, 8).map((widget, index) => (
        <text key={`${widget.id ?? index}`} fg={theme.text}>
          {`  ${widget.title}`}
        </text>
      ))}
      {widgets.length > 8 ? (
        <text fg={theme.subText}>{`  …and ${widgets.length - 8} more`}</text>
      ) : null}
    </SeerEmbedCard>
  );
}

const loadDetector: DirectResourceLoader<Detector> = (client, { org, id, signal }) =>
  fetchDetector(client, { org, detectorId: id, signal });

/** A monitor, with the configuration its detail screen leads with. */
function MonitorEmbed({ data, width, client, org }: SeerEmbedProps) {
  const id = embedText(data["id"]) ?? "";
  const status = useDirectResource(id ? client : null, { org, id, load: loadDetector });
  const detector = valueOf(status);

  return (
    <SeerEmbedCard
      label="Monitor"
      title={detector?.name ?? embedText(data["name"]) ?? id}
      subtitle={detector ? `${detector.type}${detector.enabled ? "" : " · disabled"}` : undefined}
      width={width}
    >
      <SeerEmbedStatus status={status} noun="monitor" />
      {detector ? (
        <SeerEmbedFields
          fields={[
            ["Owner", detector.owner?.name ?? undefined],
            [
              "Last triggered",
              detector.lastTriggered ? relativeTime(detector.lastTriggered) : undefined,
            ],
            ["Last issue", detector.latestGroup?.shortId ?? undefined],
          ]}
          width={width - CARD_CHROME}
        />
      ) : null}
    </SeerEmbedCard>
  );
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
