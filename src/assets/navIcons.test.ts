import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { imageInfo } from "@opentui/core";

import { navIconBytes, NAV_ICON_NAMES } from "~/assets/navIcons";

/** Base names of the PNGs actually sitting in `src/assets/icons/`. */
const ON_DISK = readdirSync(new URL("./icons", import.meta.url))
  .filter((file) => file.endsWith(".png"))
  .map((file) => file.slice(0, -".png".length))
  .sort();

describe("nav icon assets", () => {
  // The imports are hand-written, so adding a PNG without adding its import
  // yields art that renders from source and is missing from the binary.
  test("every nav icon PNG is imported", () => {
    expect(ON_DISK).toEqual([...NAV_ICON_NAMES].sort());
  });

  test("every nav icon decodes as a PNG", () => {
    const bad = NAV_ICON_NAMES.filter((name) => imageInfo(navIconBytes(name)).format !== "png");
    expect(bad).toEqual([]);
  });

  // OpenTUI reloads the image whenever the `source` prop changes identity, so
  // a fresh array per render would re-decode on every keystroke.
  test("hands back the same bytes for repeated lookups", () => {
    expect(navIconBytes("sentry")).toBe(navIconBytes("sentry"));
  });
});
