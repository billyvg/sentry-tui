/** Bun file imports resolve to paths in source and compiled binaries. */
declare module "@opentui/core/parser.worker" {
  const path: string;
  export default path;
}

declare module "*.scm" {
  const path: string;
  export default path;
}

declare module "*.wasm" {
  const path: string;
  export default path;
}
