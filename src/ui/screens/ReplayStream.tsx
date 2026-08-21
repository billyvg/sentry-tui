/**
 * Explore › Replays — the org's session recordings.
 *
 * Mirrors `views/explore/replays/list/`: a search bar, the shared filter row,
 * and a two-line table whose leading cell is the composite "Session" badge
 * (`components/replays/replayBadge.tsx`) — who, which project, which replay,
 * and when.
 *
 * The web picks one of four column sets by container width
 * (`useReplayIndexTableColumns.tsx`). A terminal is narrower than its widest
 * breakpoint at any realistic size, so the set the web shows below 800px is
 * what a terminal normally gets; the extra columns are declared with a
 * `priority` and come back when the pane is wide enough to hold them.
 *
 * Playback is out of scope — a video does not survive a character grid — so
 * the detail view says so and prints the URL instead.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { RenderableEvents, type InputRenderable } from "@opentui/core";

import {
  formatAgent,
  formatReplayDuration,
  replayUrl,
  shortReplayId,
  type Replay,
  type ReplayError,
} from "~/api/replays";
import { elapsedMs, errorOf, isInitialLoad, valueOf } from "~/core/async";
import { REPLAY_DETAIL_STATE_KEY } from "~/core/screens";
import { theme } from "~/core/theme";
import { countLabel, timeAgo } from "~/lib/sparkline";
import { fitText, padText } from "~/lib/text";
import { DataTable, type Column } from "~/ui/components/DataTable";
import { FilterBar, SEARCH_ROWS } from "~/ui/components/FilterBar";
import { useElapsed } from "~/ui/hooks/useElapsed";
import { useProjects } from "~/ui/hooks/useProjects";
import { useReplayErrors, useReplays } from "~/ui/hooks/useReplays";
import { rowsOf, type ScreenState } from "~/ui/hooks/useScreenState";
import { useScreenActions } from "~/ui/hooks/useScreenActions";
import { BOLD } from "~/ui/lib/attributes";
import type { DetailContext, ScreenProps, ViewStackEntry } from "~/ui/screens/types";

/**
 * A replay plus the project slug the endpoint doesn't return.
 *
 * `/replays/` answers with `project_id` only, so the slug is resolved once per
 * page against the org's project list — the same mapping the saved-views
 * screen does, and the same one `useProjectFromId` does in the web.
 */
interface ReplayRow extends Replay {
  projectSlug?: string;
}

/** Segments in the activity bar, matching the web's ten-step `ScoreBar`. */
const ACTIVITY_STEPS = 10;

/**
 * Cells the Session column keeps before an optional column is shed instead.
 *
 * Protecting it is the whole purpose of the web's breakpoints: a session with
 * its name cut to "Alice Ngu…" is a worse row than one without a rage-click
 * count. Fifteen is the most the unsheddable columns leave at 80 terminal
 * cells, so raising it further would start dropping Errors instead.
 */
const MIN_SESSION_WIDTH = 15;

/**
 * The columns, and the order they are given up in.
 *
 * Session, OS, Browser, Duration and Errors are `WEB_MAX_800` — the set the
 * web keeps at its narrowest — so none of them are ever shed. Dead and rage
 * clicks go first and Activity second, which is the order the web's container
 * queries drop them in, read backwards.
 */
