/**
 * Enforces module boundaries on the production import graph.
 *
 * The architecture has four tiers, each importing strictly downward:
 *
 *   src/lib/       → dependency-free helpers (text width, color, time-ago, sparkline)
 *   src/telemetry/ → Sentry SDK wrapper; a leaf, called from every tier above
 *   src/api/    → Sentry HTTP client, auth, zod schemas, domain types
 *   src/core/   → store, actions, reducer, selectors, commands, theme
 *   src/ui/     → OpenTUI surface — screens, components, hooks
 *   src/main.tsx → CLI entry
 *
 * Pre-existing violations live in .dependency-cruiser-known-violations.json;
 * that baseline is shrink-only. `bun run deps:check` fails on any violation
 * not in the baseline.
 */

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Import cycles make every member file one module in disguise: none can be understood, tested, or extracted alone.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "lib-is-a-leaf",
      comment:
        "src/lib holds dependency-free helpers usable from any tier; it must not import from other src/ directories.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/", pathNot: "^src/lib/" },
    },
    {
      name: "telemetry-is-a-leaf",
      comment:
        "src/telemetry wraps the Sentry SDK and is called from every tier, so it must depend on none of them; it may use src/lib.",
      severity: "error",
      from: { path: "^src/telemetry/" },
      to: { path: "^src/", pathNot: "^src/(telemetry|lib)/" },
    },
    {
      name: "api-stays-below-core-and-ui",
      comment:
        "src/api provides the Sentry HTTP client and domain types. It may use src/lib but never the store, commands, or UI above it.",
      severity: "error",
      from: { path: "^src/api/" },
      to: { path: "^src/(core|ui|app)/" },
    },
    {
      name: "core-stays-domain",
      comment:
        "src/core is the domain model (store, reducer, commands, theme). It may use src/lib and src/api types, but never the UI or app composition above it.",
      severity: "error",
      from: { path: "^src/core/" },
      to: { path: "^src/(ui|app)/" },
    },
    {
      name: "app-stays-below-ui",
      comment:
        "src/app wires core + api together for startup. The UI imports app — never the reverse.",
      severity: "error",
      from: { path: "^src/app/" },
      to: { path: "^src/ui/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Production graph only: tests are free to reach across boundaries.
    exclude: { path: ["\\.test\\.(ts|tsx)$", "(^|/)node_modules/", "^test/"] },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      mainFields: ["module", "main", "types"],
    },
  },
};
