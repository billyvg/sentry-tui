/**
 * Presentation rules for Seer Explorer conversations.
 *
 * The agent reports what it is doing as raw tool calls (`code_search` with a
 * JSON blob of arguments). Sentry's web UI turns those into the running
 * commentary users actually read — "Reading app.tsx from getsentry/sentry…" —
 * via the formatter registry in `static/app/views/seerExplorer/utils.tsx`.
 * This is that registry, ported.
 */

import type { SeerBlock, SeerToolCall, SeerToolLink } from "~/api/seer";

/** Status of a block, driving the glyph shown beside it. */
export type SeerBlockStatus = "loading" | "content" | "pending" | "success" | "failure" | "mixed";

/** Prompts offered on the empty state, matching the web app's. */
export const SEER_SUGGESTED_QUESTIONS: readonly string[] = [
  "Which of my open issues are getting worse, not better?",
  "What are my slowest DB queries?",
  "Walk me through what's on my screen and what I can focus on next.",
];

/**
 * Placeholder shown on the optimistic assistant block, before the first poll
 * comes back with real content.
 */
export const SEER_THINKING_PLACEHOLDERS: readonly string[] = [
  "Looking around…",
  "One sec…",
  "Following breadcrumbs…",
  "Hold tight…",
  "Gathering threads…",
  "Tracing the answer…",
  "Stacking ideas…",
  "Profiling your project…",
  "Span by span…",
  "Rolling logs…",
  "Replaying prod…",
  "Scanning the error-waves…",
];

/** Glyph for each block status, in the same vocabulary as the web's icons. */
export const SEER_STATUS_GLYPH: Record<SeerBlockStatus, string> = {
  loading: "◐",
  content: "•",
  pending: "?",
  success: "✓",
  failure: "✗",
  mixed: "!",
};

/**
 * Roll a block's tool calls up into one status.
 *
 * Ported from `getBlockStatus`: a block is only a failure when *every* tool
 * failed, so a partially-successful step still reads as progress.
 */
export function getBlockStatus(block: SeerBlock): SeerBlockStatus {
  if (block.loading) return "loading";
  if (!block.message.tool_calls?.length) return "content";

  const links = (block.tool_links ?? []).filter((link): link is SeerToolLink => link != null);
  if (links.some((link) => link.params?.pending_approval || link.params?.pending_question)) {
    return "pending";
  }
  if (links.length === 0) return "success";

  const failures = links.filter((link) => link.params?.is_error === true).length;
  if (failures === 0) return "success";
  if (failures === links.length) return "failure";
  return "mixed";
}

