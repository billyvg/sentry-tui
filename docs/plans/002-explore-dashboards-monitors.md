# Explore, Dashboards, and Monitors

## Context

[001-issues-and-foundation.md](001-issues-and-foundation.md) built the Issues path end to
end and left the other nav sections as a single honest stub. Today the app renders exactly
two real screens — the issue stream (plus detail and triage) and Explore › Logs — and every
other nav destination falls through to one placeholder pane at `src/ui/App.tsx:622`:

```tsx
<text>{`${getNavGroup(activeGroup).label} › ${activeItem}`}</text>
<text fg={theme.muted}>Not implemented yet.</text>
```

The nav already advertises **19 more destinations** across Explore (9 unbuilt of 10),
Dashboards (2), and Monitors (8). This plan scopes filling them in. Settings — the fourth
stubbed section — is deliberately left out; see **Deliberately out of scope**.

Layout truth is read from the real frontend at `../sentry/static/app/views/`. Every claim
below is cited to the file it came from, so it can be re-checked when Sentry's IA moves
again — which it does, roughly quarterly.

### Nav IA re-verified against the current source

`src/core/nav.ts` was derived from `views/navigation/navigation.tsx` during phase 1 and is
**still accurate** for the primary rail and for all three secondary navs. Two dynamic
sections are missing, and one label is conditional:

| Gap                                                                                                                | Source                                                               | Call                                                         |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Explore › **Starred Queries** — a dynamic section listing up to `MAX_STARRED_SAVED_QUERIES_IN_NAV` starred queries | `secondary/sections/explore/exploreSecondaryNavigation.tsx:169`      | Build it — cheap once `All Queries` fetches                  |
| Dashboards › **Starred Dashboards** — same shape, dynamic list under a separator                                   | `secondary/sections/dashboards/dashboardsSecondaryNavigation.tsx:79` | Build it                                                     |
| Explore › `Discover` renders as **"Errors"** when `getDiscoverDeprecation(organization)` is true                   | `exploreSecondaryNavigation.tsx:98`                                  | Ignore — a rollout flag we can't read; keep the static label |

Everything else — item order, section grouping, section titles (`By Monitor Type`), and the
absence of Alerts/Releases from the top level — matches what's already in `nav.ts`. No
changes needed there beyond the two dynamic sections.

---

## Phase 7.0 — Make the shell hold more than two screens

**This blocks everything else and should land first, on its own PR.**

`App.tsx` is 684 lines and holds every screen's state inline. The issue stream owns nine
pieces of state; Explore › Logs owns nine _more_, hand-duplicated with a `log` prefix:

```tsx
const [logEntries,        setLogEntries]        = useState<LogEntry[]>([]);   // App.tsx:98
const [logSelected,       setLogSelected]       = useState(0);
const [logStatus,         setLogStatus]         = useState<StreamStatus>(…);
const [logOpenDropdown,   setLogOpenDropdown]   = useState<FilterDropdownType>(null);
const [logSelectedProjects, setLogSelectedProjects] = useState<string[]>([]);
const [logSelectedEnvs,   setLogSelectedEnvs]   = useState<string[]>([]);
const [logStatsPeriod,    setLogStatsPeriod]    = useState(DEFAULT_LOG_PERIOD);
const [logSearchQuery,    setLogSearchQuery]    = useState<string>("");
const [logSearchFocused,  setLogSearchFocused]  = useState(false);
const [logCommittedQuery, setLogCommittedQuery] = useState<string>("");
```

Routing is two booleans (`showIssues`, `showLogs` — `App.tsx:114-115`), and the key handler
branches on them by hand:

```tsx
const setDropdown = showLogs ? setLogOpenDropdown : setOpenDropdown; // App.tsx:340
if (!showLogs) return "notMine"; // App.tsx:485
```

Repeating that shape 19 more times means ~200 `useState` calls in one component and a key
handler with a 19-way ternary at every branch. It will not survive this plan. Four
extractions fix it, and each one is a straight lift of code that already exists — no new
behavior, so the existing tests are the regression net.

**1. `src/core/screens.ts` — a screen registry.**

