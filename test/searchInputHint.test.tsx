import { expect, test } from "bun:test";

import { darkTheme } from "~/core/theme";
import { SearchInputHint } from "~/ui/components/SearchInputHint";
import { UNDERLINE } from "~/ui/lib/attributes";
import { renderHarness } from "./helpers";

/** Convert the renderer's normalized RGB values to the theme's hex format. */
function rgbToHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

test("the search prefix uses the app hotkey treatment", async () => {
  const harness = await renderHarness(<SearchInputHint />);
  try {
    expect(harness.frame()).toContain("/ ");

    const slash = harness.spanContaining("/");
    expect(slash).toBeDefined();
    expect(rgbToHex(slash!.fg)).toBe(darkTheme.hotkey.toLowerCase());
    expect(slash!.attributes & UNDERLINE).toBe(UNDERLINE);
  } finally {
    await harness.cleanup();
  }
});
