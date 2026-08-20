# The screen contract

Reference for anyone building a screen from
[002-explore-dashboards-monitors.md](002-explore-dashboards-monitors.md). Phase 7.0 landed
the shell; this is what it gives you and what it expects back.

**The short version.** A screen is one file exporting one component that takes `ScreenProps`,
plus one line in `SCREEN_COMPONENTS`. It owns its fetch and its layout. The app owns
navigation, the key router, the status bar, the view stack, and the state your screen's rows
and filters live in.

```text
src/core/screens.ts             registry: id → group, item, kind, stateKey, defaults
src/ui/screens/registry.tsx     id → component (add your one line here)
src/ui/screens/types.ts         ScreenProps, ViewStackEntry, DetailContext, ScreenActions
src/ui/hooks/useScreenState.ts  the state slice a screen is handed
src/ui/components/DataTable.tsx column-spec table: header, rows, skeleton, empty, error
src/ui/lib/tableLayout.ts       column shedding, as a pure function
src/api/discover.ts             queryDiscover / queryDiscoverTimeseries
src/ui/lib/navSections.ts       dynamic nav sections and item badges
src/ui/hooks/useSecondaryNavExtras.ts  where you fetch those
```

The worked example is **Explore › Logs** (`src/ui/screens/LogStream.tsx`). Copy it.

---

## 1. Screen ids

Every nav item in `src/core/nav.ts` has exactly one entry in `SCREENS`, and
`scripts/nav-coverage.test.ts` fails if that stops being true. Ids are permanent — they key
screen state and the component map.

| Group          | Ids                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **issues**     | `issues.feed` · `issues.inbox` · `issues.errors-outages` · `issues.breached-metrics` · `issues.warnings` · `issues.configuration` · `issues.user-feedback` · `issues.recently-run` · `issues.all-views`       |
| **explore**    | `explore.traces` · `explore.logs` · `explore.metrics` · `explore.errors` · `explore.discover` · `explore.profiles` · `explore.replays` · `explore.releases` · `explore.conversations` · `explore.all-queries` |
| **dashboards** | `dashboards.all` · `dashboards.sentry-built`                                                                                                                                                                  |
| **monitors**   | `monitors.all` · `monitors.mine` · `monitors.error` · `monitors.metric` · `monitors.cron` · `monitors.uptime` · `monitors.mobile-build` · `monitors.alerts`                                                   |
| **settings**   | `settings.organization` · `settings.projects` · `settings.teams`                                                                                                                                              |

Built today: the eight query-backed `issues.*` ids (one issue stream each, under the query
`src/core/issueViews.ts` gives it), `issues.all-views` (the saved-search list), and
`explore.logs`. Everything else is `kind: "stub"` and renders the placeholder pane.

### `ScreenDef`

```ts
export type ScreenKind = "table" | "cards" | "grid" | "stub";

export interface ScreenDefaults {
  query?: string; // initial search query
  statsPeriod?: string; // initial period, e.g. "14d"
  sort?: SortOption; // initial sort
}

export interface ScreenDef {
  id: ScreenId;
  group: NavGroupId;
  item: string; // matches the nav label in nav.ts EXACTLY — it is the join key
  kind: ScreenKind;
  stateKey?: string; // screens sharing one share filter state; defaults to `id`
  defaults?: ScreenDefaults;
  openLabel?: string; // status-bar label for Enter; defaults to "open"
}
```

`kind` is descriptive, not aspirational: it says what the screen renders _now_. Change yours
from `"stub"` to `"table"` / `"cards"` / `"grid"` in the same commit that builds it. Nothing
routes on `kind` — the app renders whatever `SCREEN_COMPONENTS` has an entry for — so it is
documentation for humans and for a future layout decision, and it should not lie.

Lookups:

```ts
findScreen(group, item): ScreenDef | undefined  // for a destination that may not exist
screenFor(group, item): ScreenDef               // throws if unregistered
getScreen(id): ScreenDef
stateKeyOf(screen): string                      // screen.stateKey ?? screen.id
defaultsForStateKey(key): ScreenDefaults
navDestinations(): Array<{group, item}>         // every nav item, flattened
```

---

## 2. Registering a screen

Two edits, no third.

