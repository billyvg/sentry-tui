# Sentry TUI — sentry.io in the terminal

> **Status: delivered.** Phases 1–5 shipped, and Phase 6 landed OAuth device flow
> and the compiled binary. What remains of Phase 6 — the command palette, the
> org/project switcher, and real screens for the other nav sections — is carried
> forward in [002-explore-dashboards-monitors.md](002-explore-dashboards-monitors.md).
> Kept as written for the research and the decisions behind them.

## Context

Hackweek 2026. `~/code/hackweek2026-sentry-tui` is an empty git repo (no commits yet).
The goal is a terminal client that reproduces sentry.io's **information architecture and
screen layout** as faithfully as a character grid allows — built with **OpenTUI**, using
**modem-dev/hunk** as the architectural reference, and reading layout truth from the real
frontend at `../sentry/static`.

Decisions made with the user:

| Question  | Decision                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Auth      | Personal token now, behind an `AuthProvider` seam; OAuth device flow later                              |
| Scope     | Issues deep (stream + details + triage actions); other nav sections stubbed                             |
| Layout    | **Full-page views** — closest to sentry.io. List fills content area; Enter → full-page detail; Esc back |
| Mutations | Read + safe/reversible mutations (resolve, archive, bookmark, assign, review). **No delete**            |

### Key research findings that shape the plan

- **OpenTUI moved** `sst/opentui` → **`anomalyco/opentui`**; docs at **opentui.com/docs**. Current version **0.5.4**.
- **Runtime: Bun.** Bun ≥1.3.0 is the tested path (you have 1.3.1). Node requires **exactly 26.4.0** — you have 26.3.0, which the acceptance scripts reject. Bun it is.
- **React binding is the right call** here (complete TS typing for every intrinsic element, best docs, `test-utils`, and it's the stack the team knows). Solid is what OpenCode ships, but that battle-testing isn't needed for a hackweek.
- **No `<table>` intrinsic in React** (`TextTableRenderable` is core-only) — issue rows get composed from `<box flexDirection="row">`. This is better anyway: Sentry rows are two-line, not cells.
- **No automatic Tab focus traversal**, no modal, no spinner. We build the focus ring ourselves — this shapes the app, so it lands in phase 1.
- **`<a href>` emits OSC-8 hyperlinks** → every issue row can be cmd-clickable straight to sentry.io. Cheap, high-delight.
- **`<code filetype="typescript">` gives tree-sitter highlighting free** (JS/TS/TSX/Markdown grammars bundled) — real syntax-highlighted stack frames.
- Sentry's view code is entirely React + emotion + `@sentry/scraps` — **not reusable**. But a meaningful tier of pure TS _is_ vendorable (types, enums, palette, frame-folding helpers). Details in Phase 2.

---

## Stack

```bash
bun create tui --template react .     # scaffolds tsconfig w/ jsxImportSource
bun add @opentui/core@0.5.4 @opentui/react@0.5.4 @opentui/keymap@0.5.4 react@19
bun add zod                            # API response validation at the boundary
```

`tsconfig.json` must carry `"jsx": "react-jsx"`, `"jsxImportSource": "@opentui/react"`,
`"moduleResolution": "bundler"`.

---

## Architecture

Copied from hunk's tiered module layout, enforced by convention (add
`dependency-cruiser` only if it starts drifting). A tier imports strictly downward:

```
src/lib/          dependency-free helpers (text width, color, time-ago, sparkline)
src/api/          Sentry HTTP client, auth, zod schemas, domain types
src/core/         store, actions, reducer, selectors, commands, theme
src/ui/           OpenTUI surface — screens, components, hooks
src/main.tsx      CLI entry
```

### Files to create

