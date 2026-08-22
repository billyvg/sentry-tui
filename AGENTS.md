# sentry-tui agent notes

## purpose

Terminal client for sentry.io — issues deep (stream + details + triage), other nav sections stubbed.
Built with OpenTUI React on Bun.

## architecture

Four tiers, each importing strictly downward:

```text
src/lib/       → dependency-free helpers (text width, sparkline, stacktrace)
src/telemetry/ → Sentry SDK wrapper; a leaf like lib, called from every tier
src/api/       → Sentry HTTP client, auth, zod schemas, domain types
src/core/      → store, reducer, commands, theme, async status, nav
src/ui/        → OpenTUI surface — screens, components, hooks
src/main.tsx   → CLI entry
```

`src/telemetry/` is how sentry-tui reports its own errors. Two rules it has to
keep: it never writes to stdout or stderr — a TUI owns the screen — and it is
inert until `initTelemetry` says otherwise, loading the SDK by dynamic import
so a run with reporting off never evaluates it. Reporting is off when running
from source; `SENTRY_TUI_TELEMETRY=1` forces it on to exercise the path.

Import boundaries enforced by `bun run deps:check` (dependency-cruiser; rules in
`.dependency-cruiser.cjs`). Known violations baseline is shrink-only: fix a violation,
rerun `bun run deps:baseline`, never add new ones.

## runtime

Bun, not Node.js. `CLAUDE.md` is a symlink to this file — edit here, not there.

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` instead of `jest` or `vitest`
- `bun install` / `bun run <script>` instead of the npm/yarn/pnpm equivalents
- `bun build <file>` instead of `webpack` or `esbuild`
- `Bun.file` over `node:fs`'s readFile/writeFile, `Bun.$\`ls\`` over execa
- Bun loads `.env` automatically — don't add `dotenv`
- Bun API docs are vendored at `node_modules/bun-types/docs/**.md`

## commands

```bash
bun install                     # install deps
bun run start                   # run the app
bun run dev                     # run with --watch
bun run typecheck               # tsc --noEmit
bun run format                  # oxfmt format
bun run format:check            # oxfmt check (CI)
bun run lint                    # oxlint with --deny-warnings
bun run lint:fix                # oxlint with --fix
bun test                        # all tests
bun run test:shard 1 4          # one shard of the suite (what CI runs)
bun run test:theme-contrast     # WCAG contrast checks
bun run test:boundaries         # source import boundary audit
bun run test:packaging          # distribution chain stays in step
bun run deps:check              # dependency-cruiser graph check
bun run deps:baseline           # regenerate known violations (shrink-only!)
bun run build:bin               # compiled binary → dist/sentry-tui
bun run build:npm               # assemble npm packages → dist/npm
bun run icons:build             # re-rasterize platform icons (needs librsvg)
bun run check                   # all CI checks in one command
```

```bash
bun run release:preflight       # is this machine and repo ready to release?
bun run release:dry-run         # build + package on CI, publish nothing
bun run release:cut 0.2.0       # bump, verify, commit, tag, push
bun run release:publish         # publish from CI artifacts, by hand
bun run release:verify          # check what landed on npm
```

## distribution

Releases ship a `bun build --compile` binary per platform — OpenTUI's renderer
needs `bun:ffi`, so there is no runtime-agnostic package to publish. That one
artifact feeds both channels: npm (a launcher package plus `os`/`cpu`-gated
optional dependencies) and the GitHub Release, for downloading by hand.

The npm launcher self-updates: it runs the newest build in
`~/.cache/sentry-tui/versions` (or the bundled one) straight away, then, once
that child has exited, spawns `packaging/npm/background-update.mjs` detached to
fetch anything newer. The worker must never write to stdout or stderr — a TUI
owns the screen — so failures go to `update.log` in that cache.
`SENTRY_TUI_NO_UPDATE=1` disables it, as does `CI`.

Whoever is running decides when to check, and a launch costs exactly one check.
`src/app/selfUpdate.ts` states that rule in full and is where to change it: the
app looks `UPDATE_FIRST_CHECK_MS` after start and every `UPDATE_POLL_MS` after
that, so the
launcher stands down for any child that was up that long, covering only what
never starts the app (`--help`, `--version`, `login`, `logout`, `status`) and
sessions too short to have looked. It decides that from how long the child ran,
never by reading argv, so a new command needs nothing added there.
`APP_FIRST_CHECK_MS` in `launch.mjs` restates that one number because plain JS
cannot import the TypeScript, and `scripts/packaging.test.ts` fails if the two
drift.