```tsx
// 1. src/core/screens.ts — flip the kind (and set defaults / stateKey if you need them)
s("explore.traces", "explore", "Traces", "table", EXPLORE_DISCOVER, DISCOVER_DEFAULTS),

// 2. src/ui/screens/registry.tsx — one line, in a flat object literal
"explore.traces": TraceTable,
```

`SCREEN_COMPONENTS` is deliberately one entry per line: six people are each adding one, and a
line each merges cleanly. Do not reformat it, group it, or sort it into sections.

```ts
export type ScreenComponent = (props: ScreenProps) => ReactNode;
export const SCREEN_COMPONENTS: Partial<Record<ScreenId, ScreenComponent>>;
```

(`ScreenComponent` rather than React's `ComponentType`, whose React 19 definition admits an
async component this renderer cannot draw.)

### Sibling screens: one config table, not one component each

Most of what is left to build is _n_ screens that differ only by configuration — four Explore
tables that are the same Discover query with different `field[]`, seven Monitors screens that
are one detector table with a different `type:` filter, two Dashboards lists that differ by a
query parameter. **Write those as one component plus a table of configs keyed by `ScreenId`,
not as n near-identical components.**

`src/core/issueViews.ts` is the pattern to copy, and the Issues screens are it working:

```ts
// src/core/issueViews.ts — the config table, keyed by the thing that varies.
export const ISSUE_VIEWS: readonly IssueView[] = [
  { label: "Feed", query: DEFAULT_QUERY, description: "…" },
  { label: "Warnings", query: categoryQuery([…]), description: "…" },
  …
];
export function getIssueView(label: string): IssueView | undefined;
```

```ts
// src/core/screens.ts — the registry derives its entries from that table rather
// than restating the queries, so the two can't drift.
const ISSUE_SCREENS: readonly ScreenDef[] = ISSUE_VIEWS.map((view) => ({
  id: ISSUE_VIEW_IDS[view.label]!,
  group: "issues",
  item: view.label,
  kind: "table",
  defaults: { query: view.query, sort: view.sort, statsPeriod: DEFAULT_STATS_PERIOD },
}));
```

```tsx
// src/ui/screens/registry.tsx — one line each, all pointing at one component.
"issues.feed": IssueFeed,
"issues.warnings": IssueFeed,
```

```tsx
// The component reads its config from the screen it was handed.
export function IssueFeed(props: ScreenProps) {
  const view = getIssueView(props.screen.item);
  …
}
```

Three properties are worth the small ceremony: the config lives in `core/` where it can be
unit-tested without a renderer (`src/core/issueViews.test.ts` asserts every nav label has a
view); `defaults` in the registry are _derived_, so a query is written once; and the runtime
lookup is by `props.screen`, so the component never learns which of its siblings it is by any
route other than the registry.

Key your table by `ScreenId` rather than by nav label unless, like Issues, the label is
already the natural key — an id can't be broken by a copy edit to the sidebar. For Monitors,
that table is the `type:` filter per screen; for the Explore tables it is `{dataset, fields,
sort}`; for Dashboards it is the query parameter. **The base filter that distinguishes a
sibling belongs in that table, never in screen state** — screen state is the user's filters,
and siblings often share a slice.

---

## 3. `ScreenProps`

```ts
export interface ScreenProps {
  /** Authenticated API client, or null before sign-in. */
  client: SentryClient | null;
  /** The open organization slug. Every fetch must take it as a dependency. */
  org: string;
  /** The registry entry being rendered — its id, kind, and defaults. */
  screen: ScreenDef;
  /** This screen's slice of app state: rows, cursor, filters, search. */
  state: ScreenState;
  /** The content pane holds focus. Paint the cursor only when it does. */
  focused: boolean;
  /** Cells available inside the content pane's border. */
  width: number;
  /** Lines available inside the content pane's border. */
  height: number;
  /** Bump to refetch the current query — the app's global refresh. */
  reloadToken: number;
  /** Row ids with a mutation in flight, for a pending marker. */
  pendingIds: ReadonlySet<string>;
  /** Push a detail view; Escape pops it. */
  pushView: (view: ViewStackEntry) => void;
  /** Say something in the status bar. It clears itself after a few seconds. */
  notify: (notice: Notice) => void;
  /**
   * A row was clicked: move the cursor there, and open it if it was already
   * the cursor row. Wire a table's `onRowClick` straight to this.
   */
  activateRow: (index: number) => void;
  /**
   * Tell the app what Enter does on this screen. Call it through
   * `useScreenActions`, which handles registering and unregistering.
   */
  registerActions: (actions: ScreenActions | null) => void;
}
```

