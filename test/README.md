# Test organization

## Placement

| Directory           | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `test/`             | Integration tests, fixtures, shared helpers   |
| `scripts/*.test.ts` | Structural / CI checks (contrast, boundaries) |
| `src/**/*.test.ts`  | Colocated unit tests (when added)             |

## Running

```bash
bun test                              # all tests
bun test ./test                       # integration tests only
bun run test:shard 1 4                # shard 1 of 4, the way CI runs it
bun run test:theme-contrast           # WCAG contrast compliance
bun run test:boundaries               # source import boundary audit
bun run deps:check                    # full dependency-cruiser graph check
bun run check                         # all CI checks (format, lint, typecheck, deps, tests)
```

## Sharding

CI runs the suite as four parallel jobs. `bun test` has no `--shard`, so
`scripts/test-shard.ts` does the split: it discovers every test file the bare
command would run and packs them into shards of roughly equal weight, using
file size as a stand-in for runtime. A new test file joins a shard on its own —
there is no list to update.

`scripts/test-shard.test.ts` keeps it honest: the shards must partition the
suite exactly once each, and the workflow matrices must ask for every shard the
planner makes. Change the shard count in `CI_SHARD_TOTAL` and both
`.github/workflows/ci.yml` and `.github/workflows/release.yml` have to follow,
or that test fails.

## Fixtures

`test/fixtures.ts` contains golden Sentry API response data for deterministic
testing without network or tokens. Use these for all component/screen tests.

## Helpers

`test/helpers.tsx` provides `renderHarness()` — wraps OpenTUI's `testRender`
with `act()` integration, escape key handling, and cleanup. Always use
`harness.press()` for key input so React state updates flush before assertions.

## Writing tests

- Wrap key inputs in `harness.press()` (not raw `mockInput`) for proper React flushing
- Always call `harness.cleanup()` in a `finally` block or use `afterEach`
- Use `harness.frame()` (shorthand for `captureCharFrame()`) for text assertions
- Loading states have no clock to fake. `await act(…)` does not settle until
  React's act queue is observed empty, and a test holding a fetch in flight
  holds every `setInterval` in the tree alive with it — so a screen that ticks
  while loading hangs the test rather than rendering a frame. OpenTUI's
  `ManualClock` does not help: it drives the renderer, not React's timers. The
  rule instead is that only a leaf may tick, and `scripts/source-boundaries.test.ts`
  ("animation clocks") enforces it — anything needing to re-render mid-request
  rides the status bar's spinner.
