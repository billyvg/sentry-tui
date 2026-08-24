# Terminal Theme Detection and Light Mode Design

## Summary

sentry-tui will use OpenTUI's terminal theme detection to choose a complete
dark or light palette before the first React render, then follow terminal
appearance changes for the rest of the session. A `SENTRY_TUI_THEME`
environment variable can force either palette when detection is unavailable or
undesired.

The active palette will be React state, not a mutable module singleton. Theme
changes will re-render consumers without remounting `App`, so navigation,
filters, selections, dialogs, scroll positions, and in-flight requests survive
the switch.

## Goals

- Detect whether the terminal background is light or dark through OpenTUI's
  public theme-mode API.
- Render a complete Sentry-derived light palette when the terminal is light.
- Switch palettes live when an automatic-mode terminal reports a new mode.
- Preserve all application state across a live theme change.
- Allow `SENTRY_TUI_THEME=light|dark` to override detection for the process.
- Keep the current dark theme as both the visual default and the fallback when
  detection is unavailable.
- Hold both palettes to the existing contrast and visual-separation checks.
- Render navigation images without a dark baked-in canvas in light mode.

## Non-goals

- A theme picker or persisted theme preference inside the TUI.
- Arbitrary/custom color schemes.
- Implementing OSC parsing outside OpenTUI.
- Changing terminal emulator settings or the terminal's own palette.
- Redesigning layout, navigation, or interaction behavior.

## Constraints

- Bun remains the runtime; no new runtime dependency is required.
- `src/core/theme.ts` remains framework-free and must not import UI or app code.
- Terminal detection uses `CliRenderer.themeMode`,
  `CliRenderer.waitForThemeMode()`, and the renderer's `theme_mode` event.
- The application must never write raw terminal detection sequences itself.
- The first automatic-mode wait is capped at 300 ms.
- Unknown detection falls back to dark but remains eligible for a later live
  update.
- A fixed environment override ignores terminal theme events for the entire
  run.
- Existing dark colors and dark-mode behavior remain unchanged unless a
  contrast test demonstrates that a role is currently invalid.
- Bundled image sources remain static imports resolved to bytes.
- Every navigation PNG, including light variants, is at most 128 by 128 pixels.

## Theme Model

`src/core/theme.ts` will export:

- `ThemeMode`, the union `"dark" | "light"`.
- `ThemePreference`, the union `"auto" | ThemeMode`.
- `Theme`, the semantic palette interface.
- `darkTheme` and `lightTheme`, each carrying its own `mode`.
- `themeFor(mode)`, which returns the corresponding immutable palette.
- `parseThemePreference(value)`, which accepts an unset value or `auto`,
  `light`, and `dark`, case-insensitively after trimming.
- `getSyntaxStyle(theme)`, cached independently per theme mode.

The static `theme` singleton export will be removed. UI components will read
the current palette through `useTheme()`. Pure helpers and factories outside a
React render will accept a `Theme` argument explicitly.

The palette remains semantic: surfaces, text roles, borders, interaction
states, severity/status colors, chip edges, and syntax roles are named for how
the UI uses them. Timeline styles will be derived from the active semantic
palette instead of capturing dark colors at module evaluation time.

The light palette will use the current Sentry light color ramps as its source.
Opaque terminal colors will be chosen for every surface; translucent web
tokens will be composited or replaced with their nearest opaque ramp step.
Where a source token misses a terminal contrast constraint, the nearest token
that passes will be used and documented beside the value.

## React Theme Boundary

A focused UI module will own `ThemeContext`, `ThemeProvider`, and `useTheme()`.
The context defaults to `darkTheme`, preserving dark-mode behavior for focused
component tests and isolated renderers that do not install the provider.

`ThemeProvider` receives:

- the initial `ThemeMode` resolved before first paint;
- a minimal renderer theme source exposing the current `themeMode` and event
  subscription methods; and
- whether the mode is fixed by an environment override.

In automatic mode, the provider subscribes to `theme_mode`. Immediately after
subscribing, it re-reads `renderer.themeMode` so an event delivered between the
initial startup read and React's effect cannot be missed. Each different mode
updates provider state and therefore the context palette. It does not use a
React `key` or otherwise remount `App`. The event listener is removed during
effect cleanup.

In fixed mode, the provider exposes the chosen palette and does not subscribe
to the renderer.

All UI theme consumers will move from the deleted singleton to `useTheme()`.
Theme-dependent factories, such as monitor columns and timeline styles, will
accept the active theme and include it in any relevant memo dependency list.
The error boundary will remain inside the provider so its crash screen also
uses the active palette.

## Startup and Data Flow

`runApp` will parse `SENTRY_TUI_THEME` before creating a renderer. This keeps an
invalid preference out of the alternate screen and lets the existing top-level
startup error path print the message normally.

