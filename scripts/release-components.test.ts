import { describe, expect, test } from "bun:test";

import { changedReleaseComponents, releaseComponentsForPath } from "./release-components.ts";

describe("release component ownership", () => {
  test("ordinary product code releases only the replaceable app", () => {
    expect(releaseComponentsForPath("packages/app/src/ui/screens/IssuesScreen.tsx")).toEqual([
      "app",
    ]);
    expect(releaseComponentsForPath("packages/app/src/api/issues.ts")).toEqual(["app"]);
  });

  test("runtime and launcher changes release only the host", () => {
    expect(releaseComponentsForPath("packages/runtime-host/src/ui/loadPayload.ts")).toEqual([
      "host",
    ]);
    expect(releaseComponentsForPath("packages/launcher/src/launch.mjs")).toEqual(["host"]);
  });

  test("shared workspace consumers determine the contract's releases", () => {
    expect(releaseComponentsForPath("packages/runtime-contract/src/runtime.ts")).toEqual([
      "host",
      "app",
    ]);
    expect(releaseComponentsForPath("package.json")).toEqual(["host", "app"]);
  });

  test("a workspace dependency lockfile follows its owning package", () => {
    expect(changedReleaseComponents(["packages/app/package.json", "bun.lock"])).toEqual(["app"]);
    expect(changedReleaseComponents(["packages/runtime-host/package.json", "bun.lock"])).toEqual([
      "host",
    ]);
    expect(changedReleaseComponents(["bun.lock"])).toEqual(["host", "app"]);
  });

  test("release metadata and non-shipping docs do not create another release", () => {
    expect(releaseComponentsForPath("release.json")).toEqual([]);
    expect(releaseComponentsForPath("docs/releasing.md")).toEqual([]);
    expect(releaseComponentsForPath("packages/runtime-host/src/ui/loadPayload.test.ts")).toEqual(
      [],
    );
    expect(releaseComponentsForPath("test/navigation.test.tsx")).toEqual([]);
  });

  test("deduplicates a mixed change set in dependency order", () => {
    expect(
      changedReleaseComponents([
        "packages/app/src/ui/App.tsx",
        "packages/runtime-host/src/ui/loadPayload.ts",
        "packages/runtime-contract/src/runtime.ts",
      ]),
    ).toEqual(["host", "app"]);
  });
});
