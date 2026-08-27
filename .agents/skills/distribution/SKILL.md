---
name: distribution
description: How sentry-tui is built, packaged, and self-updates — the compiled runtime host, replaceable app payload, npm launcher and background worker, host restart fallback, and the platform list that three files restate. Use when touching the distribution workspaces, scripts/release*.ts, scripts/build-*.ts, or the release workflow.
---

# Distribution

Distribution has two independently versioned tiers. `release.json` owns the
`host` and `app` release lines. Workspace manifests declare which release line
they own; shared workspace changes derive their components from their consumers.
`scripts/release-components.ts` handles remaining shared build inputs.
`release:cut` compares each line with its own
`host-v*` or `app-v*` tag, and app-only releases must skip the native matrix.

A `bun build --compile` runtime host ships per platform
because OpenTUI's renderer needs `bun:ffi`; one platform-neutral app payload is
built by `scripts/build-app.ts`. The host owns Bun, OpenTUI's native renderer,
the React root, terminal lifecycle, update validation, and an embedded fallback
app. The payload owns the replaceable application tree. Both tiers feed npm;
only host releases create GitHub Releases, whose archives include the currently
released payload for manual installs.

Payload builds leave React, OpenTUI, telemetry, and the config write queue
external, then rewrite those imports to the host virtual modules registered in
`packages/runtime-host/src/ui/loadPayload.ts`. This identity is load-bearing: bundling another
React breaks hooks, and loading another OpenTUI instance disconnects the
payload from the renderer the host already owns.
Telemetry must keep the instance initialized during startup, and host shutdown
must flush the same config write queue the payload used.

## The npm launcher

The npm launcher pins its optional platform packages to its host version but
depends on `@billyvg/sentry-tui-app` without coupling it to that version. It
runs the newest cached host and payload in
`~/.cache/sentry-tui/versions` (or the npm-installed pair) straight away. Once
that child has exited, it spawns `packages/launcher/src/background-update.mjs` detached
once for each release line. The worker must never write to stdout or stderr — a
TUI owns the screen — so failures go to `update.log` in that cache.
`SENTRY_TUI_NO_UPDATE=1` disables it, as does `CI`.

## Who checks, and when

Whoever is running decides when to check, and a launch checks each release line
in exactly one place.
`packages/runtime-host/src/update/selfUpdate.ts` states that rule in full and is where to change it: the
app looks `UPDATE_FIRST_CHECK_MS` after start and every `UPDATE_POLL_MS` after
that, so the launcher stands down for any child that was up that long, covering
only what never starts the app (`--help`, `--version`, `login`, `logout`,
`status`) and sessions too short to have looked. It decides that from how long
the child ran, never by reading argv, so a new command needs nothing added
there. `APP_FIRST_CHECK_MS` in `launch.mjs` restates that one number because
plain JS cannot import the TypeScript, and `scripts/packaging.test.ts` fails if
the two drift.

## The in-app update offer

The running app closes the loop rather than making you relaunch. The runtime
host updater reuses the launcher's own modules — never restate the cache
layout or the lock. A release only surfaces once its bytes are on disk, as a
bold pink `Update` in the status bar's left corner. Clicking it or pressing `U`
loads a compatible payload and replaces the application component under the
existing process, terminal, renderer, and React root. Import/contract failures
and first-render crashes discard the bad cached payload and restore the
previous app. Host-only releases are downloaded independently and offered
through the verified restart path even when the app is already current.

`HOST_API_VERSION` in `packages/runtime-contract/src/runtime.ts` is the compatibility gate.
Bump it only when a payload genuinely cannot use the old host. An incompatible
payload makes the updater fetch its platform host and use the verified restart
fallback. That fallback is a real `execve(2)`, reached through Bun's
`process.execve`; spawning instead would leave the old process suspended
underneath the new one, so `restartInto` has no spawn fallback.

That offer is gated on `SENTRY_TUI_MANAGED=1`, which only the launcher sets.
A bundle run straight off the releases page would revert on its next cold
start, so it stays quiet. It can still load the payload sitting beside the host.
Tests stand the managed path up through that marker plus
`SENTRY_TUI_CACHE_DIR` — see `test/selfUpdate.test.tsx`.

## Platform list and manifests

`scripts/release-targets.ts` is the single source of truth for the platform
list; the workflow matrix and `packages/launcher/src/launch.mjs` each restate it in
their own syntax, and `scripts/packaging.test.ts` fails when they drift. The
repo's `package.json` stays `private` — published manifests are generated by
`scripts/build-npm.ts` from the component versions in `release.json`. See
`docs/releasing.md`.
