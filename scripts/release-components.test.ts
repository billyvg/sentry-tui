import { describe, expect, test } from "bun:test";

import { changedReleaseComponents, releaseComponentsForPath } from "./release-components.ts";

describe("release component ownership", () => {
  test("ordinary product code releases only the replaceable app", () => {
    expect(releaseComponentsForPath("src/ui/screens/IssuesScreen.tsx")).toEqual(["app"]);
    expect(releaseComponentsForPath("src/api/issues.ts")).toEqual(["app"]);
  });

  test("runtime and launcher changes release only the host", () => {
    expect(releaseComponentsForPath("src/ui/runtime/loadPayload.ts")).toEqual(["host"]);
    expect(releaseComponentsForPath("packaging/npm/launch.mjs")).toEqual(["host"]);
  });

  test("the contract, shared updater, and dependency graph release both", () => {
    expect(releaseComponentsForPath("src/app/runtimeContract.ts")).toEqual(["host", "app"]);
    expect(releaseComponentsForPath("packaging/npm/update.mjs")).toEqual(["host", "app"]);
    expect(releaseComponentsForPath("src/app/selfUpdate.ts")).toEqual(["host", "app"]);
    expect(releaseComponentsForPath("package.json")).toEqual(["host", "app"]);
  });

  test("release metadata and non-shipping docs do not create another release", () => {
    expect(releaseComponentsForPath("release.json")).toEqual([]);
    expect(releaseComponentsForPath("docs/releasing.md")).toEqual([]);
    expect(releaseComponentsForPath("src/ui/runtime/loadPayload.test.ts")).toEqual([]);
    expect(releaseComponentsForPath("test/navigation.test.tsx")).toEqual([]);
  });

  test("deduplicates a mixed change set in dependency order", () => {
    expect(
      changedReleaseComponents([
        "src/ui/App.tsx",
        "src/ui/runtime/loadPayload.ts",
        "src/app/runtimeContract.ts",
      ]),
    ).toEqual(["host", "app"]);
  });
});
