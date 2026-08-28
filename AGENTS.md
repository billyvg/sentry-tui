# sentry-tui agent notes

## purpose

Terminal client for sentry.io — real screens across Issues, Explore, Dashboards,
Seer, and Monitors. Issues supports deep detail and triage; the other Sentry data
surfaces are read-only.
Built with OpenTUI React on Bun.

## architecture

The repository is a workspace monorepo with four explicit packages:

```text
packages/app/              → replaceable product UI, core, API, assets
packages/runtime-contract/ → injected config, telemetry, and update interfaces
packages/runtime-host/     → compiled startup, renderer, loader, persistence, telemetry
packages/launcher/         → plain Node launcher and background update worker
```

The package dependency shape is `app → runtime-contract ← runtime-host`; the
host also embeds the app as its cold-start fallback and reuses launcher update
modules. The app must never import runtime-host or launcher implementations.

Inside `packages/app/src/`, tiers import strictly downward: `lib/` contains
dependency-free helpers, `api/` owns the Sentry client and domain types,
`core/` owns domain state and commands, and `ui/` owns the OpenTUI surface.

API modules keep their domain types in TypeScript and defensively normalize
unstable response fields at the boundary. A runtime schema library would be a
tier-wide architectural choice, not a second file-local pattern.

`packages/runtime-host/src/telemetry/` is how sentry-tui reports its own errors.
The app calls it only through `runtime-contract`. Two rules the implementation has to
keep: it never writes to stdout or stderr — a TUI owns the screen — and it is
inert until `initTelemetry` says otherwise, loading the SDK by dynamic import
so a run with reporting off never evaluates it. Reporting is off when running
from source; `SENTRY_TUI_TELEMETRY=1` forces it on to exercise the path.

Import boundaries enforced by `bun run deps:check` (dependency-cruiser; rules in
`.dependency-cruiser.cjs`). Known violations baseline is shrink-only: fix a violation,
rerun `bun run deps:baseline`, never add new ones.

## runtime

Bun, not Node.js. `CLAUDE.md` is a symlink to this file — edit here, not there.

- Bun loads `.env` automatically — don't add `dotenv`
- Bun API docs are vendored at `node_modules/bun-types/docs/**.md`

## commands

Scripts live in `package.json`; these are the ones whose behavior it doesn't
spell out.

```bash
bun run check                   # all CI checks in one command
bun run test:shard 1 4          # one shard of the suite (what CI runs)
bun run deps:baseline           # regenerate known violations (shrink-only!)
bun run icons:build             # re-rasterize platform icons (needs librsvg)
```

```bash
bun run release:preflight       # readiness for the next minor (same selectors as cut)
bun run release:dry-run         # build + package on CI, publish nothing
bun run release:cut             # next minor, cut remotely, watch Release
bun run release:publish         # publish from CI artifacts, by hand
bun run release:verify          # check what landed on npm
```

## distribution

Load the `distribution` skill before touching `packages/launcher/`,
`packages/runtime-contract/`, `packages/runtime-host/src/update/`,
`packages/runtime-host/src/ui/`, `scripts/release*`, or `scripts/build-*`. Two
rules hold whether or not you've read it:
`packages/launcher/src/background-update.mjs` must never write to stdout or
stderr — a TUI owns the screen — and the host updater reuses the launcher's own
modules rather than restating the cache layout or the lock.

## telemetry names

Every name sentry-tui reports under — log messages, metric names, and the
`source` an error is filed with — is `<namespace>.<subject>.<event>`, lowercase,
`snake_case` inside a segment. One prefix search then narrows from a whole
subsystem to one thing that happens in it, without having to know which of the
three recorded it:

```text
api.           → everything the HTTP client says
api.request.   → one request's outcomes
api.request.failed
```

Namespaces, and what belongs in each:

| namespace | covers                                                       |
| --------- | ------------------------------------------------------------ |
| `app`     | the process and the session it runs — startup, quit, crashes |
| `api`     | requests to Sentry and what came back                        |
| `auth`    | credentials, tokens, signing in                              |
| `nav`     | moving between screens                                       |
| `ui`      | rendering, and what the user did                             |

Adding a namespace is a deliberate act: put it in this table and in
`NAMESPACES` in `scripts/telemetry-names.test.ts`, which fails until both agree.

Three rules the names have to keep:

