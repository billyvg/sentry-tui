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
    // A chip's own surface, one step up from `panelAlt`. Every chip prints a
    // key hint and a label on it, so it is held to the same bar as the panels
    // — the step it sits on was chosen by this test, not the other way round.
    { name: "chip.surface", color: theme.chip.surface },
    // The selected row is a surface too: every row's text is read against it
    // whenever the cursor lands there.
    { name: "selected", color: theme.selected },
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

    // subText carries real words — "(no error message)" — not just decoration,
    // so it is held to the body-text ratio despite being a dimmed placeholder.
    test(`subText on ${bg.name} meets ${AA_NORMAL}:1`, () => {
      const ratio = contrastRatio(theme.subText, bg.color);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    test(`accent on ${bg.name} meets ${AA_LARGE}:1`, () => {
      const ratio = contrastRatio(theme.accent, bg.color);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });

    // A key hint is one character of real text — the one character you have to
    // read correctly before you press it — so it gets the body ratio, not the
    // UI-component one, on every surface a `(k)` can land on.
    test(`hotkey on ${bg.name} meets ${AA_NORMAL}:1`, () => {
      const ratio = contrastRatio(theme.hotkey, bg.color);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
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
  for (const name of ["danger", "warning", "success", "highlight"] as const) {
    test(`${name} on panelAlt meets ${AA_LARGE}:1`, () => {
      const ratio = contrastRatio(theme[name], theme.panelAlt);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  // Semantic colors against panel (status bar background)
  for (const name of ["danger", "warning", "success", "highlight"] as const) {
    test(`${name} on panel meets ${AA_LARGE}:1`, () => {
      const ratio = contrastRatio(theme[name], theme.panel);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  // `highlight` and `danger` take turns in the same status-bar slot, so they
  // have to be told apart at a glance: a context notice that reads as an error
  // is worse than no notice at all. Pink's readable `1200` tint fails this,
  // which is why `highlight` takes the ramp's brand step instead.
  test("highlight is not mistakable for danger", () => {
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r1, g1, b1] = channels(theme.highlight);
    const [r2, g2, b2] = channels(theme.danger);
    const spread = Math.max(Math.abs(r1! - r2!), Math.abs(g1! - g2!), Math.abs(b1! - b2!));
    expect(spread).toBeGreaterThanOrEqual(64);
  });

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

  // `panelAlt` is the surface every interactive chip wears. If it stops reading
  // as raised against the page, the app loses its only "you can press this"
  // signal — a terminal has no cursor change or hover state to fall back on.
  test("a control surface is distinguishable from the background it sits on", () => {
    expect(contrastRatio(theme.panelAlt, theme.bg)).toBeGreaterThanOrEqual(1.15);
    expect(contrastRatio(theme.chip.surface, theme.bg)).toBeGreaterThanOrEqual(1.15);
  });

  // The rim is the whole reason a chip reads as a raised surface rather than a
  // highlighted word. It is a sliver of a cell at top and bottom, so it has to
  // separate from both the fill it edges and the page it sits on, or the
  // frame just looks like the fill bleeding.
  test("the chip rim separates from the fill it edges", () => {
    expect(contrastRatio(theme.chip.rim, theme.chip.surface)).toBeGreaterThanOrEqual(1.3);
    expect(contrastRatio(theme.chip.rim, theme.bg)).toBeGreaterThanOrEqual(1.5);
  });

  // The underside is dimmer than the top — light comes from above — but a
  // shadow that matches the fill is no edge at all.
  test("the chip's underside is dimmer than its top rim, and still an edge", () => {
    expect(luminance(theme.chip.rimShadow)).toBeLessThan(luminance(theme.chip.rim));
    expect(contrastRatio(theme.chip.rimShadow, theme.chip.surface)).toBeGreaterThanOrEqual(1.1);
  });
});
