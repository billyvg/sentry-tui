/**
 * Explore › Logs screen — a scrollable list of structured log entries.
 *
 * Mirrors the web app's Logs view: a search bar at top, followed by a table
 * of log rows. Each row shows the timestamp, severity, project, and message
 * body. Selecting a row opens a detail panel showing attributes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { RenderableEvents, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";

import type { SentryClient } from "~/api/client";
import { DEFAULT_LOG_PERIOD, type LogEntry, type LogSeverity } from "~/api/logs";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { fitText, padText } from "~/lib/text";
import { BarChart } from "~/ui/components/BarChart";
import { FilterBar, SEARCH_ROWS, type FilterDropdownType } from "~/ui/components/FilterBar";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useLogs, useLogTimeseries } from "~/ui/hooks/useLogs";
import { useRowScrollFollow } from "~/ui/hooks/useRowScrollFollow";
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

/** A log row is a single line — no rule beneath it, unlike an issue row. */
const ROW_HEIGHT = 1;

export interface LogStreamProps {
  client: SentryClient | null;
  org: string;
  width: number;
  height: number;
  focused: boolean;
  selectedIndex: number;
  onLogsChange?: (logs: LogEntry[]) => void;
  onStatusChange?: (status: { loading: boolean; elapsedMs?: number; error?: string }) => void;
  /** Which filter dropdown is open (null = none). */
  openDropdown?: FilterDropdownType;
  /** Selected project slugs (empty = all). */
  selectedProjects?: string[];
  /** Selected environment names (empty = all). */
  selectedEnvs?: string[];
  /** Stats period for the query. */
  statsPeriod?: string;
  onProjectChange?: (projects: string[]) => void;
  onEnvChange?: (envs: string[]) => void;
  onPeriodChange?: (period: string) => void;
  onDropdownClose?: () => void;
  onDropdownOpen?: (which: FilterDropdownType) => void;
  /** The committed query sent to the API for fetching. */
  query?: string;
  /** The live input value displayed in the search bar (may differ while editing). */
  searchValue?: string;
  /** Called as the user types into the search bar. */
  onSearchInput?: (value: string) => void;
  /** Whether the search input is focused. */
  searchFocused?: boolean;
  /** Called when the input gains focus (e.g. via mouse click). */
  onSearchFocus?: () => void;
  /** Called when the input loses focus. */
  onSearchBlur?: () => void;
  /** Bump to refetch the current query — the app's global refresh. */
  reloadToken?: number;
  /**
   * Show the detail panel for the selected row. Owned by the `App` so the
   * status bar can name the key that closes it again.
   */
  detailOpen?: boolean;
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
  openDropdown = null,
  selectedProjects = [],
  selectedEnvs = [],
  statsPeriod: statsPeriodProp,
  onProjectChange,
  onEnvChange,
  onPeriodChange,
  onDropdownClose,
  onDropdownOpen,
  query: queryProp,
  searchValue,
  onSearchInput,
  searchFocused = false,
  onSearchFocus,
  onSearchBlur,
  reloadToken,
  detailOpen = false,
}: LogStreamProps) {
  const [localQuery] = useState("");
  const query = queryProp ?? localQuery;
  const displayValue = searchValue ?? query;
  const statsPeriod = statsPeriodProp ?? DEFAULT_LOG_PERIOD;
  const inputRef = useRef<InputRenderable>(null);
  const listRef = useRef<ScrollBoxRenderable>(null);

  // Sync native focus/blur (e.g. mouse clicks) back to the parent.
  const inputRefCallback = useCallback(
    (node: InputRenderable | null) => {
      const prev = inputRef.current;
      if (prev) {
        prev.removeAllListeners(RenderableEvents.FOCUSED);
        prev.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, () => onSearchFocus?.());
        node.on(RenderableEvents.BLURRED, () => onSearchBlur?.());
      }
    },
    [onSearchFocus, onSearchBlur],
  );

  const { logs } = useLogs(client, {
    org,
    query,
    statsPeriod,
    project: selectedProjects.length > 0 ? selectedProjects : undefined,
    environment: selectedEnvs.length > 0 ? selectedEnvs : undefined,
    reloadToken,
  });
  const timeseriesStatus = useLogTimeseries(client, {
    org,
    query,
    statsPeriod,
    project: selectedProjects.length > 0 ? selectedProjects : undefined,
    environment: selectedEnvs.length > 0 ? selectedEnvs : undefined,
    reloadToken,
  });
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

  /**
   * The row the detail panel describes.
   *
   * It reads the cursor rather than a pinned entry, so the panel follows j/k
   * while it is open — a log line is four fields, and freezing the list to
   * read them would cost more than it shows.
   */
  const selectedEntry = entries?.[selectedIndex] ?? null;
  const showDetail = detailOpen && selectedEntry !== null;

  // The detail panel shortens the viewport, so it moves the offset too.
  useRowScrollFollow(listRef, {
    index: selectedIndex,
    rowCount: entries?.length ?? 0,
    rowHeight: ROW_HEIGHT,
    layout: [height, showDetail],
  });

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
          borderColor: searchFocused ? theme.accent : theme.border,
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={theme.subText}>{"("}</text>
        <text fg={theme.hotkey}>{"/"}</text>
        <text fg={theme.subText}>{")"} </text>
        <input
          ref={inputRefCallback}
          value={displayValue}
          placeholder="Search logs…"
          focused={searchFocused}
          onInput={onSearchInput}
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
        openDropdown={openDropdown}
        selectedProjects={selectedProjects}
        selectedEnvs={selectedEnvs}
        statsPeriod={statsPeriod}
        sortLabel={entries ? `${entries.length} logs` : ""}
        anchorTop={SEARCH_ROWS}
        onProjectChange={onProjectChange ?? (() => {})}
        onEnvChange={onEnvChange ?? (() => {})}
        onPeriodChange={onPeriodChange ?? (() => {})}
        onDropdownClose={onDropdownClose ?? (() => {})}
        onDropdownOpen={onDropdownOpen}
      />

      {/* Volume chart */}
      {timeseries && timeseries.length > 0 ? (
        <BarChart buckets={timeseries} width={inner} height={CHART_HEIGHT} />
      ) : null}

      {/* Column header */}
      <LogListHeader width={inner} />

      {/*
       * Log list. `flexBasis: 0` is what makes this box scroll at all: on
       * `auto` the scrollbox takes its content's height as its base size,
       * grows past the pane, and ends up with a viewport as tall as the list —
       * nothing overflows, so there is nothing to scroll.
       */}
      <scrollbox
        ref={listRef}
        // The list keeps focus while the panel is open: the panel has nothing
        // of its own to scroll, and taking focus away would stop j/k moving
        // the cursor the panel is following.
        focused={focused}
        // Same scroll rail as the issue stream — see `IssueStream`.
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.muted },
        }}
        style={{ flexGrow: 1, flexBasis: 0, width }}
      >
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
