/**
 * Terminal renderers for the query-shaped Seer embeds.
 *
 * `issuesQuery`, `errorsQuery`, `spansQuery`, `logsQuery`, `replaysQuery` and
 * `metricsQuery` all say the same thing — here is a search, over these page
 * filters, against this dataset — and the web previews each of them with the
 * first few matching rows. So they share one card here: a header naming the
 * query and its filters, then a handful of rows fetched through whichever hook
 * the terminal already uses for that dataset's own screen.
 *
 * Deliberately a preview rather than a table: an embed sits inside a scrolling
 * transcript, so it cannot own a selection, a sort, or a page. Five rows are
 * enough to say what the query found; the screen behind it is where a person
 * goes to work with the result.
 */

import { useMemo } from "react";

import type { SentryClient } from "~/api/client";
import type { DiscoverRow } from "~/api/discover";
import { DEFAULT_STATS_PERIOD, issueSort } from "~/api/issues";
import { DEFAULT_REPLAY_PERIOD, formatReplayDuration, shortReplayId } from "~/api/replays";
import { valueOf } from "~/core/async";
import type { ResolvedExploreQuery } from "~/core/exploreQuery";
import { getExploreTable, type ExploreTable } from "~/core/exploreTables";
import type { ScreenId } from "~/core/screens";
import {
  describeEmbedPeriod,
  embedText,
  queryEmbedTitle,
  readQueryEmbed,
  resolveMetricsEmbed,
  type SeerQueryEmbed as SeerQueryEmbedData,
} from "~/core/seerEmbeds";
import { fitText } from "~/lib/text";
import { BODY_INDENT } from "~/ui/components/DetailSections";
import { IssueRow } from "~/ui/components/IssueRow";
import {
  CARD_CHROME,
  SeerEmbedCard,
  SeerEmbedFields,
  SeerEmbedStatus,
} from "~/ui/components/SeerEmbedCard";
import { useDiscoverRows } from "~/ui/hooks/useDiscoverRows";
import { useExploreEvents } from "~/ui/hooks/useExploreEvents";
import { useIssues } from "~/ui/hooks/useIssues";
import { useReplays } from "~/ui/hooks/useReplays";
import { useTheme } from "~/ui/theme";

/** Rows a preview shows before it stops — the web embeds show five. */
const PREVIEW_ROWS = 5;

interface QueryEmbedProps {
  name: string;
  data: Record<string, unknown>;
  width: number;
  client: SentryClient | null;
  org: string;
  /**
   * Render the rows without the surrounding card.
   *
   * Set when another embed has already drawn a card around this preview — a
   * saved issue view is a named thing *plus* an issue query, and two nested
   * borders would say it is two things.
   */
  bare?: boolean;
}

/** The Explore table each query embed previews against. */
const EXPLORE_SCREENS: Readonly<Record<string, ScreenId>> = {
  spansQuery: "explore.traces",
  logsQuery: "explore.logs",
  metricsQuery: "explore.metrics",
};

/** What one query embed's rows are called, in its empty and loading lines. */
const NOUNS: Readonly<Record<string, string>> = {
  issuesQuery: "issues",
  errorsQuery: "errors",
  spansQuery: "spans",
  logsQuery: "logs",
  metricsQuery: "metrics",
  replaysQuery: "replays",
};

/** Draw one query-shaped embed, or nothing when the name is not one. */
export function SeerQueryEmbed(props: QueryEmbedProps) {
  switch (props.name) {
    case "issuesQuery":
      return <IssuesQueryEmbed {...props} />;
    case "replaysQuery":
      return <ReplaysQueryEmbed {...props} />;
    case "errorsQuery":
      return <ErrorsQueryEmbed {...props} />;
    case "spansQuery":
    case "logsQuery":
    case "metricsQuery":
      return <ExploreQueryEmbed {...props} />;
    default:
      return null;
  }
}

/**
 * The dim line under a query card's title.
 *
 * Says what narrows the result and nothing that does not: an aggregate query
 * names its grouping and its aggregate, every query names its period, and a
 * project or environment filter is only mentioned when there is one.
 */
function describeQuery(embed: SeerQueryEmbedData): string {
  const parts: string[] = [];
  if (embed.mode === "aggregate") {
    if (embed.groupBy.length > 0) parts.push(`by ${embed.groupBy.join(", ")}`);
    if (embed.yAxes.length > 0) parts.push(embed.yAxes.join(", "));
  }
  const period = describeEmbedPeriod(embed.filters);
  if (period) parts.push(period);
  if (embed.filters.projects.length > 0) {
    parts.push(
      embed.filters.projects.length === 1
        ? `1 project`
        : `${embed.filters.projects.length} projects`,
    );
  }
  if (embed.filters.environments.length > 0) parts.push(embed.filters.environments.join(", "));
  return parts.join(" · ");
}