Notes on the ones that surprise people:

- **`org`, `reloadToken`.** Both must be dependencies of your fetch effect. The org picker
  repoints the whole app at another organization; `R` is the only refresh (**never poll** —
  `events/` rate limits are undocumented per dataset).
- **`width` / `height`** are the pane's interior, already minus the nav rail, the secondary
  nav if it is open, and the border. Lay out against them; do not read the terminal size.
- **`pendingIds`** only ever has anything in it on the issue screens today — everything else
  in this plan is read-only.
- **`notify`** takes a `Notice` (`{kind: "idle" | "loading" | "success" | "warning" | "error" | "info", text}`).
  Notice text is lower case: the bar is the app talking under its breath. Do not use it for
  load state — that comes from `state.status`.

### Keyboard: what you own and what you don't

The app's key router (`src/ui/App.tsx`) already handles, for whatever screen is mounted:

| Key                                 | Effect                                                        |
| ----------------------------------- | ------------------------------------------------------------- |
| `j` / `k` / `g` / `G`               | Move `state.selected`, clamped to `state.entries.length`      |
| `Enter`                             | Calls the `open` action you registered, with the cursor index |
| `/`                                 | `state.focusSearch()`; Enter submits, Escape reverts          |
| `P` / `E` / `D`                     | Opens the project / environment / date dropdown               |
| `R`, `?`, `q`, `o`, `ctrl+k`, `Tab` | Refresh, help, quit, org picker, palette, focus               |
| `Escape`                            | Your `back` action first, then pops the view stack            |

So a screen registers one or two things:

```tsx
useScreenActions(props.registerActions, {
  open: (index) => {
    const row = rowsOf<Detector>(props.state)[index];
    if (row) props.pushView(detectorView(row));
  },
});
```

```ts
export interface ScreenActions {
  /** Enter, or a second click on the cursor row. */
  open?: (index: number) => void;
  /** Escape, before the app claims it. Return true if you used it. */
  back?: () => boolean;
}
```

Register no `open` and Enter falls through and does nothing. `back` is for a screen with
something of its own to close — the log stream's Enter toggles an inline detail panel rather
than pushing a view, so its `back` closes the panel and returns true, and only once there is
nothing to close does Escape mean what it usually means.

An inline panel like that belongs in `state.detailOpen` rather than a `useState`, so the
status bar can name the key that closes it: it prints `close` while the panel is open and
`screen.openLabel` (default `"open"`) when it isn't.

### Pushing a view

```ts
export interface ViewStackEntry {
  id: string; // unique within the stack; also the React key
  label?: string; // status-bar text while this view is on top
  issue?: Group; // set only for issue detail — it scopes the triage keys
  stateKey?: string; // give it one and it behaves like a screen; see below
  initialState?: ScreenStateSeed; // filters the slice starts from
  render: (ctx: DetailContext) => ReactNode;
}

/** Everything a screen gets, minus the registry entry it hasn't got. */
export interface DetailContext extends Omit<ScreenProps, "screen" | "state"> {
  issue?: Group;
  state?: ScreenState; // present exactly when the entry declared a stateKey
}
```

The entry carries its own renderer, so `App.tsx` never learns what a monitor detail looks
like. Draw with `ctx.width` / `ctx.height`, not the values captured at push time — the
secondary nav changes the pane's width. Escape pops; navigating anywhere clears the stack.

**A view with a `stateKey` is a screen in all but name.** It gets a slice of its own, and the
app drives its cursor, its search bar and its filters exactly as it does a screen's, handing
the slice back through `ctx.state`. Without one, the view is a static detail pane: no cursor,
no filters, and the status bar shows its `label` and the detail hints instead.

