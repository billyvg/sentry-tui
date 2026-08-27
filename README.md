# sentry-tui

sentry.io in your terminal — a TUI client built with [OpenTUI](https://opentui.com),
mirroring Sentry's real information architecture and screen layouts.

## Status

Every destination in the current navigation opens a real screen across Issues,
Explore, Dashboards, Seer, and Monitors — 30 in all, with no placeholder panes.

| Area       | What's built                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues     | Query-backed views, saved views, cursor pagination, full event detail and stack traces, plus resolve, archive, bookmark, and review actions |
| Explore    | Traces, Logs, Metrics, Errors, Discover, Profiles, Replays, Releases, Conversations, saved queries, charts, and the trace query builder     |
| Dashboards | All, Sentry Built, and starred dashboard lists, with a terminal widget grid for supported chart, table, number, and categorical widgets     |
| Seer       | Ask Seer, conversation history, rich responses, and feature-gated Code Mode workflows                                                       |
| Monitors   | Detector lists by type, check-in timelines, monitor detail, and Alerts workflows                                                            |
| App shell  | OAuth device-flow login, command palette, org and project switching, filters, Sentry URL navigation, telemetry, and in-process app updates  |

Settings is intentionally left on sentry.io rather than mirrored as a stub.
Most non-Issues data screens are read-only today. Next is deeper pagination,
filtering, and cross-screen detail navigation, plus the remaining parity work
tracked in the [open issues](https://github.com/billyvg/sentry-tui/issues).

## Install

npm installs a compiled runtime host and a platform-neutral app payload — no
Bun installation is needed at runtime.

```bash
# one-off, or installed globally
npx sentry-tui
npm install -g sentry-tui
```

`sentry-tui` and `@billyvg/sentry-tui` are the same package; the platform host
arrives as an optional dependency, so you download one binary rather than
four. The replaceable app payload is shared by every platform. Complete host
and payload bundles are also attached to every host
[release](https://github.com/billyvg/sentry-tui/releases).

The npm install **keeps itself current**. Launching starts the app
immediately on what you already have, and a background process fetches any
newer app payload — so a release reaches you without `npm i -g` again and
without waiting on a full native binary. Nothing about starting the app
touches the network.

When a new payload has finished downloading, a bold pink **Update** appears in
the bottom-left corner. Click it or press `U` and the long-lived host swaps the
app tree while keeping the process, terminal mode, renderer, and React root
alive. The app looks again every 15 minutes while it is open and only offers
bytes already on disk. A release that changes the host/payload API falls back
to the verified full-host restart path; a host-only fix is discovered through
the same independent check and offered as a restart. Routine UI and application
changes do not replace the host.

The payload swap currently remounts the application tree, so in-memory screen
and navigation state is not preserved yet. The terminal shell no longer has to
shut down; moving that state above the payload boundary is a separate step.

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

Running from source needs **Bun ≥ 1.4.0**. OpenTUI reaches its native renderer
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
