/**
 * Theme contrast checks — ensures the Sentry palette is readable in a terminal.
 *
 * Runs as part of `bun run test:theme-contrast`. Every foreground/background
 * pair that appears in the real UI must meet WCAG AA contrast (4.5:1 for body
 * text, 3:1 for large/bold text). Terminal backgrounds vary, so we check
 * against the theme's own `bg` and `panel` surfaces.
 */
import { test, expect, describe } from "bun:test";
import { theme } from "~/core/theme";

/** Parse a hex color (#RRGGBB) to linear-light sRGB components. */
function hexToLinear(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colors. */
function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Minimum contrast ratios
const AA_NORMAL = 4.5; // body text
const AA_LARGE = 3.0; // bold/large text, UI components

describe("theme contrast", () => {
  const backgrounds = [
    { name: "bg", color: theme.bg },
    { name: "panel", color: theme.panel },
    { name: "panelAlt", color: theme.panelAlt },
  ];

  // Primary text against all surfaces
  for (const bg of backgrounds) {
    test(`text on ${bg.name} meets ${AA_NORMAL}:1`, () => {
      const ratio = contrastRatio(theme.text, bg.color);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    test(`muted on ${bg.name} meets ${AA_NORMAL}:1`, () => {
      const ratio = contrastRatio(theme.muted, bg.color);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    test(`accent on ${bg.name} meets ${AA_LARGE}:1`, () => {
      const ratio = contrastRatio(theme.accent, bg.color);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  // Level colors must be distinguishable against the main background
  for (const [levelName, color] of Object.entries(theme.level)) {
    test(`level.${levelName} on bg meets ${AA_LARGE}:1`, () => {
      const ratio = contrastRatio(color, theme.bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  // Status colors against the main background
  for (const [statusName, color] of Object.entries(theme.status)) {
    test(`status.${statusName} on bg meets ${AA_LARGE}:1`, () => {
      const ratio = contrastRatio(color, theme.bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  // Semantic colors against panelAlt (where action buttons live)
  for (const name of ["danger", "warning", "success"] as const) {
    test(`${name} on panelAlt meets ${AA_LARGE}:1`, () => {
      const ratio = contrastRatio(theme[name], theme.panelAlt);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  // Focus ring must be visually distinct from resting border
  test("focused and resting borders are visibly different", () => {
    const ratio = contrastRatio(theme.borderFocused, theme.border);
    expect(ratio).toBeGreaterThanOrEqual(1.5);
  });

  // Selected row must stand out from the background
  test("the selected row is distinguishable from the background", () => {
    const ratio = contrastRatio(theme.selected, theme.bg);
    // Subtle selection highlight just needs to be noticeable, not high contrast
    expect(ratio).toBeGreaterThanOrEqual(1.1);
  });
});
