import { describe, expect, test } from "bun:test";

import { DEFAULT_PLATFORM_ICON, resolvePlatformIcon } from "~/lib/platformIcons";

// That every name resolved here has art behind it is checked in
// `src/assets/platformIcons.test.ts`, alongside the imports that embed it.
describe("resolvePlatformIcon", () => {
  test("resolves an exact platform", () => {
    expect(resolvePlatformIcon("python-django")).toBe("django");
    expect(resolvePlatformIcon("javascript-react")).toBe("react");
  });

  test("resolves a platform whose icon is shared with another", () => {
    expect(resolvePlatformIcon("cocoa-objc")).toBe("apple");
  });

  test("falls back along the platform's own scope", () => {
    expect(resolvePlatformIcon("python-nonesuch")).toBe("python");
    expect(resolvePlatformIcon("javascript-nonesuch-deeper")).toBe("javascript");
  });

  test("falls back to the default icon for unknown and absent platforms", () => {
    expect(resolvePlatformIcon("nonesuch")).toBe(DEFAULT_PLATFORM_ICON);
    expect(resolvePlatformIcon(null)).toBe(DEFAULT_PLATFORM_ICON);
    expect(resolvePlatformIcon(undefined)).toBe(DEFAULT_PLATFORM_ICON);
    expect(resolvePlatformIcon("")).toBe(DEFAULT_PLATFORM_ICON);
  });
});
