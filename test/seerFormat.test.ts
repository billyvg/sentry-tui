import { expect, test } from "bun:test";

import { isSessionSettled, isSessionStale, type SeerBlock, type SeerCallRecord } from "~/api/seer";
import { getNavGroup, navItems, soleNavItem } from "~/core/nav";
import {
  describeCallRecord,
  describeToolCalls,
  getBlockStatus,
  getCallRecordStatus,
  latestSeerTodos,
  seerSlashCommands,
  summarizeSeerCodeChanges,
  visibleCallRecords,
} from "~/core/seer";
import { wrapText } from "~/lib/text";
import { splitSeerMarkdown } from "~/ui/components/SeerMarkdown";
import {
  assistantBlockFixture,
  failedToolBlockFixture,
  seerProcessingSessionFixture,
  seerSessionFixture,
  toolBlockFixture,
} from "./seer-fixtures";

test("Seer has one destination, so the rail opens it directly", () => {
  expect(navItems(getNavGroup("seer"))).toEqual(["Ask Seer"]);
  expect(soleNavItem(getNavGroup("seer"))).toBe("Ask Seer");
});

test("groups with several destinations keep their secondary list", () => {
  for (const id of ["issues", "explore", "dashboards", "monitors"] as const) {
    expect(soleNavItem(getNavGroup(id))).toBeUndefined();
  }
});

test("wrapText breaks on spaces and keeps lines within the width", () => {
  const lines = wrapText("the quick brown fox jumps over the lazy dog", 12);
  expect(lines.every((line) => line.length <= 12)).toBe(true);
  expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
});

test("wrapText hard-splits a word too long to fit", () => {
  expect(wrapText("supercalifragilistic", 6)).toEqual(["superc", "alifra", "gilist", "ic"]);
});

test("wrapText preserves blank lines between paragraphs", () => {
  expect(wrapText("one\n\ntwo", 10)).toEqual(["one", "", "two"]);
});

test("a loading block outranks its tool status", () => {
  expect(getBlockStatus({ ...toolBlockFixture, loading: true })).toBe("loading");
});

test("a block with no tool calls is content", () => {
  expect(getBlockStatus(assistantBlockFixture)).toBe("content");
});

test("tool status is success, failure, or mixed by how many links errored", () => {
  expect(getBlockStatus(toolBlockFixture)).toBe("success");
  expect(getBlockStatus(failedToolBlockFixture)).toBe("failure");

  const mixed: SeerBlock = {
    ...toolBlockFixture,
    tool_links: [
      { kind: "a", params: { is_error: true } },
      { kind: "b", params: {} },
    ],
  };
  expect(getBlockStatus(mixed)).toBe("mixed");
});

test("a tool awaiting approval reads as pending", () => {
  const pending: SeerBlock = {
    ...toolBlockFixture,
    tool_links: [{ kind: "code_file_edit", params: { pending_approval: true } }],
  };
  expect(getBlockStatus(pending)).toBe("pending");
});

test("tool calls are phrased in present tense while loading and past tense when done", () => {
  expect(describeToolCalls({ ...toolBlockFixture, loading: true })).toEqual([
    "Reading checkout.py from store…",
  ]);
  expect(describeToolCalls(toolBlockFixture)).toEqual(["Read checkout.py from store"]);
});

test("an unknown tool still produces a readable line", () => {
  const unknown: SeerBlock = {
    ...toolBlockFixture,
    message: {
      role: "tool_use",
      content: null,
      tool_calls: [{ function: "brand_new_tool", id: "c", args: "{}" }],
    },
  };
  expect(describeToolCalls(unknown)).toEqual(["Used brand_new_tool tool"]);
});

test("malformed tool arguments fall back rather than throwing", () => {
  const broken: SeerBlock = {
    ...toolBlockFixture,
    message: {
      role: "tool_use",
      content: null,
      tool_calls: [{ function: "code_search", id: "c", args: "not json" }],
    },
  };
  expect(describeToolCalls(broken)).toEqual(["Searched code in the codebase"]);
});

test("a session is settled only when it is done and nothing is loading", () => {
  expect(isSessionSettled(seerSessionFixture)).toBe(true);
  expect(isSessionSettled(seerProcessingSessionFixture)).toBe(false);
  expect(isSessionSettled(null)).toBe(false);
});

test("staleness is measured from updated_at, which the API sends as naive UTC", () => {
  const session = { ...seerSessionFixture, updated_at: "2026-08-20T12:00:00.000000" };
  const updatedAt = Date.parse("2026-08-20T12:00:00.000Z");
  expect(isSessionStale(session, updatedAt + 1_000)).toBe(false);
  expect(isSessionStale(session, updatedAt + 130_000)).toBe(true);
});

