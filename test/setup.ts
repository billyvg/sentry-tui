/**
 * Preloaded before any test module (see `bunfig.toml`).
 *
 * OpenTUI's reconciler root commits the initial mount outside our control, so
 * React logs an act() warning per test even though `renderHarness` flushes
 * before every assertion. Declaring an act environment silences that noise so
 * genuine warnings stay visible.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
