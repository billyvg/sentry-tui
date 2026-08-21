import { describe, expect, test } from "bun:test";
import { imageInfo } from "@opentui/core";

import { platformIconBytes, PLATFORM_ICON_NAMES } from "~/assets/platformIcons";
import { DEFAULT_PLATFORM_ICON } from "~/lib/platformIcons";
import { PLATFORM_TO_ICON } from "~/lib/platformIcons.generated";

/** Every icon the platform map can resolve to, including the fallback. */
const RESOLVABLE_ICONS = [...new Set([...Object.values(PLATFORM_TO_ICON), DEFAULT_PLATFORM_ICON])];

describe("platform icon assets", () => {
  // The registry and the platform map are emitted by the same script, so this
  // catches a half-run of `bun run icons:build` — the state where icons render
  // from source but the binary ships with holes.
  test("every icon the platform map resolves to is embedded", () => {
    expect(RESOLVABLE_ICONS.filter((icon) => !PLATFORM_ICON_NAMES.includes(icon))).toEqual([]);
  });

  test("the registry has no icon the platform map cannot reach", () => {
    expect(PLATFORM_ICON_NAMES.filter((icon) => !RESOLVABLE_ICONS.includes(icon))).toEqual([]);
  });

  // `bun run icons:build` shells out to rsvg-convert; a version of it that
  // wrote something OpenTUI cannot decode would otherwise only show up as
  // silently blank icons in a terminal.
  test("every embedded icon decodes as a 64×64 PNG", () => {
    const bad: string[] = [];

    for (const icon of RESOLVABLE_ICONS) {
      const bytes = platformIconBytes(icon);
      if (!bytes) {
        bad.push(`${icon}: not embedded`);
        continue;
      }
      const info = imageInfo(bytes);
      if (info.format !== "png" || info.width !== 64 || info.height !== 64) {
        bad.push(`${icon}: ${info.format} ${info.width}×${info.height}`);
      }
    }

    expect(bad).toEqual([]);
  });

  test("returns undefined for a name with no art", () => {
    expect(platformIconBytes("nonesuch")).toBeUndefined();
  });

  // OpenTUI reloads the image whenever the `source` prop changes identity, so
  // a fresh array per render would re-decode on every keystroke.
  test("hands back the same bytes for repeated lookups", () => {
    expect(platformIconBytes("python")).toBe(platformIconBytes("python"));
  });
});