That is the shape for a detail screen you can move around in — the dashboard widget grid,
where `j`/`k` step between widgets, or a monitor's detail. `initialState` is applied when the
view is pushed, so it opens on its own filters rather than a frame of whatever the slice held
before. `Issues › All Views` is the worked example: opening a saved search pushes its results
as a stateful view.

```tsx
props.pushView({
  id: `saved-view:${row.view.id}`,
  label: row.view.name,
  stateKey: SAVED_VIEW_STATE_KEY,
  initialState: {
    query: row.view.query,
    sort: row.view.querySort,
    statsPeriod: row.statsPeriod,
    selectedProjects: row.projectSlugs,
    selectedEnvs: row.view.environments,
  },
  render: (ctx) => (ctx.state ? <IssueStreamView {...ctx} state={ctx.state} /> : null),
});
```

Pick a `stateKey` that is _not_ a screen id — one constant per kind of view, so reopening the
same kind reuses one slice rather than leaking one per row.

---

## 4. `useScreenState` and `stateKey`

The app calls `useScreenState(screen)` once and hands your screen the slice for the key it
resolves to. Screens are unmounted when you navigate away, but their slice is not — that is
what makes filters, the cursor, and the scroll offset survive a round trip.

```ts
interface ScreenState {
  key: string;
  entries: readonly unknown[]; // your rows; read them through rowsOf<T>(state)
  selected: number; // cursor index
  status: ScreenStatus; // { loading, elapsedMs?, error?, noun? }
  openDropdown: FilterDropdownType; // "project" | "env" | "date" | null
  selectedProjects: string[];
  selectedEnvs: string[];
  statsPeriod: string;
  searchQuery: string; // live input value
  committedQuery: string; // what Enter last submitted — fetch with THIS
  searchFocused: boolean;
  queryBeforeEdit: string; // what Escape reverts to; the app maintains it

  setEntries: (
    next: readonly unknown[] | ((previous: readonly unknown[]) => readonly unknown[]),
  ) => void;
  setSelected: (next: number | ((previous: number) => number)) => void;
  setStatus: (next: ScreenStatus) => void;
  setOpenDropdown: (next: FilterDropdownType) => void;
  setSelectedProjects: (next: string[]) => void;
  setSelectedEnvs: (next: string[]) => void;
  setStatsPeriod: (next: string) => void;
  setSort: (next: SortOption) => void;
  setDetailOpen: (next: boolean | ((previous: boolean) => boolean)) => void;
  setSearchQuery: (next: string) => void;
  focusSearch: () => void;
  submitSearch: () => void;
  cancelSearch: () => void;
  handleSearchBlur: () => void;
}
```

Rules that matter:

- **Every setter identity is stable for the life of the app.** List them in an effect's
  dependency array freely — that is the point. `state` itself is a fresh object each change,
  so depend on the setters, not on `state`.
- **Fetch with `committedQuery`, render the input from `searchQuery`.** They differ while
  someone is typing; issuing a request per keystroke is what the split exists to prevent.
- **`setEntries` clamps the cursor** to the new length, so a refresh that returns fewer rows
  cannot leave the cursor past the end. Use the updater form for an edit that races a fetch.
- **`setStatus` is compared field by field**, so calling it every render with an equal status
  is free. Set `noun` — the status bar renders `loading ${noun}…`, so `noun: "traces"` reads
  as "loading traces…".
- **`rowsOf<T>(state)`** is the one sanctioned cast from `readonly unknown[]` to your row
  type. `entries` is untyped because the app has to count rows for a cursor it cannot type.

### Sharing

`stateKey` groups screens onto one slice. What's shared today:

| Key                  | Screens                                                          | Why                                                         |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `explore.discover`   | traces, logs, metrics, errors, discover, profiles, conversations | Same `events/` call — filters should follow you across them |
| `monitors.detectors` | all, mine, error, metric, cron, uptime, mobile-build             | One detector table with a different `type:` filter          |
| `dashboards.list`    | all, sentry-built                                                | One list with a different filter                            |

The `issues.*` screens deliberately do **not** share: each is a different query, so one slice
would collapse them all into whichever was opened last.

Two consequences to plan around:

1. **The `type:` filter that distinguishes your screen is not screen state.** Derive it from
   `props.screen.id` and append it to `committedQuery` when you build the request. `Monitors ›
Cron` and `Monitors › Uptime` share the user's typed query and project filter; they must
   not share the base filter, because that is what makes them different screens.
2. **Defaults come from the first screen in `SCREENS` order that uses the key**, so a shared
   slice starts the same way whichever screen you open first. `nav-coverage.test.ts` enforces
   that screens sharing a key declare identical defaults. `explore.discover` starts on
   `statsPeriod: "1h"` — deliberately short, since a terminal wants a fast first paint, and it
   is also what **Conversations** needs (the web pins it to 24h "to avoid slow loads"). If
   your screen genuinely needs a different default period, drop it out of the shared key
   rather than changing the shared default for six other screens.

---

## 5. `DataTable`

```ts
export interface Column<T> {
  key: string; // stable identity, and the React key
  label: string; // header text
  width: number | "flex"; // fixed cells, or share what the fixed ones leave
  align?: "left" | "right";
  /** Draw the cell. It MUST occupy exactly `width` cells — use padText(v, width, align). */
  render: (row: T, selected: boolean, width: number) => ReactNode;
  /** Shed order: the lowest priority goes first. No priority = never shed. */
  priority?: number;
}
```

`render` takes the resolved width as a third argument — a flex column cannot know it any other
way. Every cell is drawn inside a fixed-width clipping box, so a `render` that ignores its
width is truncated rather than pushing the row off the pane; the columns will still be
misaligned, so pad honestly.

```ts
export interface DataTableProps<T> {
  rows: readonly T[] | undefined; // undefined = nothing has arrived yet
  columns: readonly Column<T>[];
  width: number; // the table's width, scrollbar gutter included
  selectedIndex: number; // state.selected
  focused: boolean;
  rowKey: (row: T, index: number) => string;
  loading?: boolean; // pass isInitialLoad(status): rows===undefined && loading → skeleton
  error?: AsyncError;
  onRowClick?: (index: number, row: T) => void; // wire to props.activateRow
  renderDetail?: (row: T, selected: boolean, width: number) => ReactNode; // the second line
  separator?: boolean; // a rule under each row
  skeletonRows?: number; // default 20
  empty?: { title: string; lines?: ReadonlyArray<string | undefined> };
  errorTitle?: string; // e.g. "Failed to load monitors"
  gap?: number; // cells between columns, default 1
  gutter?: number; // cells reserved for the scrollbar, default 2
  layout?: readonly unknown[]; // values that change the viewport height
}
```

- **Two-line rows**: pass `renderDetail`. Replays' composite Session cell and the detector
  row's `│`-separated detail line are exactly this. Row height becomes
  `1 + (renderDetail ? 1 : 0) + (separator ? 1 : 0)`, and the skeleton follows automatically —
  `rowHeightOf({renderDetail, separator})` is exported if you need the number.
- **Skeleton geometry** is generated from the same resolved columns as a real row, which is
  what makes it hold position when the data lands. `test/dataTable.test.tsx` asserts the two
  render ink on identical lines at identical offsets; check yours by hand with
  `SENTRY_TUI_LATENCY=3000 bun run start`.
- **Empty copy is yours.** Half the Explore screens sit behind org feature flags we cannot
  read, so an empty result may mean "not enabled" rather than "no results" — say both, as
  Logs does.
- **Shedding**: `layoutColumns(columns, available, {gap, minFlex})` in
  `src/ui/lib/tableLayout.ts` is pure and unit-tested. It drops the lowest `priority` first
  (rightmost on a tie) until the row fits, and guarantees `sum(widths) + gaps <= available` at
  any width, so nothing can overflow or wrap. Give the columns the web sheds first the lowest
  numbers; leave `priority` off the ones that make the row worth reading.
- **The cursor is yours to render, not to move.** `App` owns `j`/`k`; `DataTable` paints the
  selection and scrolls it into view.

---

## 6. `queryDiscover`

```ts
queryDiscover(client, {
  org, dataset, fields, sort?, query?, statsPeriod?,
  project?, environment?, cursor?, limit?, referrer?, signal?,
}): Promise<{ rows: DiscoverRow[]; nextCursor: string | null }>

queryDiscoverTimeseries(client, {
  org, dataset, yAxis?, query?, statsPeriod?,
  project?, environment?, referrer?, signal?,
}): Promise<TimeseriesBucket[]>   // feeds <BarChart buckets={…} />
```

