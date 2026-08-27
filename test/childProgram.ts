/**
 * Running a scrap of Bun source in a process of its own.
 *
 * For the handful of behaviours that cannot be observed from inside the
 * process they happen to — `execve` replacing this image, `process.exit`
 * carrying a status out — where the test runner would be the casualty.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ChildResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Name of the signal that killed it, e.g. `SIGTERM`; null on a clean exit. */
  signalCode: string | null;
}

/**
 * Write `source` to a temp file, run it under this Bun, and collect the result.
 *
 * The file lands outside the repo, so imports in `source` must be absolute —
 * Bun still applies the `~/` aliases of whatever project the imported file
 * belongs to, so reaching into workspace source works from there.
 *
 * `args` arrive as the program's own `process.argv.slice(2)`, for code that
 * reads them.
 *
 * Anything the program prints must be written with `writeSync`: stdout is a
 * pipe here, and a buffered `console.log` is lost if the process is replaced
 * or exits before Bun flushes.
 */
export function runBunProgram(
  source: string,
  env: Record<string, string> = {},
  args: readonly string[] = [],
): ChildResult {
  const dir = mkdtempSync(join(tmpdir(), "sentry-tui-child-"));
  const file = join(dir, "program.ts");
  writeFileSync(file, source);

  try {
    const result = Bun.spawnSync([process.execPath, file, ...args], {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
      signalCode: result.signalCode ?? null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
