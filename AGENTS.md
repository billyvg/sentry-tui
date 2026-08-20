# sentry-tui agent notes

## purpose

Terminal client for sentry.io — issues deep (stream + details + triage), other nav sections stubbed.
Built with OpenTUI React on Bun.

## architecture

Four tiers, each importing strictly downward:

```text
src/lib/    → dependency-free helpers (text width, sparkline, stacktrace)
src/api/    → Sentry HTTP client, auth, zod schemas, domain types
src/core/   → store, reducer, commands, theme, async status, nav
src/ui/     → OpenTUI surface — screens, components, hooks
src/main.tsx → CLI entry
```

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
bun run test:theme-contrast     # WCAG contrast checks
bun run test:boundaries         # source import boundary audit
bun run deps:check              # dependency-cruiser graph check
bun run deps:baseline           # regenerate known violations (shrink-only!)
bun run build:bin               # compiled binary → dist/sentry-tui
bun run check                   # all CI checks in one command
```

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
3. Push and open a **draft** pull request:

```bash
git push -u origin <branch-name>
gh pr create --draft --fill
```

## skills

Agent skills live in `.agents/skills/<name>/SKILL.md` — add and edit them there.
`.claude/skills` is a symlink to that directory so Claude Code picks up the same
set; no per-harness copies.

## smoke-test pane

Before finishing, load the `smoke-test` skill and follow its steps to launch
the app in a Herdr pane for manual testing.
