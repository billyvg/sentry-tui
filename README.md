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

## Requirements

**Bun ≥ 1.3.0.** OpenTUI's Node support pins to exactly Node 26.4.0, so Bun is the
supported path here.

## Getting started

```bash
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