```
src/main.tsx                        CLI entry: parse args, resolve auth, dispatch
src/app/startup.ts                  startup plan union (login | app | help)
src/api/auth.ts                     AuthProvider seam — token now, device flow later
src/api/client.ts                   fetch wrapper: bearer, Link pagination, 429, region
src/api/issues.ts                   list/get/update issues, list events, get event
src/api/schemas.ts                  zod schemas for Group / Event / Project / Org
src/core/store.ts                   createStore (hunk's 30-line observable store)
src/core/async.ts                   AsyncStatus<T> + per-entity status helpers
src/core/actions.ts                 discriminated-union actions
src/core/reducer.ts                 pure reducer
src/core/selectors.ts               derived state
src/core/commands.ts                command catalog (id, title, defaultKeys, locus)
src/core/theme.ts                   TUI theme derived from Sentry tokens
src/ui/runApp.tsx                   createCliRenderer + createRoot + signal handling
src/ui/App.tsx                      shell: nav rail | content | status bar; routes view stack
src/ui/screens/IssueStream.tsx      the issues list screen
src/ui/screens/IssueDetail.tsx      the full-page issue detail screen
src/ui/screens/NotImplemented.tsx   stub pane for other nav sections
src/ui/components/NavRail.tsx       74px-equivalent icon/letter rail
src/ui/components/SecondaryNav.tsx  per-section sub-nav
src/ui/components/StatusBar.tsx     keybind hints + notices
src/ui/components/IssueRow.tsx      two-line issue row (+ skeleton mode)
src/ui/components/Spinner.tsx       braille spinner via useTimeline
src/ui/components/Sparkline.tsx     24h stats → block glyphs (+ pending placeholder)
src/ui/components/StackTrace.tsx    frames, folding, context lines
src/ui/components/ModalFrame.tsx    scrim + centered frame (lifted from hunk)
src/ui/components/HelpDialog.tsx    `?` overlay, rendered from the command catalog
src/ui/hooks/useFocusRing.ts        manual focus traversal (OpenTUI has none)
src/ui/lib/keyRouting.ts            KeyOwner routing (lifted from hunk)
```

---

## Phase 1 — Skeleton, focus ring, theme

**Why first:** OpenTUI gives no focus traversal and no modals, and its key events reach
_global listeners before the focused renderable_ — the inverse of the browser. Getting this
wrong is expensive to retrofit, so it goes in before any Sentry data.

1. Scaffold with `bun create tui --template react`, wire `tsconfig`.
2. `src/ui/runApp.tsx` — mirror hunk's `runInteractiveApp.tsx`:
   ```tsx
   const renderer = await createCliRenderer({
     screenMode: "alternate-screen",
     exitOnCtrlC: false, // the app owns Ctrl-C
     openConsoleOnError: true,
     targetFps: 30,
   });
   createRoot(renderer).render(<App />);
   ```
   Install SIGINT/SIGTERM → `renderer.destroy()` on **every** exit path, or the terminal is
   left in `-echo`/`-icanon`.
3. **Lift from hunk verbatim** (small, generic, zero hunk-specific content):
   - `src/ui/lib/keyRouting.ts` — the `KeyOwner = "notMine" | "mine" | "focused"` router.
     A boolean can't express "I didn't handle this, but don't let the scrollbox eat it."
   - `ModalFrame` + `resolveModalGeometry` — scrim at `zIndex: 55`, frame at `60`.
   - `listWindowStart()` — 8 lines, used by every modal list.
   - `fitText`/`padText` — grapheme-correct terminal width. Do not reimplement.
4. `useFocusRing.ts` — ordered focusable regions, Tab/Shift-Tab cycles, exposes
   `focused === region` for the declarative `focused` prop.
5. `src/core/theme.ts` — derived from the real palette I extracted from
   `../sentry/static/app/utils/theme/scraps/tokens/color.tsx`:
   ```ts
   accent:  "#7553FF"   // blurple — Sentry primary
   bg:      "#0D0A10"   neutral.dark.100
   panel:   "#1B1821"   panelAlt: "#24202B"   border: "#393442"
   text:    "#E7E5EA"   muted:    "#A49EAE"
   level: { fatal: "#C10000", error: "#FF9838", warning: "#FFCE00",
            info: "#7553FF", sample: "#7553FF", unknown: "#DAD9DE" }
   ```
   The level map is exactly `components/events/errorLevel.tsx`. Render it as sentry.io does:
   a colored vertical bar (`│`) beside the message.
6. `src/core/commands.ts` — the command catalog, hunk's single best pattern. One
   declaration drives dispatch, the status bar, and the `?` help overlay:
   ```ts
   { id: "sentry.issue.resolve", title: "Resolve", defaultKeys: ["r"], locus: "semantic" }
   ```
   `HelpDialog` renders rows naming **command ids, not keys**, so a rebind updates help
   automatically and an unbound command's row disappears instead of advertising a dead key.

**Verify:** `bun run src/main.tsx` shows the shell with nav rail, empty content, status bar.
Tab cycles focus (border color changes). `?` opens help. `q` quits cleanly — run `stty -a`
afterward to confirm the terminal isn't left in a broken mode.

