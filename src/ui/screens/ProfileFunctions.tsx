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

import {
  PROFILE_FUNCTION_SORT_OPTIONS,
  profileFunctionSort,
  type ProfileFunction,
} from "~/api/profileFunctions";
import { errorOf, isInitialLoad, loadingSince, valueOf } from "~/core/async";
import { useTheme } from "~/ui/theme";
import type { Theme } from "~/core/theme";
import { formatCount } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { ResultFooter } from "~/ui/components/ResultFooter";
import { SearchInputHint } from "~/ui/components/SearchInputHint";
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
function profileColumns(theme: Theme): ReadonlyArray<Column<ProfileFunction>> {
  return [
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
        <text fg={theme.text}>
          {padText(formatNanoseconds(fn.totalSelfTimeNs), width, "right")}
        </text>
      ),
    },
  ];
}

export function ProfileFunctions({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  onProjectSelect,
  registerActions,
  activateRow,
}: ScreenProps) {
  const theme = useTheme();
  const { dispatch, focusSearch, handleSearchBlur } = state;
  const inputRef = useRef<InputRenderable>(null);

  /**
   * PLACEHOLDER, awaiting `src/ui/components/SearchInput.tsx`.
   *
   * The saved-queries branch is extracting the bordered `/`-prefixed input out
   * of `LogStream` into a shared component. Whichever of the two lands second
   * deletes this callback and the box that uses it and renders that component
   * instead — nothing else in this file touches `inputRef`.
   *
   * Left working rather than stubbed out: `committedQuery` is what the
   * function list is fetched with, so a placeholder that couldn't commit a
   * query would take the filter away with it.
   *
   * Syncs native focus/blur (a mouse click) back to the app's search state.
   */
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
  const sort = profileFunctionSort(state.sort);

  const { functions: status, nextCursor } = useProfileFunctions(client, {
    org,
    query,
    statsPeriod: state.statsPeriod,
    project: state.selectedProjects.length > 0 ? state.selectedProjects : undefined,
    environment: state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined,
    sort,
    reloadToken,
  });

  const loading = status.state === "loading";
  const since = loadingSince(status);

  const functions = valueOf(status);
  const error = errorOf(status);

  useEffect(() => {
    if (functions) dispatch({ type: "setEntries", payload: functions });
  }, [functions, dispatch]);

  useEffect(() => {
    dispatch({
      type: "setStatus",
      payload: {
        loading,
        since,
        error: error?.message,
        noun: "functions",
      },
    });
  }, [loading, since, error, status, dispatch]);

  const closeDropdown = useCallback(
    () => dispatch({ type: "setOpenDropdown", payload: null }),
    [dispatch],
  );

  /**
   * Enter opens the detail panel. A function's name and package are the two
   * columns most likely to be truncated — a mangled C++ symbol runs to
   * hundreds of characters — so the panel is where they are readable in full.
   */
  useScreenActions(registerActions, {
    open: () => dispatch({ type: "setDetailOpen", payload: (open) => !open }),
    back: () => {
      if (!state.detailOpen) return false;
      dispatch({ type: "setDetailOpen", payload: false });
      return true;
    },
  });

  const inner = Math.max(20, width - 2);
  const selected = functions?.[state.selected] ?? null;
  const showDetail = state.detailOpen && selected !== null;

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/* PLACEHOLDER: replaced by `SearchInput` — see `inputRefCallback` above. */}
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
        <SearchInputHint />
        <input
          ref={inputRefCallback}
          value={state.searchQuery}
          placeholder="Search functions…"
          focused={state.searchFocused}
          onInput={(query) => dispatch({ type: "setSearchQuery", payload: query })}
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
        sort={{
          value: sort,
          items: PROFILE_FUNCTION_SORT_OPTIONS,
          onChange: (value) => dispatch({ type: "setSort", payload: value }),
        }}
        width={width}
        anchorTop={SEARCH_ROWS}
        onProjectChange={onProjectSelect}
        onEnvChange={(envs) => dispatch({ type: "setSelectedEnvs", payload: envs })}
        onPeriodChange={(period) => dispatch({ type: "setStatsPeriod", payload: period })}
        onDropdownClose={closeDropdown}
        onDropdownOpen={(dropdown) => dispatch({ type: "setOpenDropdown", payload: dropdown })}
      />

      <FlamegraphNote width={inner} />

      <DataTable
        rows={functions}
        columns={profileColumns(theme)}
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
      <ResultFooter count={functions?.length} noun="function" hasMore={nextCursor !== null} />
    </box>
  );
}

/** The standing note where the web draws its aggregate flamegraph. */
function FlamegraphNote({ width }: { width: number }) {
  const theme = useTheme();
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
  const theme = useTheme();
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