const COLUMNS: ReadonlyArray<Column<ReplayRow>> = [
  {
    key: "session",
    label: "Replay",
    width: "flex",
    render: (replay, selected, width) => {
      if (replay.isArchived) {
        return <text fg={theme.subText}>{padText("Deleted Replay", width)}</text>;
      }
      // The unread dot is the web's, moved out of the checkbox column that a
      // read-only table has no reason to draw.
      const marker = replay.hasViewed ? "  " : "● ";
      const name = replay.user.displayName ?? "Anonymous User";
      const nameWidth = width - marker.length;
      return (
        <>
          <text fg={theme.accent}>{marker}</text>
          {nameWidth > 0 ? (
            <text fg={theme.text} attributes={selected ? BOLD : 0}>
              {padText(name, nameWidth)}
            </text>
          ) : null}
        </>
      );
    },
  },
  {
    key: "os",
    label: "OS",
    width: 11,
    render: (replay, _selected, width) => (
      <text fg={theme.subText}>{padText(formatAgent(replay.os), width)}</text>
    ),
  },
  {
    key: "browser",
    label: "Browser",
    width: 11,
    render: (replay, _selected, width) => (
      <text fg={theme.subText}>{padText(formatAgent(replay.browser), width)}</text>
    ),
  },
  {
    key: "duration",
    label: "Duration",
    width: 8,
    align: "right",
    render: (replay, _selected, width) => (
      <text fg={theme.text}>
        {padText(formatReplayDuration(replay.durationSec), width, "right")}
      </text>
    ),
  },
  {
    // "Dead clicks" upstream; the count is what the column is for, and the
    // word fits where the phrase does not.
    key: "dead",
    label: "Dead",
    width: 5,
    align: "right",
    priority: 1,
    render: (replay, _selected, width) => (
      <CountCell value={replay.countDeadClicks} width={width} color={theme.warning} />
    ),
  },
  {
    key: "rage",
    label: "Rage",
    width: 5,
    align: "right",
    priority: 1,
    render: (replay, _selected, width) => (
      <CountCell value={replay.countRageClicks} width={width} color={theme.danger} />
    ),
  },
  {
    key: "errors",
    label: "Errors",
    width: 6,
    align: "right",
    render: (replay, _selected, width) => (
      <CountCell value={replay.countErrors} width={width} color={theme.danger} />
    ),
  },
  {
    key: "activity",
    label: "Activity",
    width: ACTIVITY_STEPS,
    priority: 2,
    render: (replay, _selected, width) => <ActivityBar score={replay.activity} width={width} />,
  },
];

export function ReplayStream({
  client,
  org,
  state,
  focused,
  width,
  height,
  reloadToken,
  pushView,
  registerActions,
  activateRow,
}: ScreenProps) {
  const { setEntries, setStatus, setOpenDropdown } = state;

  const query = state.committedQuery;
  const project = state.selectedProjects.length > 0 ? state.selectedProjects : undefined;
  const environment = state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined;

  const { replays } = useReplays(client, {
    org,
    query,
    statsPeriod: state.statsPeriod,
    project,
    environment,
    reloadToken,
  });

  const loading = replays.state === "loading";
  const since = replays.state === "loading" ? replays.since : undefined;
  const elapsed = useElapsed(loading, since);

  const fetched = valueOf(replays);
  const error = errorOf(replays);

  const projects = useProjects(client, org);
  const slugById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of projects) map.set(entry.id, entry.slug);
    return map;
  }, [projects]);

  const rows = useMemo(
    () =>
      fetched?.map((replay): ReplayRow => ({
        ...replay,
        projectSlug: replay.projectId ? slugById.get(replay.projectId) : undefined,
      })),
    [fetched, slugById],
  );

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);

  useEffect(() => {
    setStatus({
      loading,
      elapsedMs: elapsed ?? elapsedMs(replays, Date.now()),
      error: error?.message,
      noun: "replays",
    });
  }, [loading, elapsed, error, replays, setStatus]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  useScreenActions(registerActions, {
    open: (index) => {
      const row = rowsOf<ReplayRow>(state)[index];
      if (row) pushView(replayDetailView(row, state.statsPeriod, state.selectedEnvs));
    },
  });

  return (
    <box style={{ flexDirection: "column", width, height }}>
      <SearchInputPlaceholder state={state} width={width} placeholder="Search replays…" />

      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sortLabel={rows ? countLabel(rows.length, "replay") : ""}
        width={width}
        anchorTop={SEARCH_ROWS}
        onProjectChange={state.setSelectedProjects}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      <DataTable
        rows={rows}
        columns={COLUMNS}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(replay) => replay.id}
        loading={isInitialLoad(replays)}
        error={error}
        errorTitle="Failed to load replays"
        onRowClick={activateRow}
        renderDetail={renderSessionDetail}
        minFlex={MIN_SESSION_WIDTH}
        empty={{
          title: "No replays found.",
          lines: [
            query || undefined,
            "Try widening the time range or adjusting the query.",
            "This organization may not have session replay enabled.",
          ],
        }}
        layout={[height]}
      />
    </box>
  );
}