`DiscoverRow` is `Record<string, unknown>` — the endpoint returns whatever fields you asked
for, flat. Reshape it into a domain type in `src/api/`, next to the screen's other API code,
using `rowString(row, field)` / `rowNumber(row, field)` rather than `String(row.x)`: both
return `undefined` for missing or empty values instead of the string `"undefined"`.
`src/api/logs.ts` is the whole pattern in 40 lines — fields, sort, `normalise`, done.

Both functions validate the envelope defensively (the endpoint answers `{data: [...]}`,
occasionally a bare array, and a malformed bucket would otherwise crash a render). Neither
polls, and neither should you.

---

## 7. Dynamic nav sections and badges

`useSecondaryNavExtras(client, org, group, reloadToken)` returns what the sidebar draws beyond
the static IA. It is wired end to end and returns nothing — filling it in is a change to that
one file.

```ts
interface NavItemSpec {
  label: string;
  badge?: string; // dim tag after the label, e.g. "NEW"
  target?: { group: NavGroupId; item: string }; // defaults to this group + label
}
interface NavSectionSpec {
  title?: string;
  items: readonly NavItemSpec[];
}
interface SecondaryNavExtras {
  sections: readonly NavSectionSpec[]; // appended below the static ones
  badges: Readonly<Record<string, string>>; // by item label: { Metrics: "NEW" }
}
```

Each section is drawn under its own rule, and its items join the `j`/`k` cursor list, so a
dynamic item behaves exactly like a static one. **Give a dynamic item a `target`** — a starred
query has no screen of its own, so point it at the screen that can run it
(`{group: "explore", item: "All Queries"}`). A target that is not a registered nav item
renders the placeholder pane rather than crashing, but you will have nowhere to put the id;
carrying a selected query through to a screen is not built yet and is your call to design.

Long labels are trimmed to the sidebar's width, badge included — you do not have to truncate.

---

## 8. Worked example: a Discover-backed table, end to end

**`src/api/traces.ts`** — the domain layer.

```ts
import type { SentryClient } from "~/api/client";
import { queryDiscover, rowNumber, rowString, type DiscoverRow } from "~/api/discover";

export interface Span {
  id: string;
  name: string;
  description: string;
  durationMs?: number;
  transaction: string;
  timestamp: string;
}

/** Default fields, from `spansQueryParams.tsx:186-195`. */
const SPAN_FIELDS = [
  "id",
  "span.name",
  "span.description",
  "span.duration",
  "transaction",
  "timestamp",
] as const;

export async function listSpans(
  client: SentryClient,
  params: {
    org: string;
    query?: string;
    statsPeriod?: string;
    project?: string[];
    environment?: string[];
    signal?: AbortSignal;
  },
): Promise<Span[]> {
  const page = await queryDiscover(client, {
    ...params,
    dataset: "spans",
    fields: SPAN_FIELDS,
    sort: "-timestamp",
    referrer: "sentry-tui.traces",
  });
  return page.rows.map(normalise);
}

function normalise(row: DiscoverRow, index: number): Span {
  return {
    id: rowString(row, "id") ?? String(index),
    name: rowString(row, "span.name") ?? "",
    description: rowString(row, "span.description") ?? "",
    durationMs: rowNumber(row, "span.duration"),
    transaction: rowString(row, "transaction") ?? "",
    timestamp: rowString(row, "timestamp") ?? "",
  };
}
```

**`src/ui/screens/TraceTable.tsx`** — the screen. (Fetch through a hook shaped like
`useLogs`: `AsyncStatus`, an `AbortController` per request, `reloadToken` in the deps.)

