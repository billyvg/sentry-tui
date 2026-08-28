# The screen contract

This is the living reference for adding or changing a top-level screen. It
describes the current implementation, not a delivery roadmap.

All 30 static navigation destinations currently have registered components.
There are no stub destinations today, although `ScreenKind` keeps `"stub"` so
a future destination can be registered before its UI lands.

The main pieces are:

```text
packages/app/src/core/nav.ts                       static navigation groups and items
packages/app/src/core/screens.ts                   screen ids, metadata, state keys, defaults
packages/app/src/ui/screens/registry.tsx           screen id -> component
packages/app/src/ui/screens/types.ts               ScreenProps, ScreenActions, pushed views
packages/app/src/ui/hooks/useNavigation.ts         route, view stack, and active state slice
packages/app/src/ui/hooks/useScreenState.ts        reducer-managed state keyed by screen
packages/app/src/ui/hooks/useScreenActions.ts      action registration lifecycle
packages/app/src/ui/components/DataTable.tsx       shared table rendering and load states
packages/app/src/ui/lib/tableLayout.ts             responsive column shedding
packages/app/src/ui/lib/navSections.ts             static and dynamic secondary-nav items
packages/app/src/ui/hooks/useSecondaryNavExtras.ts dynamic per-organization nav sections
```

The source files above are authoritative. This document records the decisions
that are easy to miss when reading any one of them.

## Registry and routing

Every static item in `packages/app/src/core/nav.ts` has exactly one `ScreenDef` in
`packages/app/src/core/screens.ts`. `scripts/nav-coverage.test.ts` enforces both directions:
no nav item can be unregistered, and no registered screen can be unreachable.

The registered ids are:

| Group      | Screen ids                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues     | `issues.feed`, `issues.inbox`, `issues.errors-outages`, `issues.breached-metrics`, `issues.warnings`, `issues.configuration`, `issues.user-feedback`, `issues.recently-run`, `issues.all-views`      |
| Explore    | `explore.traces`, `explore.logs`, `explore.metrics`, `explore.errors`, `explore.discover`, `explore.profiles`, `explore.replays`, `explore.releases`, `explore.conversations`, `explore.all-queries` |
| Dashboards | `dashboards.all`, `dashboards.sentry-built`                                                                                                                                                          |
| Seer       | `seer.ask`                                                                                                                                                                                           |
| Monitors   | `monitors.all`, `monitors.mine`, `monitors.error`, `monitors.metric`, `monitors.cron`, `monitors.uptime`, `monitors.mobile-build`, `monitors.alerts`                                                 |

Ids are stable keys for screen state, component registration, navigation, and
direct URL routing. Do not rename one as part of a label change. Every screen
also owns a canonical production destination: a user must always be able to
continue the location in Sentry's web UI, and adding a screen without one is a
type error.

`ScreenDef` owns only routing metadata:

```ts
type ScreenKind = "table" | "cards" | "grid" | "chat" | "stub";

interface ScreenDefaults {
  query?: string;
  statsPeriod?: string;
  sort?: string;
}

interface ScreenDef {
  id: ScreenId;
  group: NavGroupId;
  item: string;
  kind: ScreenKind;
  production: { pathname: `/${string}`; query?: Record<string, string> };
  stateKey?: string;
  defaults?: ScreenDefaults;
  openLabel?: string;
}
```

`item` must match its label in `nav.ts` byte for byte. `kind` describes what
the component renders now; routing uses `SCREEN_COMPONENTS`, not `kind`.
`openLabel` changes the status-bar label for Enter, such as `details`, `expand`,
or the default `open`.

### Adding a top-level destination

1. Add the item to `packages/app/src/core/nav.ts` and its stable id to `ScreenId`.
2. Add its `ScreenDef` and canonical production route to `SCREENS`, including
   defaults and a state key only when they are intentional.
3. Implement a component taking `ScreenProps`, then add one entry to the flat
   `SCREEN_COMPONENTS` object.
4. Add focused tests for its configuration, API normalization, loading,
   empty, error, keyboard, and narrow-terminal behavior as applicable.
5. Run `bun run check` and perform the real-terminal smoke test required for
   rendering or interaction changes.

Keep `SCREEN_COMPONENTS` one entry per line. It is a `Partial` map so staged
stub work remains possible, which means typechecking alone does not prove a
component was registered.

### Sibling screens

Screens that differ only by a base query or endpoint option use one component
and a configuration table keyed by `ScreenId`:

| Screens                       | Configuration                                | Component       |
| ----------------------------- | -------------------------------------------- | --------------- |
| Issue views                   | `packages/app/src/core/issueViews.ts`        | `IssueFeed`     |
| Traces, Logs, Metrics, Errors | `packages/app/src/core/exploreTables.ts`     | `ExploreTable`  |
| Discover, All Queries         | `packages/app/src/core/savedQueryScreens.ts` | `SavedQueries`  |
| Dashboard lists               | `packages/app/src/core/dashboards.ts`        | `DashboardList` |
| Detector lists                | `packages/app/src/core/monitors.ts`          | `MonitorList`   |

