import { destroyTreeSitterClient, getTreeSitterClient } from "@opentui/core";

import { registerSyntaxParsers } from "~/assets/syntaxParsers";

const SYNTAX_CASES = [
  {
    content: 'def process_job():\n    raise HTTPError("boom")',
    filetype: "python",
    groups: ["keyword", "function"],
  },
  {
    content: 'def process_job; raise HTTPError, "boom"; end',
    filetype: "ruby",
    groups: ["keyword", "function.method"],
  },
  {
    content: 'function processJob(): void { throw new RuntimeException("boom"); }',
    filetype: "php",
    groups: ["keyword", "function"],
  },
  {
    content: 'func processJob() error { return errors.New("boom") }',
    filetype: "go",
    groups: ["keyword", "function"],
  },
  {
    content: "function processJob() { return true; }",
    filetype: "javascript",
    groups: ["keyword", "function"],
  },
] as const;

/** Verify stack-frame and built-in parsers through OpenTUI's shared runtime client. */
export async function verifySyntaxRuntime(): Promise<void> {
  registerSyntaxParsers();
  const client = getTreeSitterClient();

  try {
    for (const syntaxCase of SYNTAX_CASES) {
      const result = await client.highlightOnce(syntaxCase.content, syntaxCase.filetype);
      const highlightedGroups = new Set(result.highlights?.map((highlight) => highlight[2]));
      const missingGroups = syntaxCase.groups.filter((group) => !highlightedGroups.has(group));
      if (missingGroups.length > 0) {
        throw new Error(
          `${syntaxCase.filetype} syntax highlighting unavailable: ${
            result.error ?? result.warning ?? `missing ${missingGroups.join(", ")}`
          }`,
        );
      }
    }

    if (await client.preloadParser("zig")) {
      throw new Error("zig syntax highlighting should not be bundled");
    }
  } finally {
    await destroyTreeSitterClient();
  }
}
