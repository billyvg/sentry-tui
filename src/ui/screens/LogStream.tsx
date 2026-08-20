/**
 * Explore › Logs screen — a scrollable list of structured log entries.
 *
 * Mirrors the web app's Logs view: a search bar at top, followed by a table
 * of log rows. Each row shows the timestamp, severity, project, and message
 * body. Selecting a row opens a detail panel showing attributes.
 */

import { useEffect, useState } from "react";

import type { SentryClient } from "~/api/client";
import { DEFAULT_LOG_PERIOD, type LogEntry, type LogSeverity } from "~/api/logs";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { fitText, padText } from "~/lib/text";
import { BarChart } from "~/ui/components/BarChart";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useLogs, useLogTimeseries } from "~/ui/hooks/useLogs";
import { BOLD } from "~/ui/lib/attributes";

// ---------------------------------------------------------------------------
// Severity colors, matching the web's log level palette
// ---------------------------------------------------------------------------

const SEVERITY_COLOR: Record<LogSeverity, string> = {
  trace: theme.subText,
  debug: theme.muted,
  info: theme.accent,
  warn: theme.warning,
  error: theme.danger,
  fatal: theme.level.fatal,
};

const SEVERITY_LABEL: Record<LogSeverity, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: " INFO",
  warn: " WARN",
  error: "ERROR",
  fatal: "FATAL",
};

// ---------------------------------------------------------------------------
// Column widths
// ---------------------------------------------------------------------------

const COL_TIME = 10;
const COL_SEVERITY = 6;
const COL_PROJECT = 14;

/** Height of the volume bar chart in terminal rows (includes border). */
const CHART_HEIGHT = 10;

export interface LogStreamProps {
  client: SentryClient | null;
  org: string;
  width: number;
  height: number;
  focused: boolean;
  selectedIndex: number;
  onLogsChange?: (logs: LogEntry[]) => void;
  onStatusChange?: (status: { loading: boolean; elapsedMs?: number; error?: string }) => void;
}

