/**
 * `replaceProcess` can only be observed from outside: when it works, the
 * process running the assertions is the one that disappears. So each case here
 * stands up a small Bun program, has it exec something that reports on itself,
 * and reads the result back.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBunProgram } from "../../test/childProgram";
import { replaceProcess } from "~/lib/exec";

const MODULE = join(import.meta.dirname, "exec.ts");

/** Run `body` as a Bun program with `replaceProcess` and `say` in scope. */
function runChild(body: string, env: Record<string, string> = {}) {
  return runBunProgram(
    `import { writeSync } from "node:fs";\n` +
      `import { replaceProcess } from ${JSON.stringify(MODULE)};\n` +
      `const say = (line: string) => writeSync(1, line + "\\n");\n` +
      body,
    env,
  );
}

test("the program that takes over keeps the caller's pid", () => {
  // The whole of #101: a spawn reports a fresh pid with the Bun process still
  // sitting above it, and a session's worth of updates leaves a stack of them.
  const { stdout, exitCode } = runChild(
    `say("before " + process.pid);\n` +
      `replaceProcess("/bin/sh", ["-c", 'echo "after $$"']);\n` +
      `say("fell through");\n`,
  );

  const before = stdout.match(/before (\d+)/)?.[1];

  expect(before).toBeDefined();
  expect(stdout.match(/after (\d+)/)?.[1]).toBe(before);
  expect(stdout).not.toContain("fell through");
  expect(exitCode).toBe(0);
});

test("it forwards argv after the program's own name", () => {
  const { stdout } = runChild(
    `replaceProcess("/bin/sh", ["-c", 'echo "argv0=$0 rest=$*"', "zero", "one", "two"]);\n`,
  );

  // `sh -c script name args…` names the script `$0`, so "zero" landing there
  // proves argv started one slot after the path, the way a shell sets it.
  expect(stdout.trim()).toBe("argv0=zero rest=one two");
});

test("it hands over the environment it is given, not the one it inherited", () => {
  const { stdout } = runChild(
    `process.env.ADDED_AT_RUNTIME = "carried";\n` +
      `replaceProcess("/bin/sh", ["-c", 'echo "$INHERITED/$ADDED_AT_RUNTIME"']);\n`,
    { INHERITED: "kept" },
  );

  // Assignments to `process.env` reach the new image because the environment
  // is marshalled from it explicitly — that is what carries SENTRY_TUI_MANAGED
  // through a restart, so the new build can offer the next update in turn.
  expect(stdout.trim()).toBe("kept/carried");
});

test("the exec'd program's exit status is the process's own", () => {
  // Nothing propagates it — there is no wait and no parent to forward it,
  // which is precisely why it is right.
  expect(runChild(`replaceProcess("/bin/sh", ["-c", "exit 7"]);\n`).exitCode).toBe(7);
});

test("a program that is not there returns false instead of throwing", () => {
  // Safe in-process: this is the call that comes back.
  expect(replaceProcess(join(tmpdir(), "sentry-tui-no-such-binary"))).toBe(false);
});

test("a file that is not executable returns false too", () => {
  const dir = mkdtempSync(join(tmpdir(), "sentry-tui-exec-test-"));
  const file = join(dir, "not-executable");
  writeFileSync(file, "not a program\n");
  try {
    expect(replaceProcess(file)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
