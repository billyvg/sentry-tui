import { describe, expect, test } from "bun:test";

import * as themeModule from "~/core/theme";

type PlannedTheme = {
  mode: "dark" | "light";
  bg: string;
  text: string;
  accent: string;
};

const planned = themeModule as typeof themeModule & {
  lightTheme: PlannedTheme;
  parseThemePreference: (value: string | undefined) => "auto" | "dark" | "light";
  themeFor: (mode: "dark" | "light") => PlannedTheme;
};

describe("theme preference", () => {
  test.each([
    [undefined, "auto"],
    ["", "auto"],
    [" auto ", "auto"],
    ["LIGHT", "light"],
    ["dark", "dark"],
  ] as const)("%p resolves to %s", (input, expected) => {
    expect(planned.parseThemePreference(input)).toBe(expected);
  });

  test("an invalid override fails with the accepted values", () => {
    expect(() => planned.parseThemePreference("sepia")).toThrow(
      "SENTRY_TUI_THEME must be auto, light, or dark",
    );
  });
});

test("themeFor returns the complete palette for its requested mode", () => {
  expect(planned.themeFor("dark")).toBe(themeModule.darkTheme);
  expect(planned.themeFor("light")).toBe(planned.lightTheme);
  expect(planned.lightTheme.mode).toBe("light");
  expect(planned.lightTheme.bg).toBe("#FFFFFF");
  expect(planned.lightTheme.text).toBe("#302E36");
  expect(planned.lightTheme.accent).toBe("#5827D6");
});
