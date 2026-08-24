import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import {
  darkTheme,
  themeFor,
  type Theme,
  type ThemeMode,
  type ThemePreference,
} from "~/core/theme";

/** The subset of OpenTUI's renderer used for terminal appearance detection. */
export interface ThemeModeSource {
  readonly themeMode: ThemeMode | null;
  waitForThemeMode(timeoutMs?: number): Promise<ThemeMode | null>;
  on(event: "theme_mode", listener: (mode: ThemeMode) => void): unknown;
  off(event: "theme_mode", listener: (mode: ThemeMode) => void): unknown;
}

export interface InitialThemeSelection {
  mode: ThemeMode;
  source: "detected" | "fallback" | "override";
  fixed: boolean;
}

const ThemeContext = createContext<Theme>(darkTheme);

/** Resolve the palette currently provided to the component tree. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Choose a bounded initial mode before the first application paint. */
export async function resolveInitialTheme(
  source: ThemeModeSource,
  preference: ThemePreference,
): Promise<InitialThemeSelection> {
  if (preference !== "auto") {
    return { mode: preference, source: "override", fixed: true };
  }

  const detected = await source.waitForThemeMode(300);
  return detected
    ? { mode: detected, source: "detected", fixed: false }
    : { mode: "dark", source: "fallback", fixed: false };
}

export interface ThemeProviderProps {
  source: ThemeModeSource;
  initialMode: ThemeMode;
  fixed: boolean;
  children: ReactNode;
}

/** Supply a fixed palette or follow the renderer's live terminal mode. */
export function ThemeProvider({ source, initialMode, fixed, children }: ThemeProviderProps) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    if (fixed) return;

    const updateMode = (nextMode: ThemeMode) => setMode(nextMode);
    source.on("theme_mode", updateMode);

    // Detection can finish between the startup read and this effect. Subscribe
    // first, then re-read, so there is no gap where a terminal change is lost.
    if (source.themeMode) setMode(source.themeMode);

    return () => {
      source.off("theme_mode", updateMode);
    };
  }, [fixed, source]);

  return <ThemeContext.Provider value={themeFor(mode)}>{children}</ThemeContext.Provider>;
}