```ts
export type ScreenId = "issues.feed" | "explore.logs" | "explore.traces" | …;

export interface ScreenDef {
  id: ScreenId;
  group: NavGroupId;
  item: string;               // matches the nav label exactly
  kind: "table" | "cards" | "grid" | "stub";
  /** Screens sharing a `stateKey` share filter state — e.g. all Explore tables. */
  stateKey?: string;
}

export function screenFor(group: NavGroupId, item: string): ScreenDef;
```

Replaces `showIssues`/`showLogs` with `screen.id`. Anything still unbuilt resolves to
`kind: "stub"` and renders today's placeholder — so the registry can land complete, with
19 stubs, before any screen exists.

**2. `src/ui/hooks/useScreenState.ts` — per-screen state, keyed by `ScreenId`.**

One hook owning the ten fields above, stored in a `Map<ScreenId, ScreenState>` so filters,
cursor position, and scroll offset survive navigating away and back. This is behavior the
app doesn't have today — switching Issues → Logs → Issues resets nothing only because both
screens happen to be mounted.

**3. `src/ui/components/DataTable.tsx` — a column-spec-driven table.**

Lift from `LogStream.tsx:313-440`, which already has the header, skeleton, empty, and error
states in the right shape; generalize the hardcoded `COL_TIME`/`COL_SEVERITY`/`COL_PROJECT`
into a spec:

```ts
interface Column<T> {
  key: string;
  label: string;
  width: number | "flex";
  align?: "left" | "right";
  render: (row: T, selected: boolean) => ReactNode;
  /** Dropped first when the terminal is too narrow. Mirrors the web's container queries. */
  priority?: number;
}
```

The `priority` field earns its keep immediately: the web drops columns at container
breakpoints (`detectorListTable/index.tsx:328-383` defines five), and a terminal is
narrower than every one of them. One responsive rule here replaces per-screen width math
in a dozen files.

**4. `src/api/discover.ts` — one Discover query function.**

Five of the Explore screens are the same `GET /organizations/{org}/events/` call with a
different `dataset` and `field[]`. `src/api/logs.ts` already does this correctly for
`dataset=logs`; generalize its `listLogs` into `queryDiscover({dataset, fields, sort, query,
statsPeriod, project, environment, cursor, limit})` and re-point `logs.ts` at it. The
`events-stats/` timeseries call generalizes the same way and feeds the existing `BarChart`.

**Verify:** `bun run check` green with no test changes. Manually: Issues and Logs behave
exactly as before, and filters now survive a round trip through another nav section.

---

## Phase 7 — Explore

Ten destinations, one of them (Logs) already built. Five of the remaining nine are the same
Discover table with different columns, which is why 7.0's `queryDiscover` pays for itself
here.

| Item              | Endpoint                                | Shape                      | Est.  |
| ----------------- | --------------------------------------- | -------------------------- | ----- |
| **Traces**        | `events/?dataset=spans`                 | Discover table             | 0.5d  |
| Logs              | _done_                                  | —                          | —     |
| **Metrics**       | `events/?dataset=tracemetrics`          | Discover table             | 0.25d |
| **Errors**        | `events/?dataset=errors`                | Discover table             | 0.25d |
| **Discover**      | `events/` + `/discover/saved/`          | saved-query list → table   | 0.5d  |
| **Profiles**      | `events/?dataset=profileFunctions`      | table of slowest functions | 0.5d  |
| **Replays**       | `/organizations/{org}/replays/`         | own table                  | 0.5d  |
| **Releases**      | `/organizations/{org}/releases/`        | card list                  | 0.75d |
| **Conversations** | `events/?dataset=spans` + gen_ai filter | Discover table             | 0.25d |
| **All Queries**   | `/organizations/{org}/explore/saved/`   | table                      | 0.25d |

### 7.1 Traces

The web's Explore › Traces is `views/explore/spans/spansTab.tsx` — a toolbar (visualize /
group by / filter), a chart, and a results table with Spans / Traces / Aggregates tabs.
**Build the Spans tab only**; the aggregate builder is a query-construction UI that doesn't
belong in a terminal on the first pass.

