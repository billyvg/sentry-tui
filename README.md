# sentry-tui

sentry.io in your terminal — a TUI client built with [OpenTUI](https://opentui.com),
mirroring Sentry's real information architecture and screen layouts.

## Status

Hackweek 2026. The Issues path is built end to end; other nav sections are
honest stubs.

- [x] Phase 1 — app shell, focus ring, theme, command catalog
- [x] Phase 2 — API client, auth, domain types
- [x] Phase 2.5 — loading states
- [x] Phase 3 — issue stream
- [x] Phase 4 — issue detail + stack traces
- [x] Phase 5 — triage actions
- [x] Phase 6 — OAuth device-flow login

Next: command palette, org/project switcher, and the remaining nav sections.

## Install

npm installs a self-contained binary — no Bun or Node needed at runtime.

```bash
# one-off, or installed globally
npx sentry-tui
npm install -g sentry-tui
```

`sentry-tui` and `@billyvg/sentry-tui` are the same package; the platform
binary arrives as an optional dependency, so you download one binary rather
than four. Binaries are also attached to every
[release](https://github.com/billyvg/sentry-tui/releases).

The npm install **keeps itself current**. Launching starts the app
immediately on the build you already have, and a background process fetches
anything newer — so a release reaches you without `npm i -g` again, and
without ever making you wait on a 24MB download. Nothing about starting the
app touches the network.

When a new build has finished downloading, a bold pink **Update** appears in
the bottom-left corner. Click it or press `U` and the app restarts into it on
the spot; ignore it and you get the new version next launch either way. The
app looks again every 15 minutes while it is open, and only ever offers a build
it
has already downloaded.

Set `SENTRY_TUI_NO_UPDATE=1` to pin whatever you have; `CI` is treated the same
way. A binary downloaded by hand from the releases page never updates itself,
and says so by not offering — replace it the same way you got it.

Supported: macOS and Linux, on arm64 and x64. Windows and musl-based Linux
(Alpine) aren't built — run from source there.

### Crash reporting

sentry-tui reports **its own** crashes to Sentry, which is how bugs that only
happen on someone else's terminal ever get fixed. What goes: the error and its
stack, the screen you were on, the Sentry API calls leading up to it, how long
they took, your OS and terminal details, and — so a report can be followed up —
the account and organization you're signed in to. It also logs what the app
did along the way: which screens were opened and how quickly, and which
requests the server refused. What never goes: your auth token, anything you
typed into a search box, and the contents of your issues.

Set `SENTRY_TUI_NO_TELEMETRY=1` to turn it off. It is also off automatically
when `CI` is set, and when running from source.

### From source

Running from source needs **Bun ≥ 1.3.0**. OpenTUI reaches its native renderer
through `bun:ffi`; the Node backend wants `node:ffi`, which is Node 26.1+ behind
`--experimental-ffi`, so Bun is the supported path.

```bash
git clone https://github.com/billyvg/sentry-tui
cd sentry-tui
bun install
bun start
```

## Authentication

```bash
sentry-tui login     # OAuth device flow — opens your browser
sentry-tui status    # who you're signed in as, and for how long
sentry-tui logout    # forget the stored credentials
```

`login` prints a short code, opens <https://sentry.io/oauth/device/>, and waits
for you to approve it (RFC 8628). Starting the TUI with no credentials offers
the same flow. Access tokens are renewed automatically; Sentry rotates the
refresh token on each renewal, so the new pair is written back immediately.

Use `--no-browser` to print the URL instead of opening one, and `SENTRY_URL` +
`SENTRY_CLIENT_ID` to log in to a self-hosted install (needs Sentry ≥ 26.1.0 and
a **public** OAuth application from Settings → Account → API → Applications).

### Personal token instead

Create one at <https://sentry.io/settings/account/api/auth-tokens/> with these
scopes — the same set `login` requests:

```
org:read  project:read  event:read  event:write  member:read  team:read
```

```bash
export SENTRY_AUTH_TOKEN=sntryu_…
```

Resolution order is `SENTRY_AUTH_TOKEN` → `SENTRY_TOKEN` → the credential file.
Environment tokens are used exactly as given and never refreshed.

### Files

| Path                                    | Holds                                           |
| --------------------------------------- | ----------------------------------------------- |
| `~/.config/sentry-tui/config.json`      | preferences (default org), rewritten by the app |
| `~/.config/sentry-tui/credentials.json` | tokens, written `0600`                          |

Secrets live apart from the file the app has to keep writable. A token left in
`config.json` by an older build is moved across on the next run.

## Development

```bash
bun run dev        # watch mode
bun test           # test suite
bun run typecheck  # tsc --noEmit
```

Set `SENTRY_TUI_LATENCY=3000` to inject artificial API latency and exercise
loading states.

## Keys

`?` for the full list. The basics: `j`/`k` move, `tab` switches pane,
`enter` opens, `r` resolves, `a` archives, `q` quits.
