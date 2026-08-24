import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { releasePackageStatus, resolveReleaseVersion } from "./release.ts";

describe("release version", () => {
  test("defaults to the next minor version", () => {
    expect(resolveReleaseVersion("0.5.0", [], [])).toBe("0.6.0");
  });

  test("increments the selected semver part", () => {
    expect(resolveReleaseVersion("1.2.3", [], ["major"])).toBe("2.0.0");
    expect(resolveReleaseVersion("1.2.3", [], ["minor"])).toBe("1.3.0");
    expect(resolveReleaseVersion("1.2.3", [], ["patch"])).toBe("1.2.4");
  });

  test("keeps an exact request and drops prerelease suffixes from bumps", () => {
    expect(resolveReleaseVersion("1.2.3", ["2.0.0-beta.1"], [])).toBe("2.0.0-beta.1");
    expect(resolveReleaseVersion("1.2.3-beta.1", [], ["patch"])).toBe("1.2.4");
  });

  test("rejects ambiguous version selections", () => {
    expect(() => resolveReleaseVersion("1.2.3", [], ["major", "patch"])).toThrow();
    expect(() => resolveReleaseVersion("1.2.3", ["2.0.0"], ["major"])).toThrow();
    expect(() => resolveReleaseVersion("1.2.3", ["2.0.0", "2.1.0"], [])).toThrow();
  });

  test("the cut command applies bump flags before release checks", () => {
    const result = Bun.spawnSync(
      [process.execPath, "run", "./scripts/release.ts", "cut", "--major", "--patch"],
      {
        cwd: join(import.meta.dirname, ".."),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("choose one of --major, --minor, or --patch");
  });

  test("the cut command rejects a repeated bump flag", () => {
    const result = Bun.spawnSync(
      [process.execPath, "run", "./scripts/release.ts", "cut", "--major", "--major"],
      {
        cwd: join(import.meta.dirname, ".."),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("choose one of --major, --minor, or --patch");
  });

  test("the preflight command applies bump flags before release checks", () => {
    const result = Bun.spawnSync(
      [process.execPath, "run", "./scripts/release.ts", "preflight", "--major", "--patch"],
      {
        cwd: join(import.meta.dirname, ".."),
        env: { ...process.env, PATH: "" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("choose one of --major, --minor, or --patch");
  });
});

describe("release package status", () => {
  test("detects an existing exact version when latest points elsewhere", async () => {
    const requested: string[] = [];
    const status = await releasePackageStatus("example", "1.5.0", async (spec) => {
      requested.push(spec);
      return spec === "example" ? "2.0.0" : "1.5.0";
    });

    expect(status).toEqual({ latest: "2.0.0", targetPublished: true });
    expect(requested).toEqual(["example", "example@1.5.0"]);
  });
});
