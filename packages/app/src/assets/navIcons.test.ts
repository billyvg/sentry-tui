import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { imageInfo, NativeImage } from "@opentui/core";

import { navIconBytes, NAV_ICON_NAMES } from "~/assets/navIcons";

/** Base names of the PNGs actually sitting in `src/assets/icons/`. */
const ON_DISK = readdirSync(new URL("./icons", import.meta.url))
  .filter((file) => file.endsWith(".png"))
  .map((file) => file.slice(0, -".png".length))
  .sort();

/** Widest a nav icon may be before it is wasting space in the binary. */
const MAX_ICON_PX = 128;

describe("nav icon assets", () => {
  // The imports are hand-written, so adding a PNG without adding its import
  // yields art that renders from source and is missing from the binary.
  test("every nav icon PNG is imported", () => {
    expect(ON_DISK).toEqual(NAV_ICON_NAMES.flatMap((name) => [name, `${name}_light`]).sort());
  });

  test("every nav icon decodes as a PNG", () => {
    const bad = NAV_ICON_NAMES.flatMap((name) =>
      (["dark", "light"] as const)
        .filter((mode) => imageInfo(navIconBytes(name, mode)).format !== "png")
        .map((mode) => `${mode}:${name}`),
    );
    expect(bad).toEqual([]);
  });

  // `NavIcon` lays every icon out at 2 columns by 1 row, so even a HiDPI cell
  // puts these on screen at roughly 40x40 device pixels. The PNGs are committed
  // with no generator to regenerate them from, so this is the only thing keeping
  // a 512x512 export — 25x oversampled, and 150KB across the set — from being
  // dropped back in. Downscale to 128 (`sips -Z 128 <file> --out <file>`) rather
  // than raising this.
  test("no nav icon is larger than the render needs", () => {
    const oversized = NAV_ICON_NAMES.flatMap((name) =>
      (["dark", "light"] as const).map((mode) => ({
        name: `${mode}:${name}`,
        ...imageInfo(navIconBytes(name, mode)),
      })),
    )
      .filter((icon) => icon.width > MAX_ICON_PX || icon.height > MAX_ICON_PX)
      .map((icon) => `${icon.name} (${icon.width}x${icon.height})`);
    expect(oversized).toEqual([]);
  });

  // OpenTUI reloads the image whenever the `source` prop changes identity, so
  // a fresh array per render would re-decode on every keystroke.
  test("hands back the same bytes for repeated lookups", () => {
    expect(navIconBytes("sentry")).toBe(navIconBytes("sentry"));
    expect(navIconBytes("sentry", "light")).toBe(navIconBytes("sentry", "light"));
  });

  test("light mode selects a distinct light-canvas icon", () => {
    const dark = navIconBytes("issues_active", "dark");
    const light = navIconBytes("issues_active", "light");
    expect(light).not.toBe(dark);
    expect(imageInfo(light)).toMatchObject({ format: "png", width: 128, height: 128 });

    const image = NativeImage.decode(light);
    const raw = image.takeRaw();
    expect(raw.data.slice(0, 4)).toEqual(Uint8Array.from([255, 255, 255, 255]));
    raw.dispose();
    image.dispose();
  });
});
