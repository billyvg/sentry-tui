/**
 * Explore › Logs — a scrollable table of structured log entries.
 *
 * Mirrors the web app's Logs view: a search bar, the shared filter row, a
 * volume chart, and a table of log rows. It is also the worked example for
 * every other Discover-backed table: fetch through a hook that goes through
 * `queryDiscover`, push the rows into screen state, and describe the columns
 * to `DataTable`.
 */

import { useCallback, useEffect, useRef } from "react";

import { RenderableEvents, type InputRenderable } from "@opentui/core";

import type { LogEntry, LogSeverity } from "~/api/logs";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { fitText, padText } from "~/lib/text";
import { clockTime } from "~/lib/time";
import { BarChart, CHART_ROWS, fitsChart } from "~/ui/components/BarChart";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useLogs, useLogTimeseries } from "~/ui/hooks/useLogs";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import type { ScreenProps } from "~/ui/screens/types";

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

/**
 * The columns, and the order they are given up in.
 *
 * Time and the message survive any width — a log line without either is not a
 * log line. Project goes first when the pane narrows, then severity, whose
 * colour still reads off the message beside it.
 */
const COLUMNS: ReadonlyArray<Column<LogEntry>> = [
  {
    key: "time",
    label: "Time",
    width: 10,
    render: (entry, _selected, width) => (
      <text fg={theme.muted}>{padText(clockTime(entry.timestamp), width)}</text>
    ),
  },
  {
    key: "severity",
    label: "Level",
    width: 6,
    priority: 2,
    render: (entry, _selected, width) => {
      const severity = entry.severityText;
      return (
        <text
          fg={SEVERITY_COLOR[severity] ?? theme.muted}
          attributes={severity === "error" || severity === "fatal" ? BOLD : 0}
        >
          {padText(SEVERITY_LABEL[severity] ?? severity.toUpperCase(), width)}
        </text>
      );
    },
  },
  {
    key: "project",
    label: "Project",
    width: 14,
    priority: 1,
    render: (entry, _selected, width) => (
      <text fg={theme.subText}>{padText(entry.projectSlug ?? "", width)}</text>
    ),
  },
  {
    key: "message",
    label: "Message",
    width: "flex",
    render: (entry, _selected, width) => <text fg={theme.text}>{padText(entry.body, width)}</text>,
  },
];

export function LogStream({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  registerActions,
}: ScreenProps) {
  const { setEntries, setStatus, setOpenDropdown, setDetailOpen, focusSearch, handleSearchBlur } =
    state;
  const inputRef = useRef<InputRenderable>(null);

  // Sync native focus/blur (e.g. mouse clicks) back to the app's search state.
  const inputRefCallback = useCallback(
    (node: InputRenderable | null) => {
      const previous = inputRef.current;
      if (previous) {
        previous.removeAllListeners(RenderableEvents.FOCUSED);
        previous.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, () => focusSearch());
        node.on(RenderableEvents.BLURRED, () => handleSearchBlur());
      }
    },
    [focusSearch, handleSearchBlur],
  );

  const query = state.committedQuery;
  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;

  const { logs } = useLogs(client, {
    org,
    query,
    statsPeriod: state.statsPeriod,
    project,
    environment,
    reloadToken,
  });
  const timeseries = valueOf(
    useLogTimeseries(client, {
      org,
      query,
      statsPeriod: state.statsPeriod,
      project,
      environment,
      reloadToken,
    }),
  );

  const loading = logs.state === "loading";
  const since = logs.state === "loading" ? logs.since : undefined;
  const elapsed = useElapsed(loading, since);

  const entries = valueOf(logs);
  const error = errorOf(logs);

  useEffect(() => {
    if (entries) setEntries(entries);
  }, [entries, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      elapsedMs: elapsed ?? elapsedMs(logs, Date.now()),
      error: error?.message,
      noun: "logs",
    });
  }, [loading, elapsed, error, logs, setStatus]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  /**
   * Enter toggles the detail panel rather than pushing a view: the cursor keys
   * keep working while it is open, so there is nothing to pop back out of.
   * Escape closes it, ahead of anything else that would claim the key.
   */
  useScreenActions(registerActions, {
    open: () => setDetailOpen((open) => !open),
    back: () => {
      if (!state.detailOpen) return false;
      setDetailOpen(false);
      return true;
    },
  });

  const hasChart = fitsChart(height) && Boolean(timeseries && timeseries.length > 0);
  const inner = Math.max(20, width - 2);

  /**
   * The row the detail panel describes.
   *
   * It reads the cursor rather than a pinned entry, so the panel follows j/k
   * while it is open — a log line is four fields, and freezing the list to
   * read them would cost more than it shows.
   */
  const selectedEntry = entries?.[state.selected] ?? null;
  const showDetail = state.detailOpen && selectedEntry !== null;

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/* Search bar, matching the issue stream's bordered input. */}
      <box
        style={{
          flexDirection: "row",
          width,
          flexShrink: 0,
          height: 3,
          border: true,
          borderStyle: "rounded",
          borderColor: state.searchFocused ? theme.accent : theme.border,
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={theme.subText}>{"("}</text>
        <text fg={state.searchFocused ? theme.accent : theme.text}>{"/"}</text>
        <text fg={theme.subText}>{")"} </text>
        <input
          ref={inputRefCallback}
          value={state.searchQuery}
          placeholder="Search logs…"
          focused={state.searchFocused}
          onInput={state.setSearchQuery}
          style={{
            flexGrow: 1,
            textColor: theme.text,
            backgroundColor: theme.panel,
            focusedTextColor: theme.text,
            focusedBackgroundColor: theme.panel,
            placeholderColor: theme.subText,
          }}
        />
      </box>

      {/* Filter row: project / environment / period selectors. */}
      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sortLabel={entries ? `${entries.length} logs` : ""}
        anchorTop={SEARCH_ROWS}
        onProjectChange={state.setSelectedProjects}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      {/* Volume chart */}
      {hasChart && timeseries ? (
        <BarChart
          buckets={timeseries}
          width={inner}
          height={CHART_ROWS}
          title="count(logs)"
          noun="logs"
        />
      ) : null}

      <DataTable
        rows={entries}
        columns={COLUMNS}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(entry) => entry.id}
        loading={isInitialLoad(logs)}
        error={error}
        errorTitle="Failed to load logs"
        empty={{
          title: "No logs found.",
          lines: [
            query || undefined,
            "Try widening the time range or adjusting the query.",
            "This organization may not have logs enabled.",
          ],
        }}
        // The chart and the detail panel each shorten the viewport, so both
        // move the scroll offset.
        layout={[height, hasChart, showDetail]}
      />

      {showDetail && selectedEntry ? <LogDetail entry={selectedEntry} width={inner} /> : null}
    </box>
  );
}

// ---------------------------------------------------------------------------
// Detail panel for the selected log entry
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