Default fields, verbatim from `spansQueryParams.tsx:186-195`:

```
id · span.name · span.description · span.duration · transaction · timestamp
```

Default sort is `-timestamp` (`:197-206`). Reuse the existing `BarChart` above the table,
same as Logs.

```
┌─ (/) span.duration:>1s ─────────────────────────────────────────┐
│ [proj ▾][env ▾][14d ▾]                         1,204 spans      │
│ ▂▃▅▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁▂   │
│ Span ID   Name              Description        Duration  Time   │
│ ──────────────────────────────────────────────────────────────  │
│ a3f2c1d8  db.query          SELECT * FROM …    ▇▇▇ 1.2s  14:03  │
│ 7b9e0a44  http.client       GET /api/orgs/…    ▇   340ms 14:03  │
└─────────────────────────────────────────────────────────────────┘
```

Duration as a proportional bar is the one addition worth making over the web — it's the
column a terminal renders _better_ than a browser, and `src/lib/sparkline.ts` already has
the block glyphs.

### 7.2 Metrics, Errors, Conversations

Same `DataTable`, different `dataset` and `field[]`. Each is a config object plus a column
spec once 7.0 lands — the reason they're a quarter-day each and not a day.

- **Metrics** — `dataset=tracemetrics`, keys from `views/explore/metrics/types.tsx`. Carries
  a `new` feature badge in the web nav; render it as a dim `NEW` tag in the secondary nav.
- **Errors** — `dataset=errors`. Note this is the _alpha_ `errors-v2` route
  (`exploreSecondaryNavigation.tsx:68-79`), distinct from the issue stream: individual error
  events, not grouped issues.
- **Conversations** — `dataset=spans` filtered to gen-AI spans, columns from the
  `GEN_AI_*` fields in `views/explore/constants.tsx:56-70`. The web pins this to
  `statsPeriod=24h` deliberately, "to avoid slow loads"
  (`exploreSecondaryNavigation.tsx:143`) — match that default or the first load will hang.

### 7.3 Replays

Own endpoint (`utils/replays/fetchReplayList.tsx:44`), own columns. The web defines four
responsive column sets in `useReplayIndexTableColumns.tsx`; the widest is:

```
Session · OS · Browser · Duration · Dead clicks · Rage clicks · Errors · Activity
```

and it sheds Activity + rage/dead clicks below 800px. A terminal is narrower than that at
any realistic width, so **implement `WEB_MAX_800` as the default** and let `DataTable`'s
`priority` restore the rest when the window is wide.

Session is a composite cell — replay id, user, project, and `started_at` — which maps onto
the two-line row the issue stream already renders. Playback is obviously out of scope; the
detail pane shows metadata and the error list, and prints the replay's URL under a note
saying playback isn't available here.

**The app emits no OSC-8 hyperlinks, and `o` is not free.** An earlier draft of this section
had `o` opening the replay in a browser "via the OSC-8 link the app already emits for
issues". It emits none — the idea was floated in
[001-issues-and-foundation.md](001-issues-and-foundation.md) and never built — and `o` is
bound to `sentry.app.switchOrg` (`src/core/commands.ts`), so taking it would break the org
picker. OpenTUI paints into a cell framebuffer, so an escape sequence inside `<text>` is
mangled rather than linkified. Printing the URL _is_ the feature: most terminals linkify a
bare URL on cmd/ctrl-click. A global "open in browser" command is worth adding once, in the
shared base where one `App.tsx` branch lights up every screen, rather than per screen.

### 7.4 Releases

The one Explore screen that isn't a table. `views/explore/releases/list/releaseCard/` is a
card per release: version, a project row per project with health data (crash-free sessions,
crash-free users, adoption), commit summary, and a `TimeSince`. Health comes from a second
request (`releasesRequest.tsx`) layered onto the release list — plan for two async statuses
on one screen, which the store's per-entity `async.ts` already supports.

Adoption as a horizontal bar and crash-free rate as a percentage read well in a terminal.
Budget 0.75d because of the second fetch and the card layout, not the data.

### 7.5 Profiles

