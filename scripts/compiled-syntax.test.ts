import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Decode a spawned process stream for useful assertion failures. */
function output(stream: Uint8Array): string {
  return new TextDecoder().decode(stream);
}

test("compiled binaries embed the OpenTUI worker and Python grammar", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sentry-tui-python-syntax-"));
  const binary = join(tempDir, process.platform === "win32" ? "probe.exe" : "probe");

  try {
    const build = Bun.spawnSync(
      [process.execPath, "run", join(ROOT, "scripts/build-bin.ts"), "--outfile", binary],
      { cwd: ROOT, stderr: "pipe", stdout: "pipe" },
    );
    expect(output(build.stderr)).toBe("");
    expect(build.exitCode).toBe(0);

    const run = Bun.spawnSync([binary, "--version"], {
      cwd: ROOT,
      env: {
        ...process.env,
        OTUI_TREE_SITTER_WORKER_PATH: "",
        SENTRY_TUI_VERIFY_SYNTAX: "1",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(output(run.stderr)).toBe("");
    expect(run.exitCode).toBe(0);
    expect(output(run.stdout)).toBe("syntax parsers verified\n");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}, 30_000);