/**
 * The card a query preview draws into, or a bare fragment.
 *
 * Both shapes exist so `bare` can nest a preview inside another embed's card
 * without the caller having to know which children go where.
 */
function QueryCard({
  label,
  embed,
  noun,
  width,
  bare,
  children,
}: {
  label: string;
  embed: SeerQueryEmbedData;
  noun: string;
  width: number;
  bare: boolean;
  children: React.ReactNode;
}) {
  if (bare) return <>{children}</>;
  return (
    <SeerEmbedCard
      label={label}
      title={queryEmbedTitle(embed, noun)}
      subtitle={describeQuery(embed)}
      width={width}
    >
      {children}
    </SeerEmbedCard>
  );
}

/** Issues matching a search — the issue stream's own rows, capped at five. */
function IssuesQueryEmbed({ data, width, client, org, bare = false }: QueryEmbedProps) {
  const embed = readQueryEmbed(data);
  const state = useIssues(client, {
    org,
    query: embed.query,
    sort: issueSort(embed.sort ?? "date"),
    statsPeriod: embed.filters.statsPeriod ?? DEFAULT_STATS_PERIOD,
    limit: PREVIEW_ROWS,
    project: embed.filters.projects.length > 0 ? embed.filters.projects : undefined,
    environment: embed.filters.environments.length > 0 ? embed.filters.environments : undefined,
  });
  const groups = valueOf(state.issues) ?? [];
  const rowWidth = Math.max(24, width - (bare ? 0 : CARD_CHROME));

  return (
    <QueryCard label="Issues" embed={embed} noun="issues" width={width} bare={bare}>
      <SeerEmbedStatus
        status={state.issues}
        noun="issues"
        empty={state.issues.state === "ready" && groups.length === 0}
      />
      {groups.slice(0, PREVIEW_ROWS).map((group) => (
        <IssueRow key={group.id} group={group} selected={false} width={rowWidth} />
      ))}
    </QueryCard>
  );
}

/** Replays matching a search, with the counts the replay list leads with. */
function ReplaysQueryEmbed({ data, width, client, org, bare = false }: QueryEmbedProps) {
  const theme = useTheme();
  const embed = readQueryEmbed(data);
  const state = useReplays(client, {
    org,
    query: embed.query,
    statsPeriod: embed.filters.statsPeriod ?? DEFAULT_REPLAY_PERIOD,
    project: embed.filters.projects.length > 0 ? embed.filters.projects : undefined,
    environment: embed.filters.environments.length > 0 ? embed.filters.environments : undefined,
  });
  const replays = valueOf(state.replays) ?? [];
  const inner = Math.max(1, width - (bare ? 0 : CARD_CHROME));

  return (
    <QueryCard label="Replays" embed={embed} noun="replays" width={width} bare={bare}>
      <SeerEmbedStatus
        status={state.replays}
        noun="replays"
        empty={state.replays.state === "ready" && replays.length === 0}
      />
      {replays.slice(0, PREVIEW_ROWS).map((replay) => {
        const counts = [
          formatReplayDuration(replay.durationSec),
          replay.countErrors === undefined ? null : `${replay.countErrors} errors`,
          replay.countRageClicks === undefined ? null : `${replay.countRageClicks} rage`,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <box key={replay.id} style={{ flexDirection: "row", width: inner }}>
            <text fg={theme.text}>
              {`${BODY_INDENT}${fitText(
                replay.user.displayName ?? shortReplayId(replay.id),
                Math.max(1, inner - counts.length - 3),
              )}`}
            </text>
            <text fg={theme.muted}>{`  ${counts}`}</text>
          </box>
        );
      })}
    </QueryCard>
  );
}

/**
 * The columns a preview shows.
 *
 * An aggregate query's own group-bys and aggregates are exactly what it is
 * about, so they are the columns. A samples query has no such list — the agent
 * may name `fields`, and the dataset's own table columns stand in when it does
 * not.
 */
function previewFields(
  embed: SeerQueryEmbedData,
  table: ExploreTable,
  yAxes: readonly string[],
): readonly string[] {
  if (embed.mode === "aggregate") {
    return [...new Set([...embed.groupBy, ...(yAxes.length > 0 ? yAxes : [table.yAxis])])];
  }
  return embed.fields.length > 0 ? embed.fields : table.fields;
}

/** Render a row of a Discover-shaped result as `field  value` lines. */
function RowFields({
  row,
  fields,
  width,
}: {
  row: DiscoverRow;
  fields: readonly string[];
  width: number;
}) {
  return (
    <SeerEmbedFields
      fields={fields.slice(0, 4).map((field) => [field, formatCell(row[field])] as const)}
      width={width}
    />
  );
}

