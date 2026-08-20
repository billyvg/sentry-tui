import { describe, expect, test } from "bun:test";
import { imageInfo } from "@opentui/core";

import { DEFAULT_PLATFORM_ICON, resolvePlatformIcon } from "~/lib/platformIcons";
import { PLATFORM_TO_ICON } from "~/lib/platformIcons.generated";

/** Every icon the platform map can resolve to, including the fallback. */
const ICON_NAMES = [...new Set([...Object.values(PLATFORM_TO_ICON), DEFAULT_PLATFORM_ICON])];

function iconFile(icon: string) {
  return Bun.file(new URL(`../assets/platform-icons/${icon}.png`, import.meta.url));
}

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

  test("every mapped icon has a rasterized PNG", async () => {
    const missing: string[] = [];
    for (const icon of ICON_NAMES) {
      if (!(await iconFile(icon).exists())) missing.push(icon);
    }

    expect(missing).toEqual([]);
  });

  // `bun run icons:build` shells out to rsvg-convert; a version of it that
  // wrote something OpenTUI cannot decode would otherwise only show up as
  // silently blank icons in a terminal.
  test("every rasterized PNG decodes as a 64×64 PNG", async () => {
    const bad: string[] = [];

    for (const icon of ICON_NAMES) {
      const info = imageInfo(await iconFile(icon).bytes());
      if (info.format !== "png" || info.width !== 64 || info.height !== 64) {
        bad.push(`${icon}: ${info.format} ${info.width}×${info.height}`);
      }
    }

    expect(bad).toEqual([]);
  });
});
