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

Next: OAuth device-flow login, command palette, org/project switcher, and the
remaining nav sections.

## Requirements

**Bun ≥ 1.3.0.** OpenTUI's Node support pins to exactly Node 26.4.0, so Bun is the
supported path here.

## Getting started

```bash
bun install
bun start
```

## Authentication

Create a **personal token** at
<https://sentry.io/settings/account/api/auth-tokens/> with these scopes:

```
org:read  project:read  event:read  event:write  member:read  team:read
```

Then expose it however you prefer:

```bash
export SENTRY_AUTH_TOKEN=sntryu_…
```

Resolution order is `SENTRY_AUTH_TOKEN` → `SENTRY_TOKEN` → `~/.config/sentry-tui/config.json`.

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
