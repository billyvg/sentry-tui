import { addDefaultParsers } from "@opentui/core";

import goHighlights from "~/assets/tree-sitter/go/highlights.scm" with { type: "file" };
import goWasm from "~/assets/tree-sitter/go/tree-sitter-go.wasm" with { type: "file" };
import phpHighlights from "~/assets/tree-sitter/php/highlights.scm" with { type: "file" };
import phpWasm from "~/assets/tree-sitter/php/tree-sitter-php-only.wasm" with { type: "file" };
import pythonHighlights from "~/assets/tree-sitter/python/highlights.scm" with { type: "file" };
import pythonWasm from "~/assets/tree-sitter/python/tree-sitter-python.wasm" with { type: "file" };
import rubyHighlights from "~/assets/tree-sitter/ruby/highlights.scm" with { type: "file" };
import rubyWasm from "~/assets/tree-sitter/ruby/tree-sitter-ruby.wasm" with { type: "file" };

/** Register syntax parsers that sentry-tui adds to OpenTUI's built-in set. */
export function registerSyntaxParsers(): void {
  addDefaultParsers([
    {
      filetype: "python",
      wasm: pythonWasm,
      queries: { highlights: [pythonHighlights] },
    },
    {
      filetype: "ruby",
      wasm: rubyWasm,
      queries: { highlights: [rubyHighlights] },
    },
    {
      // Stack-frame context is usually a snippet without an opening <?php tag.
      filetype: "php",
      wasm: phpWasm,
      queries: { highlights: [phpHighlights] },
    },
    {
      filetype: "go",
      wasm: goWasm,
      queries: { highlights: [goHighlights] },
    },
  ]);
}