`views/explore/profiling/landing/` is an aggregate flamegraph. **A flamegraph is not a TUI
artifact** — the honest scope is the slowest-functions table that sits beneath it on the
landing page, and a stub explaining that flamegraphs open in the browser. Say so in the
pane rather than shipping an unreadable approximation.

The dataset is **`profileFunctions`**, not `profiles`: `useProfileFunctions.tsx:39-52` is
the request the slowest-functions widget actually issues, and `profiles` is the dataset of
individual profiles, which returns nothing shaped like a function list. Fields are
`fingerprint · package · function · count() · sum()` at a `-sum()` default sort
(`slowestFunctionsWidget.tsx:563-570`, `:72`). Ask for `project` rather than the widget's
`project.id` — the dataset resolves that alias to the slug
(`search/events/datasets/profile_functions.py:182`), which is what a row renders; the id is
only there to build links a terminal has no browser for.

### 7.6 Discover and All Queries

- **All Queries** — `GET /organizations/{org}/explore/saved/`
  (`views/explore/hooks/useGetSavedQueries.tsx:196`). A table of saved queries: name, query,
  owner, last visited, starred. Enter runs the query in the Traces table.
- **Starred Queries nav section** — same endpoint with `starred: true`, capped at
  `MAX_STARRED_SAVED_QUERIES_IN_NAV`. Fills the first nav gap from the table above.
- **Discover** — the legacy saved-query surface (`/discover/saved/`). Lowest value of the
  nine: it's mid-deprecation (`getDiscoverDeprecation`) and overlaps All Queries. **Build it
  last, or leave it stubbed** and spend the day on Monitors instead.

---

## Phase 8 — Monitors

Seven destinations, but **six of them are one table with a different `type:` filter** —
`useDetectorListQuery.tsx:30` builds `type:{detectorFilter}` and appends it to the query.
This is the highest ratio of screens-to-work in the plan.

| Item         | Query                             | Est.                     |
| ------------ | --------------------------------- | ------------------------ |
| All Monitors | `!type:issue_stream`              | 0.75d (builds the table) |
| My Monitors  | `+ assignee:me`                   | 0.1d                     |
| Error        | `+ type:error`                    | 0.1d                     |
| Metric       | `+ type:metric_issue`             | 0.1d                     |
| Cron         | `+ type:monitor_check_in_failure` | 0.1d                     |
| Uptime       | `+ type:uptime_domain_failure`    | 0.1d                     |
| Mobile Build | `+ type:preprod_size_analysis`    | 0.1d                     |
| **Alerts**   | separate — `/workflows/`          | 0.5d                     |

All from `GET /organizations/{org}/detectors/`
(`views/detectors/hooks/index.ts:84`). Note the default query excludes `issue_stream`
detectors — they're internal plumbing and never shown (`hooks/index.ts` `createDetectorQuery`).

### 8.1 The detector row

`detectorListRow.tsx` sets `min-height: 76px` — two terminal lines, the same anatomy as the
issue row. Columns: **Name · Type · Last Issue · Assignee · Alerts**, with a visualization
column replacing the middle ones when present.

Line 2 is a `│`-separated detail line whose content is **type-dependent**
(`detectorLink.tsx:231-249`) — this is the detail worth getting right, because it's what
makes the list readable:

| Type                       | Line 2                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| `metric_issue`             | project · environment · aggregate · query (mid-ellipsised to 40) · `>500ms high` |
| `uptime_domain_failure`    | project · url (mid-ellipsised to 40) · `Every 60s`                               |
| `monitor_check_in_failure` | project · schedule as text (`Every day at 09:00`)                                |
| `preprod_size_analysis`    | project · `download_size absolute`                                               |
| `error`                    | project only                                                                     |

Disabled detectors render faded (`variant={detector.enabled ? 'default' : 'faded'}`) — use
`theme.muted` for the whole row.

### 8.2 The check-in timeline

**The single highest-delight element in this plan.** Cron and uptime monitors render a
timeline of check-in status blocks across the row
(`components/checkInTimeline/checkInTimeline.tsx`), and it is _already_ a character grid —
one cell per bucket, colored by status. It transfers to a terminal with no loss at all.