The running app closes the loop rather than making you relaunch. `src/app/
selfUpdate.ts` reuses the launcher's own modules — never restate the cache
layout or the lock. A build only ever surfaces once its bytes are on disk, as a
bold pink `Update` in the status bar's left corner; clicking it or pressing `U`
tears the renderer down and execs the cached binary.

That exec is a real `execve(2)`, reached through `bun:ffi` in `src/lib/exec.ts`
because Bun has no `process.execve`. Spawning instead would leave the old
process suspended underneath the new one, once per update accepted in a
session; `restartInto` keeps a spawn only as the fallback for a machine whose
libc will not load.

That offer is gated on `SENTRY_TUI_MANAGED=1`, which only the launcher sets.
A binary run straight off the releases page would revert on its next cold
start, so it stays quiet. Tests stand the whole path up through that marker
plus `SENTRY_TUI_CACHE_DIR` — see `test/selfUpdate.test.tsx`.

`scripts/release-targets.ts` is the single source of truth for the platform
list; the workflow matrix and `packaging/npm/launch.mjs` each restate it in
their own syntax, and `scripts/packaging.test.ts` fails when they drift. The repo's `package.json` stays `private` — published manifests are
generated by `scripts/build-npm.ts`. See `docs/releasing.md`.

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

`TelemetryName` in `src/telemetry/index.ts` makes the compiler reject a name
without three segments; `scripts/telemetry-names.test.ts` catches the rest.

### error, or metric?

`reportError` is for bugs — something a person has to go and fix. An outcome
that is expected, that the UI already explains, and that nobody will ever ship
a patch for is a `countMetric`, not an error. A run with no credentials, a rate
limit, a 404 on a deleted issue: filing those as errors buries the crashes the
reporting exists for, while a counter still answers how often they happen.

The names in use today:

| name                            | kind        | where                                 |
| ------------------------------- | ----------- | ------------------------------------- |
| `app.session.started`           | log         | `src/ui/runApp.tsx`                   |
| `app.session.ended`             | log         | `src/ui/runApp.tsx`                   |
| `app.session.crashed`           | log         | `src/telemetry/index.ts`              |
| `app.startup.failed`            | error       | `src/main.tsx`                        |
| `app.crash.uncaught_exception`  | error       | `src/telemetry/index.ts`              |
| `app.crash.unhandled_rejection` | error       | `src/telemetry/index.ts`              |
| `api.request.failed`            | log + error | `src/api/client.ts`                   |
| `api.request.rate_limited`      | log         | `src/api/client.ts`                   |
| `api.request.unauthorized`      | log         | `src/api/client.ts`                   |
| `api.response.unreadable`       | error       | `src/core/async.ts`                   |
| `auth.credentials.missing`      | metric      | `src/main.tsx`                        |
| `nav.screen.opened`             | log         | `src/telemetry/index.ts`              |
| `ui.org.switched`               | log         | `src/ui/App.tsx`                      |
| `ui.render.crashed`             | error       | `src/ui/components/ErrorBoundary.tsx` |

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

Platform icons in `src/assets/platform-icons/`, the lookup table in
`src/lib/platformIcons.generated.ts`, and the imports in
`src/assets/platformIcons.generated.ts` are all generated by
`bun run icons:build` from the `platformicons` package. All are committed;
rerun only when that package is upgraded.

## verification

Before committing, run `bun run check` which runs: format check, lint, typecheck,
dependency boundary check, theme contrast, and tests.

For rendering/interaction changes, also do a real terminal smoke run with `bun run start`.

## testing

- `bun test` runs everything; tests import from `bun:test`.
- Integration tests in `test/`; structural CI checks in `scripts/*.test.ts`.
- Test helpers in `test/helpers.tsx` — always use `renderHarness()` and `press()`.
- Fixtures in `test/fixtures.ts` — deterministic Sentry API data, no network.
- See `test/README.md` for placement and patterns.

## code style

- Pre-commit hook runs `lint-staged` (oxfmt + oxlint) automatically.
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
`feat/replay-tab`). Clean up when the PR is merged:

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

Before finishing, load the `dev-pane` skill and follow its steps: when running
under Herdr it splits a new pane in the current tab and runs the app from this
agent's worktree for manual testing.