/**
 * The second line of a replay row: project, replay id, and how long ago the
 * session started — the lower half of the web's session badge.
 */
function renderSessionDetail(replay: ReplayRow, _selected: boolean, width: number) {
  const parts = [replay.projectSlug, shortReplayId(replay.id)].filter(Boolean);
  const started = timeAgo(replay.startedAt);
  if (started) parts.push(`${started} ago`);
  return <text fg={theme.muted}>{padText(`  ${parts.join(" · ")}`, width)}</text>;
}

/**
 * A count: dim at zero, coloured once there is something to look at, and an
 * em dash when the number is absent rather than zero — an archived replay
 * lost its counts along with its recording.
 */
function CountCell({
  value,
  width,
  color,
}: {
  value: number | undefined;
  width: number;
  color: string;
}) {
  const known = value !== undefined;
  return (
    <text fg={known && value > 0 ? color : theme.subText}>
      {padText(known ? String(value) : "—", width, "right")}
    </text>
  );
}

/**
 * The activity score as a bar, the way the web draws it.
 *
 * A 0-10 score in a numeric column would read as another count beside three
 * real ones; as a bar it reads as an intensity, which is what it is.
 */
function ActivityBar({ score, width }: { score: number | undefined; width: number }) {
  if (width <= 0) return null;
  if (score === undefined) return <text fg={theme.subText}>{padText("—", width)}</text>;
  const clamped = Math.max(0, Math.min(ACTIVITY_STEPS, Math.round(score)));
  const filled = Math.round((clamped / ACTIVITY_STEPS) * width);
  const empty = Math.max(0, width - filled);
  // Each half is emitted only when it has cells: an empty `<text>` still
  // claims a line, which would make a full or an empty bar a row taller than
  // its neighbours.
  return (
    <>
      {filled > 0 ? <text fg={theme.accent}>{"█".repeat(filled)}</text> : null}
      {empty > 0 ? <text fg={theme.border}>{"░".repeat(empty)}</text> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

/**
 * One replay's metadata and its errors, as a view on the stack.
 *
 * It carries a `stateKey`, so the app drives the error list's cursor and the
 * filter row exactly as it does a screen's. One key for every replay rather
 * than one per replay: reopening a detail reuses the slice instead of leaking
 * one per row.
 *
 * @param statsPeriod The window the parent list was fetched with — the replay
 *   was found inside it, so its errors are inside it too.
 */
function replayDetailView(
  replay: ReplayRow,
  statsPeriod: string,
  environments: string[],
): ViewStackEntry {
  return {
    id: `replay:${replay.id}`,
    label: shortReplayId(replay.id),
    stateKey: REPLAY_DETAIL_STATE_KEY,
    initialState: {
      statsPeriod,
      selectedEnvs: environments,
      selectedProjects: replay.projectSlug ? [replay.projectSlug] : [],
    },
    render: (ctx) =>
      ctx.state ? <ReplayDetail {...ctx} state={ctx.state} replay={replay} /> : null,
  };
}

/** Columns of the replay's error list. Title survives any width. */
const ERROR_COLUMNS: ReadonlyArray<Column<ReplayError>> = [
  {
    key: "time",
    label: "Time",
    width: 8,
    render: (event, _selected, width) => (
      <text fg={theme.muted}>{padText(clockOf(event.timestamp), width)}</text>
    ),
  },
  {
    key: "level",
    label: "Level",
    width: 5,
    priority: 1,
    render: (event, _selected, width) => (
      <text fg={event.level === "error" || event.level === "fatal" ? theme.danger : theme.muted}>
        {padText(event.level ?? "", width)}
      </text>
    ),
  },
  {
    key: "issue",
    label: "Issue",
    // Real short ids run to `JAVASCRIPT-2XYZ` and beyond; 14 clipped them.
    width: 16,
    priority: 2,
    render: (event, _selected, width) => (
      <text fg={theme.subText}>{padText(event.issue ?? "", width)}</text>
    ),
  },
  {
    key: "title",
    label: "Title",
    width: "flex",
    render: (event, _selected, width) => <text fg={theme.text}>{padText(event.title, width)}</text>,
  },
];

interface ReplayDetailProps extends DetailContext {
  state: ScreenState;
  replay: ReplayRow;
}

function ReplayDetail({
  client,
  org,
  state,
  replay,
  focused,
  width,
  height,
  reloadToken,
}: ReplayDetailProps) {
  const { setEntries, setStatus, setOpenDropdown } = state;

  const status = useReplayErrors(client, {
    org,
    replayId: replay.id,
    statsPeriod: state.statsPeriod,
    environment: state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined,
    // An archived replay has no count, and no recording for errors to attach
    // to either — treat it as the nothing it is rather than querying for it.
    count: replay.countErrors ?? 0,
    reloadToken,
  });

  const errors = valueOf(status);
  const error = errorOf(status);

  useEffect(() => {
    if (errors) setEntries(errors);
  }, [errors, setEntries]);

  useEffect(() => {
    setStatus({
      loading: status.state === "loading",
      error: error?.message,
      noun: "replay errors",
    });
  }, [status, error, setStatus]);

  const closeDropdown = useCallback(() => setOpenDropdown(null), [setOpenDropdown]);

  const inner = Math.max(20, width - 2);
  const name = replay.user.displayName ?? "Anonymous User";

  return (
    <box style={{ flexDirection: "column", width, height, paddingLeft: 1 }}>
      {/*
        The filter row is not decoration: the app routes P/E/D to whatever list
        is on screen, and a slice whose dropdown opens with nothing mounted to
        close it would swallow every key after it. It also does real work —
        the period bounds the error search, and project and environment scope
        it.
      */}
      <FilterBar
        client={client}
        org={org}
        openDropdown={state.openDropdown}
        selectedProjects={state.selectedProjects}
        selectedEnvs={state.selectedEnvs}
        statsPeriod={state.statsPeriod}
        sortLabel={errors ? countLabel(errors.length, "error") : ""}
        width={inner}
        // The filter row is this view's first row now that the app draws the
        // breadcrumb in the pane's border rather than the screen printing one.
        anchorTop={0}
        onProjectChange={state.setSelectedProjects}
        onEnvChange={state.setSelectedEnvs}
        onPeriodChange={state.setStatsPeriod}
        onDropdownClose={closeDropdown}
        onDropdownOpen={state.setOpenDropdown}
      />

      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text fg={theme.text} attributes={BOLD}>
          {fitText(name, Math.max(8, inner - 24))}
        </text>
        <text fg={theme.muted}>
          {fitText(`  ${replay.projectSlug ?? "—"} · ${timeAgo(replay.startedAt)} ago`, 24)}
        </text>
      </box>

      <Field label="Duration" value={formatReplayDuration(replay.durationSec)} width={inner} />
      <Field
        label="Platform"
        value={[formatAgent(replay.os), formatAgent(replay.browser)]
          .filter((part) => part !== "—")
          .join(" · ")}
        width={inner}
      />
      <Field
        label="Clicks"
        value={`${count(replay.countDeadClicks)} dead · ${count(replay.countRageClicks)} rage`}
        width={inner}
      />
      <Field
        label="Session"
        value={`${count(replay.countUrls)} urls · ${count(replay.countSegments)} segments · activity ${count(replay.activity)}`}
        width={inner}
      />
      <Field label="Release" value={replay.releases[0] ?? "—"} width={inner} />
      <Field label="URL" value={replay.urls[0] ?? "—"} width={inner} />

      {/*
        Playback is the one thing this screen cannot do: rrweb replays a DOM,
        and a DOM does not survive a character grid. Say so and hand over the
        link rather than approximating it.

        Two layout notes, both learned the hard way in a 20-row pane. The URL
        is split into fixed-width lines here rather than left to the renderer
        to soft-wrap, because two adjacent wrapping `<text>` nodes each report
        one line and paint two, so the second overwrites the tail of the
        first. And the whole note is one `flexShrink: 0` box, because bare
        text nodes are shrunk to nothing when the pane runs short — which had
        been dropping the sentence and leaving an unexplained URL behind.
      */}
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={theme.muted}> </text>
        <text fg={theme.subText}>
          {padText("Playback is not available in a terminal. Open it at:", inner)}
        </text>
        {chunk(replayUrl(org, replay.id), inner).map((line, index) => (
          <text key={index} fg={theme.accent}>
            {padText(line, inner)}
          </text>
        ))}
        <text fg={theme.muted}> </text>
      </box>

      <DataTable
        rows={errors}
        columns={ERROR_COLUMNS}
        width={width - 1}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(event) => event.id}
        loading={isInitialLoad(status)}
        error={error}
        errorTitle="Failed to load replay errors"
        empty={{ title: "No errors in this replay." }}
        layout={[height]}
      />
    </box>
  );
}

/** One `label  value` line of the metadata block, aligned on a fixed gutter. */
function Field({ label, value, width }: { label: string; value: string; width: number }) {
  const gutter = 10;
  return (
    <box style={{ flexDirection: "row", flexShrink: 0 }}>
      <text fg={theme.muted}>{padText(label, gutter)}</text>
      <text fg={theme.text}>{fitText(value || "—", Math.max(0, width - gutter))}</text>
    </box>
  );
}

/**
 * Split a string into lines of at most `width` cells.
 *
 * Hard-splits rather than word-wraps: the one caller is a URL, which has no
 * spaces to break at and must survive intact.
 */
function chunk(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  for (let start = 0; start < text.length; start += width) {
    lines.push(text.slice(start, start + width));
  }
  return lines.length > 0 ? lines : [""];
}

/** A count that may be absent — archived replays lost theirs with the recording. */
function count(value: number | undefined): string {
  return value === undefined ? "—" : String(value);
}

/** HH:MM:SS from an ISO timestamp, for the error list's time column. */
function clockOf(iso: string): string {
  if (!iso) return "--:--:--";
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return match?.[1] ?? (iso.slice(11, 19) || "--:--:--");
}

// ---------------------------------------------------------------------------
// Search input — provisional
// ---------------------------------------------------------------------------

/**
 * The bordered `/`-prefixed search box, kept local on purpose.
 *
 * This is the same widget the issue stream and the log stream each draw
 * inline, and it is being extracted into a shared
 * `src/ui/components/SearchInput.tsx` on the saved-queries branch. Rather than
 * add a third inline copy to the pile, it is isolated here behind the props
 * that component will take — `state`, `width`, `placeholder` — so adopting the
 * shared one is deleting this function and changing an import, not unpicking
 * markup from the middle of a screen.
 */
function SearchInputPlaceholder({
  state,
  width,
  placeholder,
}: {
  state: ScreenState;
  width: number;
  placeholder: string;
}) {
  const { focusSearch, handleSearchBlur } = state;
  const inputRef = useRef<InputRenderable>(null);

  // Sync native focus/blur (a mouse click, say) back to the app's search state.
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

  return (
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
        placeholder={placeholder}
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
  );
}
