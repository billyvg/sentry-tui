import { imageBytes } from "~/assets/imageBytes";
import { PLATFORM_ICON_PATHS } from "~/assets/platformIcons.generated";

/** Icon base names with an embedded PNG. */
export const PLATFORM_ICON_NAMES = Object.keys(PLATFORM_ICON_PATHS);

/**
 * PNG bytes for a platform icon base name, ready for OpenTUI's `<image source>`.
 *
 * Returns `undefined` for a name with no rasterized art. `resolvePlatformIcon`
 * only ever yields names that have art — `bun run icons:build` generates both
 * sides from the same list and a test holds them together — so a caller
 * reaching that branch is looking at a build that skipped the icon step, not at
 * an ordinary unknown platform.
 */
export function platformIconBytes(icon: string): Uint8Array | undefined {
  const path = PLATFORM_ICON_PATHS[icon];
  return path === undefined ? undefined : imageBytes(path);
}