For a fixed preference, `runApp` creates the renderer and renders immediately
with that mode. For `auto`, it creates the renderer, awaits
`renderer.waitForThemeMode(300)`, and uses the returned mode or `dark` for the
initial provider state. The provider then owns live updates.

The startup flow is:

```text
SENTRY_TUI_THEME
       |
       v
parse preference ---- invalid ----> normal startup error
       |
       +---- light/dark -----------> fixed ThemeProvider
       |
       +---- auto ----> OpenTUI initial detection (<=300 ms)
                              |
                              +---- light/dark --> automatic ThemeProvider
                              |
                              +---- unknown ----> dark initial palette
                                                      |
terminal theme_mode events ---------------------------+
                                                      v
                                            context update + re-render
```

The `app.session.started` log will add low-cardinality `theme` and
`theme_source` (`detected`, `fallback`, or `override`) attributes. Live
changes will not create a new telemetry name.

## Environment Interface

Accepted values are:

- unset or `auto`: detect initially and follow live changes;
- `light`: force light for the process;
- `dark`: force dark for the process.

Values are trimmed and compared case-insensitively. Any other non-empty value
throws:

```text
SENTRY_TUI_THEME must be auto, light, or dark
```

The variable and its behavior will be added to CLI help text.

## Palette-dependent Features

### Syntax highlighting

Syntax roles become part of `Theme`. `getSyntaxStyle(theme)` caches one native
`SyntaxStyle` per mode. `useSyntaxStyle()` reads the active theme and refreshes
its result when the mode changes, preventing a dark native style from surviving
inside a light render.

### Monitor timelines

`src/core/checkInTimeline.ts` will expose theme-dependent timeline style
factories rather than constants that capture the initial singleton. Callers
will derive or memoize styles from the active theme. Pending and empty tracks
will use the active border token.

### Navigation icons

The existing dark PNGs on `origin/main` are the 128 by 128 source set for this
branch. Matching light variants will use the same glyphs, dimensions, and
active/inactive semantics with a light canvas and light-palette foregrounds.
They will be committed at no more than 128 by 128 pixels.

Every new PNG will be statically imported beside the existing imports in
`src/assets/navIcons.ts`. The byte lookup will include the theme mode, and
`NavIcon`/`SentryLogo` will request the active variant. Existing tests will be
extended so every on-disk asset is imported, decodes, stays within the size
cap, and returns stable bytes for repeated lookups.

Terminals without kitty or sixel support will keep the existing text-only
layout; theme support will not make high-resolution images mandatory.

## Failure Behavior

- Invalid override: fail before renderer creation with the documented message.
- Unsupported or silent terminal: render dark after 300 ms and keep listening.
- Late valid detection: switch to the reported palette without resetting UI
  state.
- Repeated report of the active mode: no state update.
- Provider unmount: detach the renderer listener.
- Syntax style creation failure: retain the existing enhancement behavior;
  callers continue rendering plain code rather than blocking content.

Detection failure is an expected capability outcome, not an error report.

## Testing

Implementation follows test-driven development: each behavior is introduced by
a focused failing test and observed failing for the intended reason before
production code is added.

Automated coverage will include:

- preference parsing for unset, `auto`, `light`, `dark`, whitespace/case, and
  invalid values;
- initial auto detection, 300 ms fallback, and fixed-mode startup selection;
- a provider harness proving live `dark -> light -> dark` updates;
- a stateful child proving theme changes do not remount descendants;
- fixed overrides proving renderer events are ignored;
- listener cleanup;
- syntax styles changing with the palette;
- theme-derived timeline styles changing with the palette;
- the complete existing contrast matrix parameterized over both themes;
- light navigation asset coverage, decoding, dimensions, and stable byte
  identities;
- representative component rendering in light mode, including the app canvas,
  selection, status/chrome, and crash screen.

Final automated verification is `bun run check`.

Manual verification uses the required dev pane and covers:

```bash
SENTRY_TUI_THEME=light bun run start
SENTRY_TUI_THEME=dark bun run start
bun run start
```

The automatic run will be exercised with a terminal appearance change where
the host terminal forwards theme notifications. If the Herdr multiplexer does
not forward them, the provider's live-event integration test is the source of
truth for live switching, and the manual run still verifies the initial
fallback and both forced palettes.

## Success Criteria

- A light terminal opens directly into the light palette when it answers within
  300 ms.
- A terminal appearance change updates every visible color without changing
  the current application state.
- Forced light and dark modes never change in response to terminal events.
- Silent terminals remain usable in the unchanged dark palette.
- Both palettes pass all contrast, layout, interaction, dependency-boundary,
  and type checks.
- Navigation icons are visually native to both canvases and satisfy the
  current 128 by 128 binary-size guard.