- **Never interpolated.** A name that carries a route, a screen, or an org is a
  name per route, per screen, per org — unfilterable as a log, unaggregatable as
  a metric. Whatever varies goes in the attributes: `log("info",
"nav.screen.opened", { screen })`, never ``log("info", `opened ${screen}`)``.
- **Events are past tense** — `started`, `opened`, `failed`, `rate_limited` —
  except where the name reads as a state rather than a thing that happened
  (`auth.credentials.missing`).
- **Attributes stay low-cardinality.** A boolean, an enum, a status code, a
  duration. Never free-form user text.

Span names and ops are the exception, and are left alone: `http.client`,
`GET /organizations/{org}/issues/` and the rest follow Sentry's own semantic
conventions, because the product reads them.

`TelemetryName` in `packages/runtime-contract/src/telemetry.ts` makes the compiler reject a name
without three segments; `scripts/telemetry-names.test.ts` catches the rest.

### error, or metric?

`reportError` is for bugs — something a person has to go and fix. An outcome
that is expected, that the UI already explains, and that nobody will ever ship
a patch for is a `countMetric`, not an error. A run with no credentials, a rate
limit, a 404 on a deleted issue: filing those as errors buries the crashes the
reporting exists for, while a counter still answers how often they happen.

The names in use today:

| name                              | kind        | where                                              |
| --------------------------------- | ----------- | -------------------------------------------------- |
| `app.session.started`             | log         | `packages/runtime-host/src/ui/runApp.tsx`          |
| `app.session.ended`               | log         | `packages/runtime-host/src/ui/runApp.tsx`          |
| `app.session.crashed`             | log         | `packages/runtime-host/src/telemetry/index.ts`     |
| `app.startup.failed`              | error       | `packages/runtime-host/src/main.tsx`               |
| `app.config.write_failed`         | error       | `packages/app/src/ui/App.tsx`                      |
| `app.update.failed`               | error       | `packages/runtime-host/src/update/telemetry.ts`    |
| `app.update.check_failed`         | metric      | `packages/runtime-host/src/update/telemetry.ts`    |
| `app.crash.uncaught_exception`    | error       | `packages/runtime-host/src/telemetry/index.ts`     |
| `app.crash.unhandled_rejection`   | error       | `packages/runtime-host/src/telemetry/index.ts`     |
| `api.request.failed`              | log + error | `packages/app/src/api/client.ts`                   |
| `api.request.rate_limited`        | log         | `packages/app/src/api/client.ts`                   |
| `api.request.unauthorized`        | log         | `packages/app/src/api/client.ts`                   |
| `api.request.rejected`            | metric      | `packages/app/src/api/client.ts`                   |
| `api.response.unreadable`         | error       | `packages/app/src/core/async.ts`                   |
| `auth.credentials.missing`        | metric      | `packages/runtime-host/src/main.tsx`               |
| `auth.organizations.missing`      | metric      | `packages/runtime-host/src/main.tsx`               |
| `nav.screen.opened`               | log         | `packages/runtime-host/src/telemetry/index.ts`     |
| `nav.browser.open_failed`         | metric      | `packages/runtime-host/src/startup/openBrowser.ts` |
| `nav.url.invalid`                 | metric      | `packages/app/src/core/sentryUrl.ts`               |
| `nav.url.unsupported`             | metric      | `packages/app/src/core/sentryUrl.ts`               |
| `ui.org_picker.invalid_selection` | metric      | `packages/runtime-host/src/main.tsx`               |
| `ui.org.switched`                 | log         | `packages/app/src/ui/App.tsx`                      |
| `ui.render.crashed`               | error       | `packages/runtime-host/src/ui/ErrorBoundary.tsx`   |

Catching an error to render a useful message does not make the failure
observable. Every non-abort failure needs one owner that calls `reportError`,
or `countMetric` when the outcome is expected. The API client owns HTTP failure
telemetry, so UI hooks may render or degrade from those rejections without
reporting them a second time; catches outside an already-observed boundary must
record the failure before discarding it or replacing it with fallback state.

## images

OpenTUI's `<image>` decodes png/jpeg/webp/gif — never SVG. Terminal images only
render at usable fidelity under kitty graphics or sixel, and multiplexers
(Herdr, tmux, screen) degrade both to half-blocks, so image call sites gate on
`useImageSupport().supportsHighRes` and must lay out sensibly without them.

