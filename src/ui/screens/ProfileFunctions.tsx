/**
 * Explore › Profiles — the slowest functions, and an honest note about the
 * flamegraph that isn't here.
 *
 * The web's landing page (`views/explore/profiling/landing/`) leads with an
 * aggregate flamegraph and puts `slowestFunctionsWidget.tsx` underneath it.
 * The flamegraph is a pixel artifact: it encodes call depth in stacked rows a
 * few pixels tall and frame cost in sub-character widths, neither of which
 * survives a terminal cell grid. An ASCII approximation would be a picture of
 * a flamegraph rather than a readable one, so the pane says where the real one
 * lives and gets on with the table, which loses nothing in a terminal.
 */

import { useCallback, useEffect, useRef } from "react";

import { RenderableEvents, type InputRenderable } from "@opentui/core";

import type { ProfileFunction } from "~/api/profileFunctions";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import { theme } from "~/core/theme";
import { formatCount } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useProfileFunctions } from "~/ui/hooks/useProfileFunctions";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import type { ScreenProps } from "~/ui/screens/types";

/**
 * What the pane says in place of the aggregate flamegraph.
 *
 * Kept to a heading and two lines: what is missing, why, and where to find it.
 * Deliberately not an error and not a "coming soon" — the flamegraph is not
 * going to be drawn here, and three rows is what that admission is worth
 * against the table it sits above.
 */
const FLAMEGRAPH_HEADING = "Aggregate flamegraph — open Explore › Profiles on sentry.io";

/** Cells the function name keeps before another column is shed for it. */
const MIN_FUNCTION_WIDTH = 24;

const FLAMEGRAPH_NOTE = [
  "A flamegraph needs pixels a terminal does not have; an ASCII",
  "approximation would mislead. Below: the same page's slowest functions.",
] as const;

/**
 * The columns, and the order they are given up in.
 *
 * The function name and its total self time are what the screen is for, so
 * neither sheds. Project goes first — a terminal is usually pointed at one —
 * then the package, then the per-call figures, which are refinements of the
 * total rather than replacements for it.
 */
const COLUMNS: ReadonlyArray<Column<ProfileFunction>> = [
  {
    key: "function",
    label: "Function",
    width: "flex",
    render: (fn, _selected, width) => <text fg={theme.text}>{padText(fn.name, width)}</text>,
  },
  {
    key: "package",
    label: "Package",
    width: 18,
    priority: 2,
    render: (fn, _selected, width) => <text fg={theme.muted}>{padText(fn.package, width)}</text>,
  },
  {
    key: "project",
    label: "Project",
    width: 12,
    priority: 1,
    render: (fn, _selected, width) => (
      <text fg={theme.subText}>{padText(fn.projectSlug ?? "", width)}</text>
    ),
  },
  {
    key: "count",
    label: "Calls",
    width: 7,
    align: "right",
    priority: 3,
    render: (fn, _selected, width) => (
      <text fg={theme.muted}>{padText(formatCount(fn.count), width, "right")}</text>
    ),
  },
  {
    key: "p75",
    label: "p75",
    width: 9,
    align: "right",
    priority: 4,
    render: (fn, _selected, width) => (
      <text fg={theme.muted}>{padText(formatNanoseconds(fn.p75SelfTimeNs), width, "right")}</text>
    ),
  },
  {
    key: "total",
    label: "Self Time",
    width: 10,
    align: "right",
    render: (fn, _selected, width) => (
      <text fg={theme.text}>{padText(formatNanoseconds(fn.totalSelfTimeNs), width, "right")}</text>
    ),
  },
];

