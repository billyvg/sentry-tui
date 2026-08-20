import { join } from "node:path";

import { resolvePlatformIcon } from "~/lib/platformIcons";
import { useImageSupport } from "~/ui/hooks/useImageSupport";

/** Directory holding the rasterized platform icons (`bun run icons:build`). */
const ICONS_DIR = join(import.meta.dir, "../../assets/platform-icons");

/**
 * Cells a platform icon spans when rendered.
 *
 * Terminal cells are roughly twice as tall as they are wide, so two cells wide
 * by one tall is square — the icon reads as a glyph on the line it shares with
 * text rather than as a block that forces the row taller.
 */
export const PLATFORM_ICON_WIDTH = 2;
const PLATFORM_ICON_HEIGHT = 1;

/**
 * Cells to budget for a platform icon plus the space after it, or 0 when the
 * terminal cannot render images.
 *
 * Call sites that fit text to a width need this to stay in step with whether
 * {@link PlatformIcon} actually draws anything.
 */
export function usePlatformIconWidth(): number {
  const { supportsHighRes } = useImageSupport();
  return supportsHighRes ? PLATFORM_ICON_WIDTH + 1 : 0;
}

interface PlatformIconProps {
  /** A Sentry `project.platform` string; unknown values get the generic icon. */
  platform: string | null | undefined;
}

/**
 * The logo for a project's platform, as Sentry's web UI shows beside a project.
 *
 * Renders nothing in terminals without kitty or sixel graphics — the half-block
 * fallback turns a 2×1 icon into colored mush — so pair it with
 * {@link usePlatformIconWidth} wherever surrounding text is width-fitted.
 */
export function PlatformIcon({ platform }: PlatformIconProps) {
  const { supportsHighRes } = useImageSupport();
  if (!supportsHighRes) return null;

  return (
    <image
      source={join(ICONS_DIR, `${resolvePlatformIcon(platform)}.png`)}
      fit="fit"
      style={{
        width: PLATFORM_ICON_WIDTH,
        height: PLATFORM_ICON_HEIGHT,
        flexShrink: 0,
        marginRight: 1,
      }}
    />
  );
}