---

## Phase 2 — API client and domain types

1. **`src/api/auth.ts`** — the seam, so the device flow later touches no call sites:

   ```ts
   interface AuthProvider {
     getToken(): Promise<string>;
     describe(): string;
   }
   ```

   v1 resolution order (matching `getsentry/cli`'s precedence):
   `SENTRY_AUTH_TOKEN` → `SENTRY_TOKEN` (legacy) → `~/.config/sentry-tui/config.json` (chmod 600).
   First run with no token prints a short message pointing at
   `https://sentry.sentry.io/settings/account/api/auth-tokens/` and the scopes to tick:
   **`org:read`, `project:read`, `event:read`, `event:write`, `member:read`, `team:read`**
   (`event:write` is what buys resolve/archive/assign; `event:admin` deliberately not requested,
   since we're not doing delete).

   _Why personal token for v1:_ org tokens have fixed CI-oriented scopes and can't do
   `/organizations/` listing; internal-integration tokens need Manager/Admin. A personal
   token is created in two clicks, scoped to what this user can already see, and works
   against self-hosted. The device flow is strictly nicer UX but needs a registered public
   OAuth app and Sentry ≥26.1.0 — hence phase 6.

2. **`src/api/client.ts`** — base `https://sentry.io/api/0/` (prefer the region domain
   `us.sentry.io` when known — the docs note lower latency). Header `Authorization: Bearer <token>`.
   - **Pagination:** parse the `Link` header. Format is
     `<url?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"`. Cursors are always
     returned for both directions even when empty — **`results="false"` is the stop condition**,
     not a missing link.
   - **Rate limits:** surface `X-Sentry-Rate-Limit-Remaining` / `-Reset` in the status bar.
     Limits are per-endpoint with no published numbers, and the limiter keys off caller identity
     (extra tokens don't help). Back off on rejection; the docs warn that polling gets you limited.
   - Wrap responses in zod parses so a schema drift surfaces as a clean error, not a crash.
   - `AbortSignal` on every call; 30s timeout; backoff retry on 5xx/network only.
   - `SENTRY_TUI_LATENCY=<ms>` injects artificial delay — the harness for testing every
     loading state without waiting on a slow day.

3. **`src/api/issues.ts`** — the exact calls the real issue stream makes
   (from `views/issueList/overview.tsx`), **as a two-phase fetch** (see Phase 2.5):

   ```
   # phase 1 — fast, stats deliberately omitted
   GET /organizations/{org}/issues/
     ?query=...&sort=date&statsPeriod=14d&limit=25&shortIdLookup=1
     &expand=owners&expand=inbox&collapse=stats&collapse=unhandled&cursor=...

   # phase 2 — sparkline data for the ids just returned
   GET /organizations/{org}/issues-stats/?groups=<id>&groups=<id>…&statsPeriod=14d

   GET /organizations/{org}/issues/{id}/events/{latest|oldest|recommended|<id>}/
   PUT /organizations/{org}/issues/{id}/     # status, substatus, assignedTo, isBookmarked, hasSeen
   ```

   `limit` maxes at 100; the real UI uses 25/page. Every request takes an `AbortSignal` so
   superseded fetches are cancelled rather than left to land out of order.

4. **Vendor from `../sentry/static`** (types only, pruned — none of it is import-clean):
   - `types/core.tsx` — **zero imports**, copy verbatim (`Actor`, `PageFilters`, `TimeseriesValue`).
   - `types/stacktrace.tsx`, `types/breadcrumbs.tsx` — one trivial import each.
   - `types/event.tsx` — `Frame`, `ExceptionValue`, `ExceptionType`, `Thread`, `Entry`, `EntryType`,
     `Level`. Prune the 5 context-interface imports that reach into `components/`.
   - `types/group.tsx` — `GroupStatus`, `GroupSubstatus`, `PriorityLevel`, `IssueCategory`.
     Drop the search-UI `SearchGroup`/`Tag` block.
   - `views/issueDetails/context.tsx` lines 13–100 — the **`SectionKey` enum**, a clean
     dependency-free list of every issue-detail section. Vendor verbatim as the section registry.
   - `views/issueList/utils.tsx` — `DEFAULT_QUERY`, `Query`, `IssueSortOptions`, `getSortLabel`.
   - `components/events/interfaces/utils.tsx` — `isRepeatedFrame`, `getHiddenFrameIndices`
     (pure; these encode frame folding — port directly rather than reinventing).
   - `components/events/interfaces/frame/utils.tsx` — `hasContextSource/Vars/Registers`,
     `trimPackage`.
   - `utils/events.tsx` lines ~40–125 — `getTitle`, `getMessage`, `getShortEventId`
     (pure switch statements).

5. **Offline fixtures:** `../sentry/tests/js/fixtures/{group,groups,entries,event,project}.ts`
   are real golden data. Copy into `test/fixtures/` and develop the whole UI against them —
   no token, no network, no rate limit.

**Verify:** a throwaway script prints the first page of issues for your org, and a second
call fetches an event with a stack trace. Then re-run the same code against the fixtures with
no network.

---

## Phase 2.5 — Loading states (cross-cutting; build before Phase 3)

**The Sentry API is slow** — issue list requests routinely take seconds, and the terminal
gives no browser-style "page is loading" affordance. A TUI that blocks on a spinner feels
broken in a way a web page doesn't. This is a first-class concern, not polish, so it lands
_before_ the screens are written and every screen is built against it.

Three rules, applied everywhere:

1. **Never block the render loop.** Every fetch is fire-and-forget into the store; the UI
   always paints immediately from whatever state exists.
2. **Reserve the layout.** Skeletons occupy the exact final geometry so content never jumps
   when it lands. The real UI does this deliberately — `LoadingStreamGroup` in
   `components/stream/group.tsx` mirrors every column width with placeholder boxes, and
   `groupListBody.tsx` renders `pageSize` of them.
3. **Always show what's happening.** Any in-flight request is visible in the status bar. A
   silent 4-second pause is indistinguishable from a hang.

### Async status lives in the store, keyed by entity

Hunk's replacement for react-query, and the right shape here. No component-local
`isLoading` booleans — they can't survive remounts or be inspected from the status bar.

```ts
type AsyncStatus<T> =
  | { state: "idle" }
  | { state: "loading"; since: number; previous?: T } // previous = stale-while-revalidate
  | { state: "ready"; value: T; fetchedAt: number }
  | { state: "error"; error: ApiError; previous?: T; retryable: boolean };

// in state:
issues: AsyncStatus<Group[]>;
issueStats: Record<string, AsyncStatus<Stats>>; // per issue id
event: Record<string, AsyncStatus<Event>>; // per issue id
mutations: Record<string, AsyncStatus<void>>; // per issue id
```

Actions: `async/start`, `async/resolve`, `async/reject`, each carrying an entity key. `previous`
is what makes refreshes non-destructive — a reload keeps the old list on screen, dimmed, rather
than flashing to skeletons.

### Two-phase fetch — the single biggest win

The real issue stream does exactly this, and it's why sentry.io paints fast. From
`views/issueList/overview.tsx`, the main request **omits the expensive stats**:

```
params.collapse = ['stats', 'unhandled']     // ← fast: titles, counts, metadata
```

then a second request fills in the sparkline data for the ids just returned
(`fetchStats`, `overview.tsx:338`):

```
GET /organizations/{org}/issues-stats/?groups=<id>&groups=<id>…&statsPeriod=14d
```

(a real endpoint — `src/sentry/api/urls.py:1964`).

We mirror it: rows appear with titles, culprits, counts and short IDs almost immediately;
each sparkline cell shows a dim `╌╌╌╌╌╌╌╌` placeholder that fills in when phase two lands.
Text is readable and navigable while the graphs are still arriving. `statsLoading` is tracked
separately from `issuesLoading`, exactly as the real UI does.

### Per-screen behavior

**Issue stream**

- **Cold load** → 25 skeleton rows at full two-line height. Each row: a dim block for the
  title (varied widths so it reads as content, not a progress bar), `╌╌╌╌` for the sparkline,
  `··` for counts. Built by reusing `IssueRow` in a `skeleton` mode so the geometry cannot
  drift from the real row.
- **Refresh / filter change / pagination** → stale-while-revalidate. Keep the current rows,
  dim them to `theme.muted`, show `⟳ Loading…` in the status bar. Selection is preserved by
  issue id across the refresh, so a slow reload never moves the cursor out from under you.
- **Search typing** → debounce 300ms; only submit on Enter. Never fire per keystroke against
  a rate-limited API.
- **Empty vs loading are distinct.** "No issues match this query" only renders in the `ready`
  state — never during `loading`, which is the classic flash-of-empty-state bug.

**Issue detail**

- Header, title, culprit, counts and metadata come from the `Group` we **already have** in the
  list — the detail screen paints instantly with real content before any request fires.
- The event body (stack trace, breadcrumbs, contexts) is the slow part: its sections render as
  collapsed fold headers with a `…` marker, filling in on arrival. Sections below the fold
  aren't requested until scrolled near — the real UI does the same with a 200px-margin
  intersection observer (`components/events/issueDetailsLazyRender.ts`).
- Opening a second issue while the first is in flight cancels the first (`AbortController`),
  so fast `j`/`k` browsing doesn't queue a backlog of dead requests.

**Mutations** — optimistic, as in Phase 5: the row updates instantly, a `⟳` marker sits beside
it until the PUT confirms, and a failure rolls back with a status-bar error.

### Status bar as the global activity indicator

One slot, hunk's three-tier precedence (`sessionNotice ?? transientNotice ?? persistentNotice`):

```
⟳ Loading issues…                          ← in flight
⟳ Loading issues… 3.2s                     ← elapsed appears after 2s, so slow ≠ hung
✓ 25 issues · updated 12s ago              ← settled
⚠ Rate limited · retrying in 8s            ← from X-Sentry-Rate-Limit-Reset
✗ Failed to load issues · r to retry       ← actionable
```

An animated braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) driven by `useTimeline()` from `@opentui/react`
— OpenTUI ships no spinner component, but it does ship the animation primitive.
**Only animate while something is in flight**; a permanently spinning frame at 30fps burns CPU
and redraws for nothing.

### Failure handling

- **Timeout** at 30s with a clear message rather than an indefinite spinner.
- **Retry** with exponential backoff (1s, 2s, 4s) for 5xx and network errors; **never** blind-retry
  a 429 — honor `X-Sentry-Rate-Limit-Reset` and show the countdown.
- **401** → the token is bad or expired; say so and point at the login path rather than
  showing a generic error.
- Errors never crash a screen: an `error` status renders in place with a retry key bound.

**Verify:** run with `SENTRY_TUI_LATENCY=3000` (a debug env var that injects artificial delay
into the client) and confirm — skeletons appear instantly at correct geometry, the spinner
animates, elapsed time shows after 2s, text lands before sparklines, the cursor holds position
across a refresh, and no screen ever renders blank. Then drop the network mid-load and confirm
a retryable error rather than a hang. Snapshot the skeleton state with `captureCharFrame()`.

---

## Phase 3 — Issue stream (the core screen)

Full-page layout as chosen — nav rail + secondary nav on the left, list filling the content area.

**Real nav IA** (verified in `views/navigation/navigation.tsx`) — note Alerts and Releases are
**no longer top-level**; Alerts moved under Monitors, Releases under Explore:

```
Issues · Explore · Dashboards · Insights · Monitors · Settings
```

Issues secondary nav (`secondary/sections/issues/issuesSecondaryNavigation.tsx`):
`Feed · Inbox` — `Errors & Outages · Breached Metrics · Warnings · Configuration · User Feedback`
— `Autofix ▸ Recently Run` — `All Views`.

**Screen composition** (`src/ui/screens/IssueStream.tsx`):

```
┌─ Sentry ── acme ─ #proj ─ 14d ──────────────────┐   ← header, nav rail on left
│I│ Issues ▸ Feed                                 │
│E│ is:unresolved issue.priority:[high, medium]   │   ← <input> search
│D│ [proj ▾][env ▾][14d ▾]           Sort: Last…  │   ← filter row
│I│ ─────────────────────────────────────────────  │
│M│  ▸ TypeError: x undefined      ▁▃▅▂ 42  12   │
│S│    web/src/app.tsx  PROJ-1A2                  │
└─ enter open · r resolve · a archive · ? help ───┘   ← status bar
```

- **Default query is literally** `is:unresolved issue.priority:[high, medium]`
  (`views/issueList/utils.tsx:9`).
- **Sort options** (exact labels from `getSortLabel`): Recommended, Date Added, **Last Seen
  (default)**, Age, Trends, Events, Users, Progress.
- **Row anatomy** — mirrors `components/stream/group.tsx` (`min-height: 82px` = two terminal
  lines), rendered as a composed `<box flexDirection="row">`:
  - line 1: unread dot (`●` when `!hasSeen`) · level bar (`│` in the level color) · title
    (bold, ellipsized) · sparkline · events count · users count · priority · assignee
  - line 2 (dim, `│`-separated like `groupMetaRow.tsx`'s divider trick): short ID · `Unhandled`
    tag · culprit · comment count · logger
- **Sparkline** from `group.stats["24h"]` (`[[ts, count], …]`) → `▁▂▃▄▅▆▇█` scaled to max.
  This is the single highest-fidelity-per-line-of-code element in the whole app.
- **Priority** as `IconCellSignal` does it: High `▁▄█` / Med `▁▄_` / Low `▁__`.
- **Scrolling:** `<scrollbox>` with `viewportCulling` (default true). At 25 rows/page no manual
  virtualization is needed; if the page size grows, lift hunk's `buildSidebarRenderWindow`
  (sparse mount + exact-height spacers).
- Each row's title wrapped in `<a href={group.permalink}>` for OSC-8 click-through.
- Pagination footer: `[start]-[end] of [total]`, `100+` when capped — matching the real UI.

**Verify:** `bun run src/main.tsx` against fixtures, then live. Compare side by side with
sentry.io in a browser: row content, ordering, counts, and sparkline shape should match. Then
re-run with `SENTRY_TUI_LATENCY=3000` and confirm skeleton rows hold the exact geometry of the
real rows (no jump when data lands) and that titles appear before sparklines.

---

## Phase 4 — Issue detail (full page)

Enter pushes onto a `viewStack: View[]` in the store; Esc pops. No router — hunk's lesson is
that a view stack in the store beats a router abstraction at this size.

Mirroring `groupDetailsLayout.tsx` / `header/header.tsx`, top to bottom:

1. **Header** — breadcrumb `Issues / PROJ-1A2`; title (bold) + `EventMessage` (level bar +
   culprit) beneath; right-aligned `Events (total)` and `Users (90d)` stat pair.
2. **Action bar** — `Resolve` · `Archive` · `Subscribe` · `⋯`, then `Priority` and `Assignee`
   on the right. Reflects `GroupActions`.
3. **Graph row** — 24h/14d event counts as a wider sparkline/bar row + top tag distributions
   inline (the real UI's `IssueTagsPreview`).
4. **Event navigation** — `‹ oldest · prev · next · latest ›` plus the event ID, matching
   `issueDetailsEventNavigation.tsx`.
5. **Body sections** — collapsible fold sections keyed by the vendored `SectionKey`, in the
   real render order from `groupEventDetailsContent.tsx`:
   `Highlights → Message → Exception/Stack Trace → Threads → Breadcrumbs → Request → Tags →
Contexts → Additional Data → Packages → SDK`.
   Space toggles a section; `zc`/`zo` collapse/expand all.

**Stack trace** (`src/ui/components/StackTrace.tsx`) — the highest-fidelity-value component:

- Frame line format from `frame/defaultTitle/index.tsx`:
  ```
  filename  in  function  at line 42:13   [In App]
  ```
- **Folding**, using the vendored pure helpers — this is the behavior that makes a stack trace
  readable: non-in-app frames collapse into `▸ Show 12 more frames`. Visibility predicate is
  `includeSystemFrames || frame.inApp || nextFrame?.inApp || (!frame.inApp && !nextFrame)`.
  Repeated frames collapse to a count; `framesOmitted` renders a marker.
- Expanded frame shows `frame.context` (`Array<[lineNo, source]>`) through
  `<code filetype={...}>` for real tree-sitter highlighting, with the active line highlighted
  and a line-number gutter, then `vars` as a key/value tree.
- `newestFirst` toggle, and `lineNo === 0` suppressed (native convention).

**Verify:** open a real JS error issue in both the TUI and the browser. Frame list, fold
counts, in-app markers, and context lines should agree. With `SENTRY_TUI_LATENCY=3000`, the
header must paint instantly from the already-loaded `Group` while the body sections fill in,
and fast `j`/`k` browsing must not queue stale requests.

---

## Phase 5 — Triage actions

All through `PUT /organizations/{org}/issues/{id}/`, all reversible:

| Key | Action        | Body                                                          |
| --- | ------------- | ------------------------------------------------------------- |
| `r` | Resolve       | `{status: "resolved"}`                                        |
| `a` | Archive       | `{status: "ignored", substatus: "archived_until_escalating"}` |
| `u` | Unresolve     | `{status: "unresolved"}`                                      |
| `b` | Bookmark      | `{isBookmarked: true}`                                        |
| `m` | Mark reviewed | `{inbox: false}`                                              |
| `A` | Assign        | `{assignedTo: "user:<id>" \| "team:<id>"}` via a select modal |
| `p` | Priority      | `{priority: "high"\|"medium"\|"low"}`                         |

- **Optimistic updates** with rollback on failure, and a status-bar notice on both paths.
  Use hunk's three-tier notice precedence for the one status-bar slot.
- Per-entity async status lives **in the store** (`issues/set-mutation-status`), not in
  component state — hunk's replacement for react-query, and it's the right shape here.
- Delete is deliberately absent; `event:admin` is never requested.

**Verify:** resolve an issue in the TUI, confirm it flips in the browser, then unresolve.
Kill the network mid-action and confirm the optimistic update rolls back with a visible notice.

---

## Phase 6 — Polish (as hackweek time allows)

- **OAuth device flow** behind the existing `AuthProvider`: `POST /oauth/device/code/` → show
  the `XXXX-XXXX` user code + verification URL → poll `/oauth/token/` with
  `grant_type=urn:ietf:params:oauth:grant-type:device_code`, honoring `authorization_pending`
  and `slow_down` (+5s). Store access + refresh in `~/.config/sentry-tui/`. Requires
  registering a public OAuth app; refresh when <10% of lifetime remains or on a 401.
- Command palette (Ctrl-K) over the existing command catalog — nearly free once the catalog exists.
- Org/project switcher modal.
- Stub screens for Explore / Dashboards / Insights / Monitors / Settings — real nav entries,
  honest "not implemented" panes.
- `bun build --compile` single binary. **Pin x64 to baseline targets**
  (`bun-darwin-x64-baseline`, `bun-linux-x64-baseline`) — Bun's default x64 runtime needs
  AVX2 and SIGILLs on older CPUs and VMs. hunk hit this and it's an obscure debug.

---

## Verification

**Automated** — OpenTUI's testing kit is genuinely good:

```tsx
import { testRender } from "@opentui/react/test-utils";

const setup = await testRender(<IssueStream issues={fixtures} />, { width: 100, height: 30 });
await setup.renderOnce();
expect(setup.captureCharFrame()).toContain("TypeError");
setup.mockInput.pressKey("r"); // resolve
await setup.waitForVisualIdle();
```

`captureCharFrame()` (text snapshot), `captureSpans()` (styled + cursor), `mockInput`,
`mockMouse`, `waitFor`, `resize`, `ManualClock`. Run under `bun test`. Snapshot the issue row,
**the skeleton row (asserting identical width/height to the real row)**, the stack trace with
folding, and the help overlay. `ManualClock` makes the spinner and the "elapsed after 2s"
behavior deterministic. Always `renderer.destroy()` in a `finally`.

**Manual:**

1. `bun run src/main.tsx` with `SENTRY_AUTH_TOKEN` set → issue stream loads for your org.
2. Side-by-side against sentry.io: nav items, default query, sort labels, row content, counts.
3. Enter on an issue → detail; verify stack trace frames and fold counts match the browser.
4. `r` to resolve → confirm in the browser → `u` to undo.
5. **`SENTRY_TUI_LATENCY=3000`** — skeletons at correct geometry, spinner animates, elapsed
   time after 2s, text before sparklines, cursor holds across refresh, no blank screens, no
   flash of "no issues" while loading.
6. Disconnect the network mid-load → retryable error with a bound retry key, not a hang.
7. Resize the terminal narrow and wide; nothing should overflow or crash.
8. `q`, then `stty -a` — terminal must not be left in `-echo`/`-icanon`.
9. `bun test` green.

## Risks

- **OpenTUI is 0.5.x, pre-1.0, ~220 open issues.** Pin exact versions; expect churn.
- **Numeric `width`/`height` silently forces `flexShrink: 0`** — the layout gotcha most likely
  to cost an hour. Set `flexShrink` explicitly on anything that should contract.
- **`overflow: "scroll"` only clips, it does not scroll.** Always `<scrollbox>`.
- **Rate limits are undocumented per-endpoint** and polling is explicitly called out as a fast
  way to get limited. No aggressive auto-refresh; manual `R` to reload in v1.
- **API latency is the main UX risk**, which is why Phase 2.5 lands before any screen. If
  loading states are retrofitted instead, every screen has to be rewritten to accept them.
