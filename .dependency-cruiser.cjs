/**
 * Enforces both workspace ownership and the app's internal production tiers.
 *
 *   app -> runtime-contract <- runtime-host
 *                                  |
 *                               launcher
 *
 * The host also embeds the app as its cold-start fallback. The inverse edge is
 * forbidden: a replaceable app payload can only use host behavior through the
 * implementation-independent runtime contract.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Import cycles make every member file one module in disguise.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "app-does-not-import-host",
      comment: "The replaceable app may use runtime-contract, never runtime-host.",
      severity: "error",
      from: { path: "^packages/app/" },
      to: { path: "^packages/runtime-host/" },
    },
    {
      name: "app-does-not-import-launcher",
      comment: "Launcher and cache implementation belong to the runtime host.",
      severity: "error",
      from: { path: "^packages/app/" },
      to: { path: "^packages/launcher/" },
    },
    {
      name: "runtime-contract-is-independent",
      comment: "The shared contract defines interfaces and depends on no implementation package.",
      severity: "error",
      from: { path: "^packages/runtime-contract/" },
      to: { path: "^packages/(app|runtime-host|launcher)/" },
    },
    {
      name: "launcher-is-standalone",
      comment: "The plain Node launcher cannot depend on Bun or application source.",
      severity: "error",
      from: { path: "^packages/launcher/" },
      to: { path: "^packages/(app|runtime-host|runtime-contract)/" },
    },
    {
      name: "lib-is-a-leaf",
      comment: "App lib holds dependency-free helpers usable from every app tier.",
      severity: "error",
      from: { path: "^packages/app/src/lib/" },
      to: { path: "^packages/app/src/", pathNot: "^packages/app/src/lib/" },
    },
    {
      name: "api-stays-below-core-and-ui",
      comment: "The app API may use lib and runtime contracts, never core or UI.",
      severity: "error",
      from: { path: "^packages/app/src/api/" },
      to: { path: "^packages/app/src/(core|ui)/" },
    },
    {
      name: "core-stays-domain",
      comment: "The app core may use lib and API types, never UI composition.",
      severity: "error",
      from: { path: "^packages/app/src/core/" },
      to: { path: "^packages/app/src/ui/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["\\.test\\.(ts|tsx)$", "(^|/)node_modules/", "^test/"] },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
      mainFields: ["module", "main", "types"],
    },
  },
};