/** Tool arguments arrive as a JSON string that may be absent or malformed. */
function parseArgs(tool: SeerToolCall): Record<string, unknown> {
  if (!tool.args) return {};
  try {
    const parsed: unknown = JSON.parse(tool.args);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Short form of an id, matching the web's 8-character truncation. */
function shortId(value: string | undefined): string {
  return value ? value.slice(0, 8) : "";
}

/** Repository name without its owner prefix, which rarely adds information. */
function repoName(args: Record<string, unknown>): string {
  const repo = str(args, "repo_name") ?? str(args, "repo");
  if (!repo) return "the codebase";
  const slash = repo.lastIndexOf("/");
  return slash === -1 ? repo : repo.slice(slash + 1);
}

/** Present-tense phrasing while a tool runs; past tense once it has finished. */
function describeTool(tool: SeerToolCall, loading: boolean): string {
  const args = parseArgs(tool);
  const [now, done] = phrasesFor(tool.function, args);
  return loading ? `${now}…` : done;
}

/**
 * The formatter registry: tool name to a [present, past] phrase pair.
 *
 * Unknown tools fall back to "Using/Used <name> tool" rather than being
 * hidden, so a newly shipped Seer tool still shows up as visible progress.
 */
function phrasesFor(fn: string, args: Record<string, unknown>): [string, string] {
  switch (fn) {
    case "telemetry_index_list_nodes": {
      const keyword = str(args, "keyword") ?? "your services";
      return [`Scanning for ${keyword}`, `Scanned for ${keyword}`];
    }
    case "telemetry_index_dependencies": {
      const title = str(args, "title") ?? "your services";
      return [`Tracing the flow of ${title}`, `Traced the flow of ${title}`];
    }
    case "google_search": {
      const question = str(args, "question") ?? str(args, "query") ?? "";
      return [`Googling '${question}'`, `Googled '${question}'`];
    }
    case "telemetry_live_search": {
      const question = str(args, "question") ?? "";
      const dataset = str(args, "dataset");
      const noun =
        dataset === "issues"
          ? "issues"
          : dataset === "errors"
            ? "errors"
            : dataset === "logs"
              ? "logs"
              : dataset === "metrics"
                ? "metrics"
                : "spans";
      return [`Searching ${noun}: '${question}'`, `Searched ${noun}: '${question}'`];
    }
    case "get_trace_waterfall": {
      const spanId = str(args, "span_id");
      if (spanId)
        return [`Digging into span ${shortId(spanId)}`, `Dug into span ${shortId(spanId)}`];
      const traceId = shortId(str(args, "trace_id"));
      return [`Viewing waterfall for trace ${traceId}`, `Viewed waterfall for trace ${traceId}`];
    }
    case "get_issue_details": {
      const issue = str(args, "issue_id") ?? str(args, "short_id") ?? "";
      return [`Inspecting issue ${issue}`, `Inspected issue ${issue}`];
    }
    case "get_event_details": {
      const event = shortId(str(args, "event_id"));
      return [`Analyzing event ${event}`, `Analyzed event ${event}`];
    }
    case "code_search": {
      const repo = repoName(args);
      const mode = str(args, "mode");
      if (mode === "read_file") {
        const path = str(args, "path") ?? "a file";
        return [`Reading ${path} from ${repo}`, `Read ${path} from ${repo}`];
      }
      if (mode === "find_files") {
        const pattern = str(args, "pattern") ?? "";
        return [
          `Finding files matching '${pattern}' in ${repo}`,
          `Found files matching '${pattern}' in ${repo}`,
        ];
      }
      if (mode === "search_content") {
        const pattern = str(args, "pattern") ?? "";
        return [`Searching for '${pattern}' in ${repo}`, `Searched for '${pattern}' in ${repo}`];
      }
      return [`Searching code in ${repo}`, `Searched code in ${repo}`];
    }
    case "git_search": {
      const repo = repoName(args);
      const sha = str(args, "sha") ?? str(args, "commit_sha");
      if (sha) {
        return [
          `Digging up commit ${shortId(sha)} from ${repo}`,
          `Dug up commit ${shortId(sha)} from ${repo}`,
        ];
      }
      const path = str(args, "file_path") ?? "";
      return [
        `Excavating commits affecting '${path}' in ${repo}`,
        `Excavated commits affecting '${path}' in ${repo}`,
      ];
    }
    case "get_replay_details": {
      const replay = shortId(str(args, "replay_id"));
      return [`Watching replay ${replay}`, `Watched replay ${replay}`];
    }
    case "get_profile_flamegraph": {
      const profile = shortId(str(args, "profile_id"));
      return [`Sampling profile ${profile}`, `Sampled profile ${profile}`];
    }
    case "code_file_edit": {
      const path = str(args, "path") ?? "a file";
      const repo = repoName(args);
      return [`Editing ${path} in ${repo}`, `Edited ${path} in ${repo}`];
    }
    case "code_file_write": {
      const path = str(args, "path") ?? "a file";
      const repo = repoName(args);
      return [`Writing ${path} in ${repo}`, `Wrote ${path} in ${repo}`];
    }
    case "search_sentry_docs": {
      const question = str(args, "question") ?? "";
      return [`Scouring Sentry docs: '${question}'`, `Scoured Sentry docs: '${question}'`];
    }
    case "todo_write":
      return ["Updating todos", "Updated todos"];
    case "ask_user_question":
      return ["Asking a question", "Asked a question"];
    default: {
      if (fn.startsWith("artifact_write_")) {
        const artifact = fn.replace("artifact_write_", "").replace(/_/g, " ");
        return [`Submitting ${artifact} artifact`, `Submitted ${artifact} artifact`];
      }
      return [`Using ${fn} tool`, `Used ${fn} tool`];
    }
  }
}

/**
 * The lines to render for a `tool_use` block — one per tool call, phrased for
 * the block's loading state.
 */
export function describeToolCalls(block: SeerBlock): string[] {
  const calls = block.message.tool_calls ?? [];
  return calls.map((tool) => describeTool(tool, Boolean(block.loading)));
}
