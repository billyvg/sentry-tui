import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { act, useEffect, useState } from "react";

import type { ThemeMode } from "~/core/theme";
import { resolveInitialTheme, ThemeProvider, useTheme } from "~/ui/theme";

import { renderHarness } from "./helpers";

class FakeThemeSource extends EventEmitter {
  waits: number[] = [];

  constructor(public themeMode: ThemeMode | null) {
    super();
  }

  /** Return the configured terminal mode while recording the detection bound. */
  async waitForThemeMode(timeoutMs?: number): Promise<ThemeMode | null> {
    this.waits.push(timeoutMs ?? 0);
    return this.themeMode;
  }

  /** Simulate the terminal changing appearance while the app is running. */
  setMode(mode: ThemeMode): void {
    this.themeMode = mode;
    this.emit("theme_mode", mode);
  }
}

test("automatic mode follows live changes without remounting children", async () => {
  const source = new FakeThemeSource("dark");
  let mounts = 0;

  function Probe() {
    const theme = useTheme();
    const [value, setValue] = useState("kept");
    useEffect(() => {
      mounts += 1;
    }, []);
    return (
      <text fg={theme.text} onMouseDown={() => setValue("changed")}>
        {`${theme.mode}:${value}`}
      </text>
    );
  }

  const harness = await renderHarness(
    <ThemeProvider source={source} initialMode="dark" fixed={false}>
      <Probe />
    </ThemeProvider>,
  );
  await harness.click(1, 0);
  await act(async () => source.setMode("light"));
  await harness.flush();

  expect(harness.frame()).toContain("light:changed");
  expect(mounts).toBe(1);
  await harness.cleanup();
});

test("a fixed override ignores terminal changes", async () => {
  const source = new FakeThemeSource("dark");

  function Probe() {
    return <text>{useTheme().mode}</text>;
  }

  const harness = await renderHarness(
    <ThemeProvider source={source} initialMode="dark" fixed>
      <Probe />
    </ThemeProvider>,
  );
  await act(async () => source.setMode("light"));
  await harness.flush();

  expect(harness.frame()).toContain("dark");
  expect(source.listenerCount("theme_mode")).toBe(0);
  await harness.cleanup();
});

test("automatic mode re-reads a detection that arrived before its effect", async () => {
  const source = new FakeThemeSource("light");

  function Probe() {
    return <text>{useTheme().mode}</text>;
  }

  const harness = await renderHarness(
    <ThemeProvider source={source} initialMode="dark" fixed={false}>
      <Probe />
    </ThemeProvider>,
  );

  expect(harness.frame()).toContain("light");
  await harness.cleanup();
});

test("unmount removes the live terminal listener", async () => {
  const source = new FakeThemeSource("dark");
  const harness = await renderHarness(
    <ThemeProvider source={source} initialMode="dark" fixed={false}>
      <text>probe</text>
    </ThemeProvider>,
  );

  expect(source.listenerCount("theme_mode")).toBe(1);
  await harness.cleanup();
  expect(source.listenerCount("theme_mode")).toBe(0);
});

test("initial automatic mode uses bounded terminal detection", async () => {
  const source = new FakeThemeSource("light");

  expect(await resolveInitialTheme(source, "auto")).toEqual({
    mode: "light",
    source: "detected",
    fixed: false,
  });
  expect(source.waits).toEqual([300]);
});

test("unknown automatic mode falls back to dark and remains live", async () => {
  const source = new FakeThemeSource(null);

  expect(await resolveInitialTheme(source, "auto")).toEqual({
    mode: "dark",
    source: "fallback",
    fixed: false,
  });
});

test("an explicit mode bypasses terminal detection", async () => {
  const source = new FakeThemeSource("dark");

  expect(await resolveInitialTheme(source, "light")).toEqual({
    mode: "light",
    source: "override",
    fixed: true,
  });
  expect(source.waits).toEqual([]);
});