Statuses, from `views/insights/crons/types.tsx:193-198`:

```
OK  MISSED  TIMEOUT  ERROR  IN_PROGRESS  UNKNOWN
█   ░       ▒        █      ▓            ·
green  muted  warning  danger  accent    subText
```

Data: `GET /organizations/{org}/monitors-stats/` for crons
(`crons/utils/useMonitorStats.tsx:44`), `GET /organizations/{org}/uptime-stats/` for uptime.
Both are bucketed by time window, which is exactly what the row needs.

```
┌─ Monitors ▸ Cron ───────────────────────────────────────────────────┐
│  nightly-billing-rollup                    ████████░███████████████  │
│  billing · Every day at 02:00                                        │
│  ─────────────────────────────────────────────────────────────────   │
│  session-cleanup                           ██████▒▒██████████░░████  │
│  web · Every 15 minutes                                              │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.3 Alerts

`Monitors › Alerts` is the automations/workflows list, not the legacy alert rules —
`analyticsItemName="monitors_automations"` (`monitorsSecondaryNavigation.tsx:95`) pointing at
`views/automations/list.tsx`. Endpoint `GET /organizations/{org}/workflows/`
(`views/automations/hooks/index.tsx:58`). Columns from
`automationListTable/index.tsx:146-167`:

```
Name · Last Triggered · Actions · Projects · Monitors
```

### 8.4 Monitor detail

Enter on a row pushes a detail view onto the existing `viewStack`: the config, connected
alerts, open periods, and — for cron and uptime — the full-width check-in timeline. Reuses
the issue-detail chrome wholesale. 0.5d.

---

## Phase 9 — Dashboards

Two nav destinations and one detail screen. The list is easy; the detail screen is the only
genuinely novel rendering work in this plan.

### 9.1 All Dashboards / Sentry Built

`GET /organizations/{org}/dashboards/`
(`utils/dashboards/dashboardsApiOptions.tsx:34`). Columns from
`manage/dashboardTable.tsx:120-154`:

```
★ · Name · Widgets · Owner · Access · Created · Last Visited
```

`Sentry Built` is the same endpoint with `?filter=onlyPrebuilt`, and only appears when the
org has `dashboards-prebuilt-insights-dashboards`
(`dashboardsSecondaryNavigation.tsx:62`) — we can't read org feature flags, so render the
item and let it come back empty rather than guessing. **Starred Dashboards** in the nav
comes from `/dashboards/starred/` (`dashboardsApiOptions.tsx:10`), closing the second nav
gap. 0.5d for all of it.

### 9.2 Dashboard detail — the widget grid

`GET /organizations/{org}/dashboards/{id}/` returns widgets with a `layout` (x, y, w, h on a
grid) and a `displayType`. Twelve display types exist (`dashboards/types.tsx:40-52`); map
them onto what a terminal can honestly draw:

| `displayType`         | Terminal rendering                                       |
| --------------------- | -------------------------------------------------------- |
| `big_number`          | large value, centered — the best-looking widget in a TUI |
| `bar`, `area`, `line` | existing `BarChart` / block-glyph sparkline              |
| `table`, `top_n`      | `DataTable`                                              |
| `categorical_bar`     | horizontal bars with labels                              |
| everything else       | title + "not renderable in the terminal"                 |

The grid itself is the work: the web uses a 6-column responsive react-grid-layout, and the
honest terminal equivalent is to **sort widgets by `layout.y` then `layout.x` and stack them
one per row, full width**, with `j`/`k` moving between widgets. Trying to reproduce a 2-D
grid at 80 columns produces widgets too narrow to read. 1d, and worth cutting to "big number

- table + bar only" if time is short.

---

## Sequencing

Roughly nine working days if everything is built. It is meant to be cut from the bottom.

```
7.0  Screen registry + DataTable + queryDiscover     1.0d   ← blocks everything
 │
 ├── 8.1  Detector table (unlocks 6 nav items)       0.75d  ← best value/day in the plan
 ├── 8.2  Check-in timeline                          0.5d   ← best delight/day
 ├── 8.3  Alerts (workflows)                         0.5d
 ├── 8.4  Monitor detail                             0.5d
 │
 ├── 7.1  Traces                                     0.5d
 ├── 7.2  Metrics / Errors / Conversations           0.75d
 ├── 7.3  Replays                                    0.5d
 ├── 7.6  All Queries + Starred Queries nav          0.25d
 ├── 7.4  Releases                                   0.75d
 ├── 7.5  Profiles (table + honest stub)             0.5d
 │
 ├── 9.1  Dashboards list + Starred nav              0.5d
 └── 9.2  Dashboard detail widget grid               1.0d
                                                     ─────
                                                     ~9d