/** A Discover cell as one line of text, without pretending to know its unit. */
function formatCell(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Spans, logs or metrics — the three datasets Explore serves the same way. */
function ExploreQueryEmbed({ name, data, width, client, org, bare = false }: QueryEmbedProps) {
  const theme = useTheme();
  const embed = readQueryEmbed(data);
  const screenId = EXPLORE_SCREENS[name];
  const table = screenId ? getExploreTable(screenId) : undefined;
  const noun = NOUNS[name] ?? "rows";

  // Metrics is the one dataset that does not take its subject as a filter:
  // the metric's identity rides in the aggregate's arguments, and only drops
  // into the search string in samples mode. Every other dataset passes through.
  const metricName = name === "metricsQuery" ? embedText(data["name"]) : undefined;
  const { query, yAxes } =
    name === "metricsQuery"
      ? resolveMetricsEmbed(data, embed)
      : { query: embed.query, yAxes: embed.yAxes };

  const fields = table ? previewFields(embed, table, yAxes) : [];
  // Both are effect dependencies in the hook, so a fresh object per render
  // would refetch forever.
  const request = useMemo<ResolvedExploreQuery>(
    () => ({
      mode: embed.mode,
      fields,
      sort: embed.sort ?? table?.sort ?? "",
      yAxis: yAxes[0] ?? table?.yAxis ?? "",
      groupBys: embed.groupBy,
      idField: embed.mode === "aggregate" ? (embed.groupBy[0] ?? "") : (table?.idField ?? ""),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [embed.mode, fields.join(","), embed.sort, yAxes.join(","), embed.groupBy.join(","), table],
  );

  const state = useExploreEvents(table ? client : null, table ?? FALLBACK_TABLE, {
    org,
    query,
    request,
    statsPeriod: embed.filters.statsPeriod ?? "24h",
    project: embed.filters.projects.length > 0 ? embed.filters.projects : undefined,
    environment: embed.filters.environments.length > 0 ? embed.filters.environments : undefined,
  });
  const events = valueOf(state.events) ?? [];
  const inner = Math.max(1, width - (bare ? 0 : CARD_CHROME));

  return (
    <QueryCard
      label={noun[0]!.toUpperCase() + noun.slice(1)}
      embed={{ ...embed, title: embed.title ?? metricName }}
      noun={noun}
      width={width}
      bare={bare}
    >
      <SeerEmbedStatus
        status={state.events}
        noun={noun}
        empty={state.events.state === "ready" && events.length === 0}
      />
      {events.slice(0, PREVIEW_ROWS).map((event, index) => (
        <box key={event.id} style={{ flexDirection: "column", width: inner }}>
          {index > 0 ? (
            <text fg={theme.border}>{`${BODY_INDENT}${"─".repeat(Math.max(0, inner - 4))}`}</text>
          ) : null}
          <RowFields row={event.row} fields={fields} width={inner} />
        </box>
      ))}
    </QueryCard>
  );
}

/**
 * The table handed to the hook when a name has no table of its own.
 *
 * `useExploreEvents` takes a table by value, so it needs one even on the path
 * where the client is `null` and it will never fetch.
 */
const FALLBACK_TABLE = getExploreTable("explore.traces")!;

/** Errors — Discover rather than Explore, and so its own hook. */
function ErrorsQueryEmbed({ data, width, client, org, bare = false }: QueryEmbedProps) {
  const theme = useTheme();
  const embed = readQueryEmbed(data);
  const table = getExploreTable("explore.errors");
  const fields = useMemo(
    () => (table ? previewFields(embed, table, embed.yAxes) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [embed.mode, embed.fields.join(","), embed.groupBy.join(","), embed.yAxes.join(","), table],
  );

  const state = useDiscoverRows(client, {
    org,
    dataset: "errors",
    fields,
    sort: embed.sort,
    query: embed.query,
    statsPeriod: embed.filters.statsPeriod ?? "24h",
    project: embed.filters.projects.length > 0 ? embed.filters.projects : undefined,
    environment: embed.filters.environments.length > 0 ? embed.filters.environments : undefined,
    referrer: table?.referrer,
  });
  const rows = valueOf(state.rows) ?? [];
  const inner = Math.max(1, width - (bare ? 0 : CARD_CHROME));

  return (
    <QueryCard label="Errors" embed={embed} noun="errors" width={width} bare={bare}>
      <SeerEmbedStatus
        status={state.rows}
        noun="errors"
        empty={state.rows.state === "ready" && rows.length === 0}
      />
      {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
        <box key={index} style={{ flexDirection: "column", width: inner }}>
          {index > 0 ? (
            <text fg={theme.border}>{`${BODY_INDENT}${"─".repeat(Math.max(0, inner - 4))}`}</text>
          ) : null}
          <RowFields row={row} fields={fields} width={inner} />
        </box>
      ))}
    </QueryCard>
  );
}