export function ProfileFunctions({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  registerActions,
  activateRow,
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

  const { functions: status } = useProfileFunctions(client, {
    org,
    query,
    statsPeriod: state.statsPeriod,
    project: state.selectedProjects.length > 0 ? state.selectedProjects : undefined,
    environment: state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined,
    reloadToken,
  });

  const loading = status.state === "loading";
  const since = status.state === "loading" ? status.since : undefined;
  const elapsed = useElapsed(loading, since);

  const functions = valueOf(status);
  const error = errorOf(status);

  useEffect(() => {
    if (functions) setEntries(functions);
  }, [functions, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      elapsedMs: elapsed ?? elapsedMs(status, Date.now()),
      error: error?.message,
      noun: "functions",
    });
  }, [loading, elapsed, error, status, setStatus]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  /**
   * Enter opens the detail panel. A function's name and package are the two
   * columns most likely to be truncated — a mangled C++ symbol runs to
   * hundreds of characters — so the panel is where they are readable in full.
   */
  useScreenActions(registerActions, {
    open: () => setDetailOpen((open) => !open),
    back: () => {
      if (!state.detailOpen) return false;
      setDetailOpen(false);
      return true;
    },
  });

  const inner = Math.max(20, width - 2);
  const selected = functions?.[state.selected] ?? null;
  const showDetail = state.detailOpen && selected !== null;

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <box
        style={{
          flexDirection: "row",
          width,
          flexShrink: 0,
          height: SEARCH_ROWS,
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
          placeholder="Search functions…"
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

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sortLabel={functions ? `${functions.length} functions` : ""}
        width={width}
        anchorTop={SEARCH_ROWS}
        onProjectChange={state.setSelectedProjects}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      <FlamegraphNote width={inner} />

      <DataTable
        rows={functions}
        columns={COLUMNS}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(fn) => fn.fingerprint}
        loading={isInitialLoad(status)}
        error={error}
        errorTitle="Failed to load profiled functions"
        // The function name is what the table is for, so it keeps a readable
        // run and the package or project sheds first when the pane narrows.
        minFlex={MIN_FUNCTION_WIDTH}
        onRowClick={activateRow}
        empty={{
          title: "No profiled functions found.",
          lines: [
            query || undefined,
            "Try widening the time range or selecting a project that sends profiles.",
            "This organization may not have profiling enabled.",
          ],
        }}
        layout={[height, showDetail]}
      />

      {showDetail && selected ? <FunctionDetail fn={selected} width={inner} /> : null}
    </box>
  );
}

/** The standing note where the web draws its aggregate flamegraph. */
function FlamegraphNote({ width }: { width: number }) {
  return (
    <box
      style={{
        flexDirection: "column",
        width,
        flexShrink: 0,
        border: ["bottom"],
        borderColor: theme.border,
      }}
    >
      <text fg={theme.subText} attributes={BOLD}>
        {fitText(FLAMEGRAPH_HEADING, width)}
      </text>
      {FLAMEGRAPH_NOTE.map((line) => (
        <text key={line} fg={theme.muted}>
          {fitText(line, width)}
        </text>
      ))}
    </box>
  );
}

/** Detail panel for the function under the cursor. */
function FunctionDetail({ fn, width }: { fn: ProfileFunction; width: number }) {
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
        {"▾ Function Details"}
      </text>
      <text fg={theme.text}>{fitText(fn.name, width)}</text>
      <text fg={theme.muted}>{fitText(`  Package: ${fn.package || "—"}`, width)}</text>
      <text fg={theme.muted}>
        {fitText(
          `  Project: ${fn.projectSlug ?? "—"}  │  Calls: ${formatCount(fn.count)}` +
            `  │  Self time: ${formatNanoseconds(fn.totalSelfTimeNs)}` +
            `  │  p75: ${formatNanoseconds(fn.p75SelfTimeNs)}`,
          width,
        )}
      </text>
    </box>
  );
}

/**
 * Nanoseconds in the largest unit that keeps three significant figures, the
 * way the web's `PerformanceDuration` renders a profile duration.
 *
 * An absent value is `··`, matching `formatCount` — not yet fetched rather
 * than zero.
 */
export function formatNanoseconds(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "··";
  if (value < 1_000) return `${Math.round(value)}ns`;
  if (value < 1_000_000) return `${trim(value / 1_000)}µs`;
  if (value < 1_000_000_000) return `${trim(value / 1_000_000)}ms`;
  return `${trim(value / 1_000_000_000)}s`;
}

/** Two decimals under ten, one under a hundred, none above — three figures. */
function trim(value: number): string {
  const places = value < 10 ? 2 : value < 100 ? 1 : 0;
  const fixed = value.toFixed(places);
  // Only a fractional part may be trimmed: stripping trailing zeros from an
  // integer would turn 1000ms into 1ms.
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}