```

**Monitors before Explore.** Six nav items light up for 0.75d of work, and the check-in
timeline is the one element in this plan that looks _better_ in a terminal than in the
browser. Explore's nine items cost more per item and overlap heavily with Logs, which
already ships.

**Discover (7.6) and the dashboard grid (9.2) are the cut lines.** Discover is
mid-deprecation and duplicates All Queries; the widget grid is a day for one screen. Cutting
both leaves ~7d and still fills 17 of the 19 stubs.

---

## Deliberately out of scope

- **Query construction UI** — the aggregate/group-by/visualize toolbar. Read and run saved
  queries; don't build a query builder in a terminal.
- **Widget and dashboard editing** — read-only. Consistent with the phase 5 rule that
  mutations are limited to safe, reversible triage actions.
- **Flamegraphs** (7.5) and **replay playback** (7.3) — neither survives the character grid.
  Stub honestly and offer the browser link.
- **Detector create/edit** — the forms are large and the failure mode (a broken monitor) is
  worse than not having it.
- **Insights** — removed from the TUI nav in #31 and gated behind
  `insights-to-dashboards-ui-rollout` upstream. Leave it out.
- **Settings** (Organization / Projects / Teams) — the fourth stubbed section. It's a
  different kind of screen entirely: forms and mutations rather than lists over telemetry,
  and its value in a terminal is low. It stays stubbed, and 7.0's screen registry covers it
  with `kind: "stub"` like everything else. Worth its own plan if it's ever wanted.

---

## Verification

Per phase, the standard from 001 applies: `bun run check`, then a real terminal run via the
`dev-pane` skill, then side-by-side against sentry.io in a browser.

Three checks specific to this plan:

1. **`SENTRY_TUI_LATENCY=3000` on every new screen.** The skeleton must hold the exact
   geometry of the real row. `DataTable` makes this a single implementation to get right
   instead of seventeen — assert it once, in a test that renders a skeleton and a real row
   at the same width and compares captured frames line for line.
2. **Narrow-terminal column shedding.** Resize to 80, 100, and 140 columns and confirm
   `DataTable`'s `priority` drops columns in the same order the web's container queries do.
   Nothing may overflow or wrap.
3. **Nav coverage test.** A structural test in `scripts/` that walks `NAV_GROUPS`, resolves
   each item through `screenFor()`, and asserts every one maps to a registered screen —
   `kind: "stub"` counts, but a _missing_ entry fails. This is what stops the nav and the
   screen registry drifting apart as items are built.

## Risks

- **Sentry's IA moves.** Insights was removed and Alerts/Releases were demoted between the
  writing of 001 and this plan. Re-read the three `secondaryNavigation.tsx` files before
  starting, not after.
- **Feature flags are invisible to us.** Half the Explore items are behind org features
  (`ourlogs-enabled`, `tracemetrics-enabled`, `explore-errors`, `session-replay-ui`,
  `gen-ai-conversations`). We can't read them, so screens will render empty rather than
  hidden for orgs without the feature. Empty states must say "this org may not have X
  enabled" rather than "no results".
- **Discover `events/` rate limits are undocumented per-dataset** and phase 1 already flagged
  polling as the fastest way to get limited. Every new screen is another `events/` caller;
  keep the manual-refresh-only rule.
- **7.0 is a refactor with no user-visible output.** It's the least satisfying day in the
  plan and the easiest to skip. Skipping it means every screen after it costs more, and
  `App.tsx` ends up past 2,000 lines.
