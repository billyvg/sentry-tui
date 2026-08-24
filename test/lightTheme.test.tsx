import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ReactNode } from "react";

import { lightTheme, type ThemeMode } from "~/core/theme";
import { App } from "~/ui/App";
import { Chip } from "~/ui/components/Chip";
import { ErrorBoundary } from "~/ui/components/ErrorBoundary";
import { IssueRow } from "~/ui/components/IssueRow";
import { KeyHint } from "~/ui/components/KeyHint";
import { ThemeProvider, type ThemeModeSource } from "~/ui/theme";

import { groupFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const source: ThemeModeSource = {
  themeMode: "light",
  async waitForThemeMode(): Promise<ThemeMode> {
    return "light";
  },
  on(): void {},
  off(): void {},
};

/** Render children beneath the same fixed light override used by the app. */
function Light({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider source={source} initialMode="light" fixed>
      {children}
    </ThemeProvider>
  );
}

/** `captureSpans` reports colors as 0–1 rgb floats; the theme speaks hex. */
function rgbToHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

test("real controls use the light palette supplied by context", async () => {
  const harness = await renderHarness(
    <Light>
      <box style={{ flexDirection: "column", backgroundColor: lightTheme.bg }}>
        <Chip command="sentry.app.quit" label="Apply" />
        <KeyHint command="sentry.app.quit" />
      </box>
    </Light>,
  );

  expect(rgbToHex(harness.spanContaining("Apply")!.fg)).toBe(lightTheme.text.toLowerCase());
  expect(rgbToHex(harness.spanContaining("q")!.fg)).toBe(lightTheme.hotkey.toLowerCase());
  await harness.cleanup();
});

test("the real app canvas and status bar use light surfaces", async () => {
  const harness = await renderHarness(
    <Light>
      <App onQuit={() => {}} />
    </Light>,
  );

  expect(rgbToHex(harness.spanContaining("quit")!.bg)).toBe(lightTheme.panel.toLowerCase());
  await harness.cleanup();
});

test("a selected real issue row uses the light selection surface", async () => {
  const harness = await renderHarness(
    <Light>
      <IssueRow group={groupFixture} selected width={100} />
    </Light>,
    { width: 100, height: 4 },
  );

  expect(rgbToHex(harness.spanContaining("TypeError")!.bg)).toBe(lightTheme.selected.toLowerCase());
  await harness.cleanup();
});

function Exploding(): never {
  throw new Error("light crash");
}

const realConsoleError = console.error;
beforeEach(() => {
  console.error = () => {};
});
afterEach(() => {
  console.error = realConsoleError;
});

test("the crash fallback uses the light semantic palette", async () => {
  const harness = await renderHarness(
    <Light>
      <ErrorBoundary onQuit={() => {}}>
        <Exploding />
      </ErrorBoundary>
    </Light>,
  );

  expect(rgbToHex(harness.spanContaining("sentry-tui hit an error")!.fg)).toBe(
    lightTheme.danger.toLowerCase(),
  );
  await harness.cleanup();
});