Bundled art reaches `<image>` as bytes, from `~/assets/navIcons` or
`~/assets/platformIcons` — never as a path built from `import.meta.dir`. Two
reasons, both invisible until the binary ships: `bun build --compile` embeds a
file only when a module statically imports it, and its virtual filesystem does
not implement the `fs.promises.open` OpenTUI uses for a string source. Either
one alone turns every bundled icon into nothing at all in the distributed
binary while it still renders from source. Add a new PNG by adding its import
beside the others.

Every bundled PNG ships inside a binary that is already too big, so keep them
at the size they render at. Nav icons in `packages/app/src/assets/icons/` are laid out at 2
columns by 1 row — about 40x40 device pixels on a HiDPI cell — and are capped at
128x128 by a test in `packages/app/src/assets/navIcons.test.ts`. They have no generator, so
downscale in place with `sips -Z 128 <file> --out <file>` when adding one.

Platform icons in `packages/app/src/assets/platform-icons/`, the lookup table in
`packages/app/src/lib/platformIcons.generated.ts`, and the imports in
`packages/app/src/assets/platformIcons.generated.ts` are all generated by
`bun run icons:build` from the `platformicons` package. All are committed;
rerun only when that package is upgraded.

## verification

Before committing, run `bun run check`.

For rendering/interaction changes, also do a real terminal smoke run with `bun run start`.

## testing

- `bun test` runs everything; tests import from `bun:test`.
- Integration tests in `test/`; structural CI checks in `scripts/*.test.ts`.
- Test helpers in `test/helpers.tsx` — always use `renderHarness()` and `press()`.
- Fixtures in `test/fixtures.ts` — deterministic Sentry API data, no network.
- See `test/README.md` for placement and patterns.

## code style

- Prefer one source of truth per behavior. Extend existing paths, don't duplicate.
- Add JSDoc comments to functions. Skip comments that only narrate what code says.

## worktrees

Always work in a git worktree, never on `main` directly.

```bash
# create a worktree for your feature branch (always branch off latest main)
git fetch origin
git worktree add ../sentry-tui-<branch-name> -b <branch-name> origin/main
cd ../sentry-tui-<branch-name>
bun install
```

Choose a short, descriptive branch name (e.g. `fix/sparkline-overflow`,
`feat/replay-tab`). Once the PR is merged, remove the worktree yourself —
right after merging, without asking first:

```bash
git worktree remove ../sentry-tui-<branch-name>
```

## commits & pull requests

Follow Conventional Commits: `<type>[scope]: <description>`.
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`.

After finishing your changes:

1. Run `bun run check` to verify everything passes.
2. Stage and commit with a conventional commit message.
3. Push and open a pull request:

```bash
git push -u origin <branch-name>
gh pr create --fill
```

Open it ready for review, not as a draft — this project overrides a
draft-first default carried in from elsewhere.

When a PR addresses a filed issue, close it with a linking keyword in the PR
body (`Closes #N`, `Fixes #N`) rather than just mentioning the number. GitHub's
Development sidebar on the issue then shows which release shipped the fix —
a `Pre-release` badge once it merges to main, flipping to `Latest` once a
tagged release contains it — with no workflow or bot involved. This only
covers PRs tied to an issue; one merged without a linked issue gets no
release badge anywhere, which is the accepted tradeoff for staying native
instead of adding a commenting bot.

## issues

File a GitHub issue for anything you decide not to do. A bug you noticed while
fixing another one, a follow-up the plan defers, a shortcut you took knowingly —
if it isn't in the diff, it belongs in an issue, not only in the PR description
or a code comment. Both get read once and then never again; the issue list is
what someone picks work from.

```bash
gh issue create --title "<what is wrong>" --body "<...>"
```

Write it for whoever picks it up cold: what the current behavior is, the file
and line it lives at, why it was left out, and what "done" looks like. Link the
PR that found it, and say in that PR which issues came out of it.

Judgement, not a reflex — a genuinely trivial nit is noise. The bar is whether
someone would want to know about it later.

## skills

Agent skills live in `.agents/skills/<name>/SKILL.md` — add and edit them there.
`.claude/skills` is a symlink to that directory so Claude Code picks up the same
set; no per-harness copies.

## dev pane

Before finishing, load the `dev-pane` skill and follow its steps only when the
diff includes source-code changes that affect the rendered UI or user
interaction. Do not launch a dev pane for documentation, tests-only changes,
CI/workflows, configuration, tooling, or source changes with no UI effect.