The base filter that makes siblings different belongs in that configuration,
not in shared screen state. Prefer ids over labels as configuration keys unless
the label is already the domain's natural key, as it is for Issue views.

`App` keys registered components by `screen.id`. This remounts hook-local
request state when two routes reuse the same component, so rows and charts from
one sibling cannot appear while another sibling loads.

## Screen state

`useNavigation` resolves `stateKeyOf(screen)` and passes the active slice to the
screen. A slice survives navigation for the lifetime of the app, so filters,
search text, cursor position, and rows on an unshared key remain when the user
returns.

`ScreenState` contains:

- `entries`, `selected`, and `status` (`loading`, `since`, `error`, `noun`)
- `openDropdown`, `selectedProjects`, `selectedEnvs`, `statsPeriod`, and `sort`
- `detailOpen`
- `searchQuery`, `committedQuery`, `searchFocused`, and `queryBeforeEdit`
- stable `dispatch`, `focusSearch`, `submitSearch`, `cancelSearch`, and
  `handleSearchBlur` functions

Change ordinary fields through reducer actions:

```ts
state.dispatch({ type: "setSelected", payload: index });
state.dispatch({ type: "setEntries", payload: rows });
state.dispatch({ type: "setStatus", payload: { loading, since, error, noun: "traces" } });
state.dispatch({ type: "setOpenDropdown", payload: "sort" });
```

`dispatch` and the search helpers are stable; the `state` object itself is not.
Depend on the individual values and `dispatch` in effects rather than on the
whole object.

Fetch with `committedQuery` and render the input from `searchQuery`. They differ
while the user edits, preventing a request per keystroke. `setEntries` clamps
the cursor when a result shrinks. `status.since` comes from `loadingSince` so
the status bar, rather than each screen, owns elapsed-time rendering.

Organization changes call `resetOrgScoped`: rows, cursor, pending UI,
environments, and inline details reset; query text and time ranges survive.
Use `props.onProjectSelect` for an ordinary screen's project filter so the
selection is also remembered for that organization. Stateful pushed views may
dispatch `setSelectedProjects` directly because their filter is local to the
view.

### Shared state keys

| Key                  | Screens                                                | Shared intent                                                  |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| `explore.events`     | Traces, Logs, Metrics, Errors, Profiles, Conversations | Discover-style project, environment, query, and period filters |
| `monitors.detectors` | All, Mine, Error, Metric, Cron, Uptime, Mobile Build   | Detector query and sort controls                               |
| `dashboards.list`    | All Dashboards, Sentry Built                           | Dashboard query and sort controls                              |

Issues do not share because each item owns a different query. Discover and All
Queries are saved-query lists over different endpoints and each keeps its own
slice. Releases and Replays also keep independent defaults and state.

A shared slice still has one `entries` slot, but every write is branded with
the active screen or pushed view id. A sibling sees an empty `state.entries`
until its own request writes, so the central cursor cannot act on stale rows;
`rowsOf(state)` additionally throws at the boundary with both owners named if
code tries to cast rows written by another source. Render and open rows from
the current request result (`valueOf` the hook status) when a screen needs to
keep stale data visible through a refresh.

Defaults for a shared key come from the first matching entry in `SCREENS`.
`scripts/nav-coverage.test.ts` rejects conflicting defaults and explicit state
keys that collide with screen ids.

## `ScreenProps` and keyboard actions

A registered component receives:

| Prop                           | Purpose                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `client`, `org`, `reloadToken` | API inputs; every fetch must react to organization and manual refresh changes |
| `screen`, `state`              | Registry metadata and the active reducer-managed slice                        |
| `focused`, `width`, `height`   | Content focus and usable pane dimensions                                      |
| `onProjectSelect`              | Apply and remember a screen-level project filter                              |
| `pendingIds`                   | Issue mutation ids that need a pending marker                                 |
| `pushView`                     | Open a detail or stateful child view                                          |
| `notify`                       | Show a short transient status-bar notice                                      |
| `activateRow`                  | First click selects; a second click on the focused row opens                  |
| `registerActions`              | Register the screen's keyboard behavior                                       |
| `updateView`                   | Update label or issue metadata learned after a direct detail load             |
| `navigateToScreen`             | Move to another registered screen, optionally seeding filters                 |

Use the supplied `width` and `height`; they already exclude the rail, secondary
navigation, border, and status bar. Do not read the terminal size in a screen.

The app centrally owns global commands, focus, search, filters, cursor movement,
and view-stack Escape behavior. A screen registers only the behavior specific
to its content through `useScreenActions`:

```ts
interface ScreenActions {
  open?: (index: number) => void;
  nextPage?: () => boolean;
  previousPage?: () => boolean;
  back?: () => boolean;
  inputFocused?: () => boolean;
  submitInput?: () => boolean;
  blurInput?: () => void;
  handleInputKey?: (key: KeyEvent) => boolean;
  handleKey?: (key: KeyEvent) => boolean;
}
```

