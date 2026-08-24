import parserWorkerPath from "@opentui/core/parser.worker" with { type: "file" };

interface OpenTuiEnvironment {
  [name: string]: string | undefined;
  OTUI_TREE_SITTER_WORKER_PATH?: string;
}

/** Point OpenTUI at the worker file Bun embeds in compiled binaries. */
export function configureOpenTuiRuntime(environment: OpenTuiEnvironment = process.env): void {
  if (!environment.OTUI_TREE_SITTER_WORKER_PATH) {
    environment.OTUI_TREE_SITTER_WORKER_PATH = parserWorkerPath;
  }
}