test("Seer slash commands follow employee and organization feature gates", () => {
  const publicCommands = seerSlashCommands(
    {
      available: true,
      employee: false,
      codeMode: true,
      bashMode: true,
      thinking: false,
      embeds: true,
      infraTelemetry: false,
      streaming: true,
    },
    { hasRun: true },
  );
  expect(publicCommands.map((command) => command.title)).toEqual(["/new", "/history"]);

  const employeeCommands = seerSlashCommands(
    {
      available: true,
      employee: true,
      codeMode: true,
      bashMode: false,
      thinking: true,
      embeds: true,
      infraTelemetry: false,
      streaming: true,
    },
    { hasRun: true, hasCodeChanges: true },
  );
  expect(employeeCommands.map((command) => command.title)).toContain("/code-mode-only");
  expect(employeeCommands.map((command) => command.title)).toContain("/conversations");
  expect(employeeCommands.map((command) => command.title)).toContain("/create-pr");
  expect(employeeCommands.map((command) => command.title)).not.toContain("/bash-mode-on");
});

test("Code Mode call records hide grouping libs and retain concrete outcomes", () => {
  const records: SeerCallRecord[] = [
    { id: 1, kind: "lib", name: "get_issue_details" },
    {
      id: 2,
      kind: "api",
      parent: 1,
      title: "Get issue details",
      status: 200,
      method: "GET",
      resolved_path: "/api/0/issues/42/",
    },
  ];
  expect(visibleCallRecords(records)).toEqual([records[1]!]);
  expect(describeCallRecord(records[1]!)).toBe("Get issue details");
  expect(getCallRecordStatus(records[1]!, true)).toBe("success");
  expect(getCallRecordStatus({ ...records[1]!, status: 500 }, true)).toBe("failure");
});

test("the newest Code Mode todo snapshot wins over legacy block todos", () => {
  const first: SeerBlock = {
    ...toolBlockFixture,
    todos: [{ content: "Old", status: "completed" }],
  };
  const second: SeerBlock = {
    ...toolBlockFixture,
    id: "second",
    tool_results: [
      {
        tool_call_function: "sentry_api_execute",
        tool_call_id: "call-1",
        content: "",
        structuredContent: { todos: [{ content: "New", status: "in_progress" }] },
      },
    ],
  };
  expect(latestSeerTodos([first, second])).toEqual({
    blockId: "second",
    todos: [{ content: "New", status: "in_progress" }],
  });
});

test("Seer Markdown separates block embeds and flattens inline embeds", () => {
  const content = [
    'See {% docs %}{"title":"Tracing docs","href":"https://docs.sentry.io/tracing/"}{% /docs %}.',
    "",
    '{% chart %}{"title":"Errors","series":[]}{% /chart %}',
  ].join("\n");
  expect(splitSeerMarkdown(content, true)).toEqual([
    {
      kind: "markdown",
      content: "See [Tracing docs](https://docs.sentry.io/tracing/).\n\n",
    },
    { kind: "embed", name: "chart", data: { title: "Errors", series: [] } },
  ]);
});

test("Seer Markdown resolves self-closing structured approval embeds", () => {
  expect(
    splitSeerMarkdown("{% agentWriteApproval /%}", true, {
      agentWriteApproval: {
        inputId: "input-1",
        requiredScopes: ["project:write"],
        sessionId: "session-1",
        status: "pending",
      },
    }),
  ).toEqual([
    {
      kind: "embed",
      name: "agentWriteApproval",
      data: {
        inputId: "input-1",
        requiredScopes: ["project:write"],
        sessionId: "session-1",
        status: "pending",
      },
    },
  ]);
});

test("Code Mode patches are reduced to current file and PR sync state", () => {
  const changes = summarizeSeerCodeChanges(
    [
      {
        ...toolBlockFixture,
        merged_file_patches: [
          {
            repo_name: "getsentry/app",
            diff: "+old",
            patch: { path: "src/app.ts", added: 1, removed: 0 },
          },
        ],
        pr_commit_shas: { "getsentry/app": "old" },
      },
      {
        ...toolBlockFixture,
        id: "newer",
        merged_file_patches: [
          {
            repo_name: "getsentry/app",
            diff: "+new",
            patch: { path: "src/app.ts", added: 3, removed: 1 },
          },
        ],
        pr_commit_shas: { "getsentry/app": "new" },
      },
    ],
    {
      "getsentry/app": {
        repo_name: "getsentry/app",
        branch_name: "seer/fix",
        commit_sha: "old",
        pr_creation_error: null,
        pr_creation_status: "completed",
        pr_id: 1,
        pr_number: 42,
        pr_url: "https://github.com/getsentry/app/pull/42",
        title: "Fix app",
      },
    },
  );

  expect(changes).toEqual([
    {
      repoName: "getsentry/app",
      added: 3,
      removed: 1,
      files: [{ path: "src/app.ts", added: 3, removed: 1 }],
      prNumber: 42,
      prUrl: "https://github.com/getsentry/app/pull/42",
      status: "needs_push",
    },
  ]);
});
