---
name: smoke-test
description: Launch sentry-tui in a Herdr pane for manual smoke testing. Re-uses existing panes within the current tab. Use after making rendering or interaction changes, or before finishing a task.
---

# Smoke Test

Launch sentry-tui in a Herdr pane so the user can manually test changes.
Only operates within the agent's current tab — never touches other tabs/windows.

## Steps

1. **Find the current tab:**

```
herdr_panes action=current
```

Note the `tab_id` from the result.

2. **List panes in the current tab:**

```
herdr_panes action=list
```

Filter results to only panes matching your `tab_id`.

3. **Find or create a pane:**

Look for a pane in your tab (other than your own agent pane) that is either idle
or already running `bun run dev`. If one exists, reuse it. Otherwise split a new one:

```
herdr_panes action=split direction=right
```

4. **Start the app (if not already running):**

Read the pane output to check if `bun run dev` is already running:

```
herdr_panes action=read pane_id=<pane_id> lines=20
```

If the app is not running, start it:

```
herdr_panes action=run pane_id=<pane_id> command="bun run dev"
```

5. **Leave the pane running.** Do not close it — the user will interact with it.

## Rules

- **Same tab only.** Never use panes from other tabs — those belong to other agents.
- **Reuse panes.** Don't create a new pane if one already exists in your tab.
- **Use `bun run dev`** (watch mode) so file changes auto-reload.
- **Don't stop the pane** when your task is done. Leave it running for the user.
