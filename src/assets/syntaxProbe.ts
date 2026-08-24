import { destroyTreeSitterClient, getTreeSitterClient } from "@opentui/core";

import { registerSyntaxParsers } from "~/assets/syntaxParsers";

const SYNTAX_CASES = [
  {
    content: 'def process_job():\n    raise HTTPError("boom")',
    filetype: "python",
    groups: ["keyword", "function"],
  },
  {
    content: "function processJob() { return true; }",
    filetype: "javascript",
    groups: ["keyword", "function"],
  },
] as const;

/** Verify custom and built-in parsers through OpenTUI's shared runtime client. */
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
  } finally {
    await destroyTreeSitterClient();
  }
}