`open` is Enter or a confirming second click. Pagination actions handle
PageDown/Ctrl+D and PageUp/Ctrl+U when a server cursor exists. `back` gets first
refusal on Escape, which is how inline detail panels close before the view
stack pops.

The input and custom-key actions are for screens such as Seer that own an input
or a body that is not an ordinary list. Do not add a screen-level
`useKeyboard`; extend the command catalog and the central router when a new
global key is needed.

## Pushed views

`ViewStackEntry` lets a screen define its detail without teaching `App` about
the detail's domain:

```ts
interface ViewStackEntry {
  id: string;
  label?: string;
  issue?: Group;
  stateKey?: string;
  initialState?: ScreenStateSeed;
  render: (ctx: DetailContext) => ReactNode;
}
```

A view without `stateKey` is a static detail pane. A view with one receives a
`ScreenState` through `ctx.state`, so cursor, search, filters, and the status bar
work as they do on a top-level screen. Use one non-screen key per kind of
stateful view, not one key per row. Current examples are saved-view results,
replay details, and dashboard details.

`initialState` is applied before the view opens. Use `ctx.width` and
`ctx.height`, not dimensions captured when the entry was created. A detail
loaded from a Sentry URL can call `updateView` when its real label or issue is
known. Navigating to another top-level screen clears the stack.

Dynamic nav items use the same mechanism: their `target` selects the parent
screen and their optional `open()` creates the view for the chosen saved query
or dashboard.

## Tables and asynchronous data

Use `DataTable` for conventional list screens. It owns the header, responsive
columns, scroll following, skeleton geometry, empty state, and terminal error
state. A `Column<T>` supplies a stable key, label, fixed or flex width, optional
alignment and shedding priority, and a renderer that respects its resolved
width.

Important table behavior:

- `rows: undefined` plus `loading` draws a skeleton; `rows: []` draws the empty
  state. Preserve that distinction.
- `renderDetail` adds a second line to every row and skeleton.
- `separator` adds a rule and is included in `rowHeightOf`.
- `minFlex` protects the column the table is primarily for before optional
  columns are shed.
- `layout` lists values that change viewport height, such as a chart or inline
  detail panel, so scroll following recalculates.
- `onRowClick` normally receives `props.activateRow`.

`layoutColumns` drops the lowest numeric priority first, breaking ties from the
right, then fits flex columns into what remains. Columns without a priority are
kept until the last-resort narrow-pane path. Cell renderers should use
`padText`; clipping prevents overflow but cannot make unpadded columns align.

The issue stream keeps its richer multi-line renderer in `IssueFeed` and
`IssueRow` rather than `DataTable`, but resolves its columns through the same
`layoutColumns` engine.

Screens own their fetch through a domain hook. New hooks should reuse
`useAsyncFetch`, which centralizes aborts, stale-result protection, and the
async lifecycle. Include `org`, committed filters, pagination cursor, and
`reloadToken` in the request identity. Requests are manual-refresh only; do not
poll Sentry endpoints.

Discover-style screens should build on `queryDiscover` and
`queryDiscoverTimeseries` in `packages/app/src/api/discover.ts`. The row endpoint returns
flat `Record<string, unknown>` values; normalize them in `packages/app/src/api/` with
`rowString` and `rowNumber` before rendering. `packages/app/src/api/exploreEvents.ts` and
`packages/app/src/ui/screens/ExploreTable.tsx` are the current generic pattern. Logs are a
smaller endpoint-specific example.

## Dynamic secondary navigation

`useSecondaryNavExtras(client, org, group, reloadToken)` currently supplies:

- Explore's Starred Queries section.
- Dashboards' Starred Dashboards section.

Each group-specific hook is called unconditionally with an `enabled` flag, then
selected in the return switch. This follows the Rules of Hooks while avoiding
requests for unopened sidebars. These background fetches degrade silently to
no extra section and refetch only on `reloadToken`.

`NavItemSpec` has a visible `label`, an optional registered `target`, and an
optional `open()` returning a `ViewStackEntry`. Dynamic items participate in
the same cursor order as static ones. Point them at the list screen Escape
should return to, then use `open()` when selecting the item must land directly
on its detail or results.

## Checklist

- Keep imports within the enforced `lib -> api -> core -> ui` direction.
- Match nav labels exactly, but key domain configuration by `ScreenId`.
- Brand shared rows through the supplied `state.dispatch`; `rowsOf(state)` is
  only valid for rows the active screen or view wrote.
- Never poll. Surface load state through `state.status` and preserve cached
  rows only when the hook intentionally does so.
- Exercise skeleton, empty, error, resize, cursor, click, Escape, refresh, and
  sibling-navigation behavior.
- Run `bun run check`; for rendering or interaction changes, also follow the
  real-terminal smoke-test instructions.