```tsx
const COLUMNS: ReadonlyArray<Column<Span>> = [
  {
    key: "id",
    label: "Span ID",
    width: 9,
    render: (s, _sel, w) => <text fg={theme.muted}>{padText(s.id.slice(0, 8), w)}</text>,
  },
  {
    key: "name",
    label: "Name",
    width: 18,
    priority: 3,
    render: (s, _sel, w) => <text fg={theme.text}>{padText(s.name, w)}</text>,
  },
  {
    key: "description",
    label: "Description",
    width: "flex",
    render: (s, _sel, w) => <text fg={theme.muted}>{padText(s.description, w)}</text>,
  },
  {
    key: "duration",
    label: "Duration",
    width: 10,
    align: "right",
    priority: 4,
    render: (s, _sel, w) => (
      <text fg={theme.text}>{padText(formatMs(s.durationMs), w, "right")}</text>
    ),
  },
  {
    key: "time",
    label: "Time",
    width: 8,
    priority: 2,
    render: (s, _sel, w) => <text fg={theme.muted}>{padText(clock(s.timestamp), w)}</text>,
  },
];

export function TraceTable({
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
  const { setEntries, setStatus } = state;
  const { spans } = useSpans(client, {
    org,
    query: state.committedQuery,
    statsPeriod: state.statsPeriod,
    project: state.selectedProjects.length > 0 ? state.selectedProjects : undefined,
    environment: state.selectedEnvs.length > 0 ? state.selectedEnvs : undefined,
    reloadToken,
  });

  const rows = valueOf(spans);
  const error = errorOf(spans);

  useEffect(() => {
    if (rows) setEntries(rows);
  }, [rows, setEntries]);
  useEffect(() => {
    setStatus({ loading: spans.state === "loading", error: error?.message, noun: "spans" });
  }, [spans, error, setStatus]);

  useScreenActions(registerActions, {
    open: (i) => {
      /* pushView(spanView(rowsOf<Span>(state)[i])) */
    },
  });

  return (
    <box style={{ flexDirection: "column", width, height }}>
      {/* search input + <FilterBar/> + <BarChart/>, as LogStream does */}
      <DataTable
        rows={rows}
        columns={COLUMNS}
        width={width}
        selectedIndex={state.selected}
        focused={focused}
        rowKey={(span) => span.id}
        loading={isInitialLoad(spans)}
        error={error}
        errorTitle="Failed to load spans"
        onRowClick={activateRow}
        empty={{
          title: "No spans found.",
          lines: [
            state.committedQuery || undefined,
            "Try widening the time range or adjusting the query.",
          ],
        }}
        layout={[height]}
      />
    </box>
  );
}
```

Then the two registration edits from §2, and:

```bash
bun run check          # format, lint, typecheck, boundaries, and every test
SENTRY_TUI_LATENCY=3000 bun run start   # skeleton must not shift when data lands
```

Plus a resize to 80, 100, and 140 columns to watch your `priority` order shed the way the
web's container queries do.

---

## Things that will bite you

- **`item` must match the nav label byte for byte**, `&` and all (`"Errors & Outages"`).
  `nav-coverage.test.ts` is what tells you when it doesn't.
- **Import boundaries** are enforced: `lib → api → core → ui`, checked by `bun run deps:check`
  against a shrink-only baseline. API code must not import from `core/` or `ui/`.
- **Screen state outlives your component.** Anything in `entries` survives navigation, so a
  screen that assumes it mounts with an empty list is wrong. It is also `unknown[]` — if two
  screens share a `stateKey`, they must agree on the row type.
- **Do not add a `useKeyboard` to a screen.** The app's router owns key ownership
  (`src/ui/lib/keyRouting.ts`); a second global listener will fight it. If you need a key the
  router doesn't offer, add it to `core/commands.ts` and route it in `App`, once.
- **The issue stream is not a `DataTable`.** It predates one, and its four-line row with its
  own column shedding lives in `src/ui/components/IssueRow.tsx`. That is history, not a second
  sanctioned pattern: build new tables on `DataTable`, and do not copy `resolveRowLayout`.
  Folding the issue row into a `DataTable` row is worth doing one day, and is deliberately not
  part of 7.0 — it would have meant changing behavior in a refactor whose whole claim is that
  it changes none.
- **`rowsOf<T>` is an unchecked cast.** Nothing verifies that the rows in a slice are the type
  you asked for, so two screens sharing a `stateKey` and disagreeing about the row type fails
  at the first property access, not at the boundary.
- **Read-only.** No mutation endpoints. Triage on issues is the only write in the app.
