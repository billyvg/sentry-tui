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
bun run test:theme-contrast           # WCAG contrast compliance
bun run test:boundaries               # source import boundary audit
bun run deps:check                    # full dependency-cruiser graph check
bun run check                         # all CI checks (format, lint, typecheck, deps, tests)
```

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
- For loading states, `ManualClock` from OpenTUI makes timers deterministic
