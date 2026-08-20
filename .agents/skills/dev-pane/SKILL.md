---
name: dev-pane
description: Launch sentry-tui in a new Herdr pane, in the current tab, running from the current agent's worktree. Use after making rendering or interaction changes, or before finishing a task.
---

# Dev Pane

Split a new Herdr pane next to this agent and run sentry-tui in it, from the
worktree this agent is working in. Always creates a fresh pane — never reuses or
steals a pane that already exists, and never touches other tabs or workspaces.

## 1. Detect Herdr

```bash
test "${HERDR_ENV:-}" = 1
```

If this fails, Herdr is not available: skip the rest of this skill, tell the user
they can run `bun run dev` themselves in the worktree, and continue with the task.
Do not try to launch the app any other way.

Inside Herdr, `$HERDR_PANE_ID` and `$HERDR_TAB_ID` identify the calling pane and
its tab. Target the caller with `--current` rather than letting a command fall
back to whatever pane the user has focused.

## 2. Resolve the worktree

The app must run from the agent's own worktree, not the main checkout:

```bash
git rev-parse --show-toplevel
```

Use that path as the pane's cwd. If `node_modules` is missing there (fresh
worktree), the launch command needs `bun install` first — see step 4.

## 3. Split a new pane in the current tab

Pick the direction from the caller's shape — split a wide pane to the right, a
narrow or tall one down:

```bash
herdr pane layout --pane "$HERDR_PANE_ID"
herdr pane split --current --direction right --cwd "<worktree-root>" --no-focus
```

`--no-focus` keeps the user's focus in the agent pane. Read the new pane ID from
`.result.pane.pane_id` in the JSON response — never guess it.

## 4. Run the app

```bash
herdr pane run <new-pane-id> "bun run dev"
```

Use `bun run dev` (watch mode) so later edits reload automatically. For a fresh
worktree with no `node_modules`, run `"bun install && bun run dev"` instead.

Confirm it came up, then report the pane ID to the user:

```bash
herdr pane read <new-pane-id> --lines 30
```

If the output shows a crash or a missing-dependency error, fix the cause and
re-run in the same pane rather than splitting again.

## Rules

- **Current tab only.** Panes in other tabs and workspaces belong to other agents.
- **New pane every time.** Don't run the app in a pane you didn't create here.
- **Current worktree.** Always pass `--cwd` explicitly; the repo may be checked
  out in several worktrees at once.
- **Leave it running.** Don't close the pane when the task is done — the user
  will interact with it.
- **The installed CLI is the authority.** If a flag is rejected, run
  `herdr pane` or `herdr pane <subcommand> --help` and use what it reports.
