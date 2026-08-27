import { PLATFORM_TO_ICON } from "~/lib/platformIcons.generated";

/** Icon shown for an unknown or absent platform. */
export const DEFAULT_PLATFORM_ICON = "default";

/**
 * Resolve a Sentry `project.platform` string to an icon base name.
 *
 * Platforms are dash-scoped from general to specific (`python-django`), and
 * Sentry adds new leaves faster than `platformicons` gains art for them. So an
 * unmapped platform falls back along its own scope — `python-nonesuch` lands on
 * `python` rather than the generic default.
 *
 * Always resolves: unknown platforms yield {@link DEFAULT_PLATFORM_ICON}, so
 * callers can reserve a fixed icon slot instead of a ragged one.
 */
export function resolvePlatformIcon(platform: string | null | undefined): string {
  if (!platform) return DEFAULT_PLATFORM_ICON;

  const segments = platform.split("-");
  for (let end = segments.length; end > 0; end--) {
    const icon = PLATFORM_TO_ICON[segments.slice(0, end).join("-")];
    if (icon) return icon;
  }

  return DEFAULT_PLATFORM_ICON;
}
