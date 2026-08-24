import { addDefaultParsers } from "@opentui/core";

import pythonHighlights from "~/assets/tree-sitter/python/highlights.scm" with { type: "file" };
import pythonWasm from "~/assets/tree-sitter/python/tree-sitter-python.wasm" with { type: "file" };

/** Register syntax parsers that sentry-tui adds to OpenTUI's built-in set. */
export function registerSyntaxParsers(): void {
  addDefaultParsers([
    {
      filetype: "python",
      wasm: pythonWasm,
      queries: { highlights: [pythonHighlights] },
    },
  ]);
}