export function LogStream({
  client,
  org,
  width,
  height,
  focused,
  selectedIndex,
  onLogsChange,
  onStatusChange,
}: LogStreamProps) {
  const [query] = useState("");
  const [statsPeriod] = useState(DEFAULT_LOG_PERIOD);

  const { logs } = useLogs(client, { org, query, statsPeriod });
  const timeseriesStatus = useLogTimeseries(client, { org, query, statsPeriod });
  const timeseries = valueOf(timeseriesStatus);

  const loading = logs.state === "loading";
  const since = logs.state === "loading" ? logs.since : undefined;
  const elapsed = useElapsed(loading, since);

  const entries = valueOf(logs);
  const error = errorOf(logs);

  useEffect(() => {
    if (entries) onLogsChange?.(entries);
  }, [entries, onLogsChange]);

  useEffect(() => {
    onStatusChange?.({
      loading,
      elapsedMs: elapsed ?? elapsedMs(logs, Date.now()),
      error: error?.message,
    });
  }, [loading, elapsed, error, logs, onStatusChange]);

  const inner = Math.max(20, width - 2);

  // Selected log entry detail panel (shown below the list)
  const selectedEntry = entries?.[selectedIndex] ?? null;
  const [showDetail, setShowDetail] = useState(false);

  // Reset detail when selection changes
  useEffect(() => {
    setShowDetail(false);
  }, [selectedIndex]);

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/* Search bar */}
      <box style={{ flexDirection: "row", width, flexShrink: 0 }}>
        <text fg={theme.muted}>{"/ "}</text>
        <text fg={query ? theme.text : theme.muted}>
          {fitText(query || "Search logs…", inner - 2)}
        </text>
      </box>

      {/* Filter row */}
      <box style={{ flexDirection: "row", width, flexShrink: 0 }}>
        <text fg={theme.muted}>{`[all projects] [all envs] [${statsPeriod}]`}</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.muted}>{entries ? `${entries.length} logs` : ""}</text>
      </box>

      {/* Volume chart */}
      {timeseries && timeseries.length > 0 ? (
        <BarChart buckets={timeseries} width={inner} height={CHART_HEIGHT} />
      ) : null}

      {/* Column header */}
      <LogListHeader width={inner} />

      {/* Log list */}
      <scrollbox focused={focused && !showDetail} style={{ flexGrow: 1, width }}>
        {entries === undefined && isInitialLoad(logs) ? (
          <LogListSkeleton width={inner} rows={20} />
        ) : null}

        {entries !== undefined && entries.length === 0 && !loading ? (
          <LogListEmpty query={query} />
        ) : null}

        {entries?.map((entry, index) => (
          <LogRow
            key={entry.id}
            entry={entry}
            selected={focused && index === selectedIndex}
            width={inner}
          />
        ))}

        {error && entries === undefined ? <LogListError error={error} /> : null}
      </scrollbox>

      {/* Detail panel for selected entry */}
      {showDetail && selectedEntry ? <LogDetail entry={selectedEntry} width={inner} /> : null}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function LogListHeader({ width }: { width: number }) {
  const msgWidth = Math.max(10, width - COL_TIME - COL_SEVERITY - COL_PROJECT - 3);
  return (
    <box
      style={{
        flexDirection: "row",
        width,
        border: ["bottom"],
        borderColor: theme.border,
        flexShrink: 0,
      }}
    >
      <text fg={theme.muted}>{padText("Time", COL_TIME)}</text>
      <text fg={theme.muted}> </text>
      <text fg={theme.muted}>{padText("Level", COL_SEVERITY)}</text>
      <text fg={theme.muted}> </text>
      <text fg={theme.muted}>{padText("Project", COL_PROJECT)}</text>
      <text fg={theme.muted}> </text>
      <text fg={theme.muted}>{padText("Message", msgWidth)}</text>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function LogRow({ entry, selected, width }: { entry: LogEntry; selected: boolean; width: number }) {
  const bg = selected ? theme.selected : undefined;
  const msgWidth = Math.max(10, width - COL_TIME - COL_SEVERITY - COL_PROJECT - 3);
  const severity = entry.severityText;
  const color = SEVERITY_COLOR[severity] ?? theme.muted;
  const ts = formatTimestamp(entry.timestamp);

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        backgroundColor: bg,
        flexShrink: 0,
      }}
    >
      <box style={{ flexDirection: "row" }}>
        <text fg={theme.muted}>{padText(ts, COL_TIME)}</text>
        <text fg={color}> </text>
        <text fg={color} attributes={severity === "error" || severity === "fatal" ? BOLD : 0}>
          {padText(SEVERITY_LABEL[severity] ?? severity.toUpperCase(), COL_SEVERITY)}
        </text>
        <text fg={theme.muted}> </text>
        <text fg={theme.subText}>{padText(entry.projectSlug ?? "", COL_PROJECT)}</text>
        <text fg={theme.muted}> </text>
        <text fg={theme.text}>{fitText(entry.body, msgWidth)}</text>
      </box>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Detail panel for selected log entry
// ---------------------------------------------------------------------------

function LogDetail({ entry, width }: { entry: LogEntry; width: number }) {
  return (
    <box
      style={{
        flexDirection: "column",
        width,
        border: ["top"],
        borderColor: theme.border,
        paddingTop: 1,
        flexShrink: 0,
      }}
    >
      <text fg={theme.accent} attributes={BOLD}>
        {"▾ Log Details"}
      </text>
      <text fg={theme.text}>{fitText(entry.body, width)}</text>
      <text fg={theme.muted}>
        {`  Severity: ${entry.severityText}  │  Project: ${entry.projectSlug ?? "—"}`}
      </text>
      {entry.traceId ? <text fg={theme.muted}>{`  Trace: ${entry.traceId}`}</text> : null}
    </box>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LogListSkeleton({ width, rows }: { width: number; rows: number }) {
  return (
    <box style={{ flexDirection: "column", width }}>
      {Array.from({ length: rows }, (_, i) => {
        const barWidth = Math.floor(width * (0.3 + ((i * 17) % 50) / 100));
        return (
          <box key={i} style={{ flexDirection: "row", width, flexShrink: 0 }}>
            <text fg={theme.panelAlt}>{padText("──:──:──", COL_TIME)}</text>
            <text fg={theme.panelAlt}> </text>
            <text fg={theme.panelAlt}>{padText("·····", COL_SEVERITY)}</text>
            <text fg={theme.panelAlt}> </text>
            <text fg={theme.panelAlt}>{"─".repeat(Math.min(barWidth, width))}</text>
          </box>
        );
      })}
    </box>
  );
}

function LogListEmpty({ query }: { query: string }) {
  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text fg={theme.text}>No logs found.</text>
      {query ? <text fg={theme.muted}>{query}</text> : null}
      <text fg={theme.muted}>Try widening the time range or adjusting the query.</text>
    </box>
  );
}

function LogListError({ error }: { error: { message: string; retryable: boolean } }) {
  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text fg={theme.danger}>Failed to load logs</text>
      <text fg={theme.muted}>{error.message}</text>
      {error.retryable ? <text fg={theme.muted}>R to retry</text> : null}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract HH:MM:SS from an ISO timestamp for the compact time column. */
function formatTimestamp(iso: string): string {
  if (!iso) return "--:--:--";
  // Try to grab HH:MM:SS from ISO string
  const match = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return match?.[1] ?? (iso.slice(11, 19) || "--:--:--");
}
