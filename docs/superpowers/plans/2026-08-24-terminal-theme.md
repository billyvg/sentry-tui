# Terminal Theme Detection and Light Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect the terminal's light/dark appearance, follow it live without losing UI state, and render a complete contrast-checked light mode with an environment override.

**Architecture:** Framework-free core palettes feed a React `ThemeProvider` that subscribes to OpenTUI's public `theme_mode` event. UI renderers consume the active immutable palette through `useTheme()`; pure factories accept a `Theme` argument. Startup resolves an initial mode with a bounded wait, while fixed environment overrides bypass live updates.

**Tech Stack:** Bun, TypeScript, React 19, OpenTUI 0.5.4, Bun test, Swift/CoreGraphics for deterministic one-time PNG recoloring.

**Spec:** `docs/superpowers/specs/2026-08-24-terminal-theme-design.md`

## Global Constraints

- Work only in `/Users/billy/code/sentry-tui-light-theme` on `feat/light-theme`.
- Bun remains the runtime; add no runtime dependency.
- Never invoke `devservices` or start/rely on Colima.
- Use only OpenTUI's `themeMode`, `waitForThemeMode()`, and `theme_mode` event for detection; write no raw OSC sequences.
- Cap the initial automatic wait at exactly 300 ms.
- Fall back to the unchanged dark palette when detection is unknown, while continuing to listen.
- A fixed `SENTRY_TUI_THEME=light|dark` override ignores live terminal events.
- Keep `src/core/theme.ts` framework-free and preserve dependency boundaries.
- Keep every navigation PNG at or below 128 by 128 pixels and statically import its bytes.
- Preserve `App` state across theme changes; never key or remount the application by mode.
- Follow strict red-green-refactor: observe each focused test fail for the intended production gap before implementation.
- Run `bun run check` before the final implementation commit and PR.

---

### Task 1: Core palettes, preference parsing, syntax roles, and timeline colors

**Files:**

- Create: `src/core/theme.test.ts`
- Modify: `src/core/theme.ts`
- Modify: `src/core/checkInTimeline.ts`
- Modify: `src/ui/components/CheckInTimeline.tsx`
- Modify: `src/ui/screens/monitorTimeline.tsx`
- Modify: `src/ui/screens/monitorTimelineSlot.tsx`
- Modify: `test/checkInTimeline.test.tsx`
- Modify: `scripts/check-theme-contrast.test.ts`

**Interfaces:**

- Produces: `type ThemeMode = "dark" | "light"`.
- Produces: `type ThemePreference = "auto" | ThemeMode`.
- Produces: `Theme.mode: ThemeMode` and `Theme.syntax: SyntaxPalette`.
- Produces: `themeFor(mode: ThemeMode): Theme`.
- Produces: `parseThemePreference(value: string | undefined): ThemePreference`.
- Produces: `getSyntaxStyle(theme: Theme): Promise<SyntaxStyle>`.
- Produces: `timelineStylesFor(theme: Theme): { cron: TimelineStyle<CronCheckInStatus>; uptime: TimelineStyle<UptimeCheckStatus> }`.
- Changes: `TimelineStyle<S>` gains `trackColor: string`; the component no longer imports a captured track constant.
- Temporarily preserves: `theme = darkTheme` until Task 3 migrates all consumers.

- [ ] **Step 1: Write failing core theme tests**

Add literal, independently derived cases:

```ts
import { describe, expect, test } from "bun:test";
import { darkTheme, lightTheme, parseThemePreference, themeFor } from "~/core/theme";

describe("theme preference", () => {
  test.each([
    [undefined, "auto"],
    ["", "auto"],
    [" auto ", "auto"],
    ["LIGHT", "light"],
    ["dark", "dark"],
  ])("%p resolves to %s", (input, expected) => {
    expect(parseThemePreference(input)).toBe(expected);
  });

  test("an invalid override fails with the accepted values", () => {
    expect(() => parseThemePreference("sepia")).toThrow(
      "SENTRY_TUI_THEME must be auto, light, or dark",
    );
  });
});

test("themeFor returns a complete palette with its requested mode", () => {
  expect(themeFor("dark")).toBe(darkTheme);
  expect(themeFor("light")).toBe(lightTheme);
  expect(lightTheme.mode).toBe("light");
  expect(lightTheme.bg).toBe("#FFFFFF");
  expect(lightTheme.text).toBe("#302E36");
  expect(lightTheme.accent).toBe("#5827D6");
});
```

- [ ] **Step 2: Extend the contrast suite to both themes before defining lightTheme**

Import `darkTheme` and `lightTheme`, wrap the existing assertions in:

```ts
for (const theme of [darkTheme, lightTheme]) {
  describe(`${theme.mode} theme`, () => {
    // Existing surface, semantic, selection, border, chip, and timeline checks.
  });
}
```

Derive timeline assertions from `timelineStylesFor(theme)` instead of module-level dark constants. Preserve every current ratio threshold.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
bun test src/core/theme.test.ts scripts/check-theme-contrast.test.ts
```

Expected: FAIL because `lightTheme`, `themeFor`, `parseThemePreference`, and `timelineStylesFor` do not exist.

- [ ] **Step 4: Implement the core theme model and exact light palette**

Add `mode` and these syntax roles to `Theme`:

```ts
export interface SyntaxPalette {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  type: string;
  variable: string;
  constant: string;
  operator: string;
  punctuation: string;
}
```

Keep every current dark value unchanged. Define the light palette with the values already checked against the repository's contrast rules:

```ts
export const lightTheme: Theme = {
  mode: "light",
  bg: "#FFFFFF",
  panel: "#F8F8F9",
  panelAlt: "#EEEEF0",
  chip: {
    surface: "#E8E8EB",
    rim: "#CDCCD2",
    rimShadow: "#B1AFB8",
  },
  selected: "#E8E8EB",
  border: "#C0BEC6",
  borderFocused: "#5827D6",
  text: "#302E36",
  muted: "#5B5864",
  subText: "#6A6772",
  accent: "#5827D6",
  danger: "#C10000",
  warning: "#813100",
  success: "#007800",
  highlight: "#9F005F",
  hotkey: "#9F005F",
  level: {
    fatal: "#780000",
    error: "#C10000",
    warning: "#813100",
    info: "#5827D6",
    sample: "#5827D6",
    unknown: "#5B5864",
  },
  status: {
    resolved: "#007800",
    regressed: "#5533B2",
    escalating: "#C10000",
    new: "#813100",
    ongoing: "#5B5864",
    archived: "#5B5864",
  },
  syntax: {
    keyword: "#C10000",
    string: "#007800",
    number: "#934100",
    comment: "#5B5864",
    function: "#5533B2",
    type: "#813100",
    variable: "#302E36",
    constant: "#C10000",
    operator: "#5B5864",
    punctuation: "#5B5864",
  },
};
```

Add `mode: "dark"` and a `syntax` object to `darkTheme` using the current hard-coded syntax colors. Implement strict parsing and `themeFor`:

```ts
export function parseThemePreference(value: string | undefined): ThemePreference {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "light" || normalized === "dark") return normalized;
  throw new Error("SENTRY_TUI_THEME must be auto, light, or dark");
}

export function themeFor(mode: ThemeMode): Theme {
  return mode === "light" ? lightTheme : darkTheme;
}
```

Change `getSyntaxStyle(theme)` to build from `theme.syntax` and cache by `theme.mode`.

- [ ] **Step 5: Make timeline styles theme-derived**

Replace captured exports with:

```ts
export interface TimelineStyle<S extends string> {
  config: TimelineStatusConfig<S>;
  colors: Readonly<Record<S, string>>;
  trackColor: string;
}

export function timelineStylesFor(theme: Theme) {
  return {
    cron: {
      config: CRON_TIMELINE,
      colors: {
        ok: theme.success,
        missed: theme.muted,
        timeout: theme.warning,
        error: theme.danger,
        in_progress: theme.accent,
        unknown: theme.subText,
      },
      trackColor: theme.border,
    },
    uptime: {
      config: UPTIME_TIMELINE,
      colors: {
        success: theme.success,
        failure: theme.danger,
        failure_incident: theme.danger,
        missed_window: theme.subText,
      },
      trackColor: theme.border,
    },
  } satisfies {
    cron: TimelineStyle<CronCheckInStatus>;
    uptime: TimelineStyle<UptimeCheckStatus>;
  };
}
```

Use `style.trackColor` for pending and empty cells. Callers derive the pair from their active theme; focused tests use `timelineStylesFor(darkTheme)` explicitly.

- [ ] **Step 6: Run focused tests and full typecheck; verify GREEN**

Run:

```bash
bun test src/core/theme.test.ts scripts/check-theme-contrast.test.ts test/checkInTimeline.test.tsx test/monitorTimeline.test.tsx
bun run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit the core palette**

```bash
git add src/core/theme.ts src/core/theme.test.ts src/core/checkInTimeline.ts src/ui/components/CheckInTimeline.tsx src/ui/screens/monitorTimeline.tsx src/ui/screens/monitorTimelineSlot.tsx test/checkInTimeline.test.tsx scripts/check-theme-contrast.test.ts
git commit -m "feat(ui): Add a contrast-checked light palette"
```

---

### Task 2: Reactive provider, startup detection, and environment override

**Files:**

- Create: `src/ui/theme.tsx`
- Create: `test/theme.test.tsx`
- Modify: `src/ui/runApp.tsx`
- Modify: `src/app/startup.ts`
- Modify: `test/startup.test.ts`

**Interfaces:**

- Consumes: `ThemeMode`, `ThemePreference`, `themeFor()`, and `parseThemePreference()` from Task 1.
- Produces: `ThemeModeSource` with `themeMode`, `waitForThemeMode(300)`, `on("theme_mode", listener)`, and `off(...)`.
- Produces: `InitialThemeSelection = { mode: ThemeMode; source: "detected" | "fallback" | "override"; fixed: boolean }`.
- Produces: `resolveInitialTheme(source, preference): Promise<InitialThemeSelection>`.
- Produces: `ThemeProvider` and `useTheme(): Theme`.

- [ ] **Step 1: Write failing provider and initial-selection tests**

Use a real `EventEmitter`-backed source and real React children. Cover these observable behaviors:

```tsx
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
```

Also test that fixed mode ignores `setMode("light")`, automatic mode catches a source mode changed before effect setup by re-reading `themeMode`, cleanup removes the listener, detected mode wins, and a null detection returns the dark fallback.

- [ ] **Step 2: Run provider tests and verify RED**

Run:

```bash
bun test test/theme.test.tsx
```

Expected: FAIL because `ThemeProvider`, `useTheme`, and `resolveInitialTheme` do not exist.

- [ ] **Step 3: Implement the provider and bounded initial resolver**

Implement the context with a dark default:

```tsx
const ThemeContext = createContext<Theme>(darkTheme);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
```

Implement the initial resolver exactly:

```ts
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
```

In the provider effect, subscribe first, re-read `source.themeMode`, ignore repeated values through React's state equality, and detach the same callback in cleanup. Do not subscribe when `fixed` is true.

- [ ] **Step 4: Integrate selection into runApp and document the environment**

At the top of `runApp`, before `createCliRenderer`, call:

```ts
const preference = parseThemePreference(process.env["SENTRY_TUI_THEME"]);
```

After renderer creation, resolve the initial selection, add `theme` and `theme_source` to `app.session.started`, and render:

```tsx
<ThemeProvider
  source={renderer}
  initialMode={selection.mode}
  fixed={selection.fixed}
>
  <ErrorBoundary onQuit={() => void shutdown()}>
    <FirstPaint />
    <App ... />
  </ErrorBoundary>
</ThemeProvider>
```

Add this help entry:

```text
  SENTRY_TUI_THEME      Color theme: auto, light, or dark (default auto)
```

Extend `test/startup.test.ts` to assert the environment section names `SENTRY_TUI_THEME`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
bun test test/theme.test.tsx test/startup.test.ts
bun run typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit detection and provider**

```bash
git add src/ui/theme.tsx test/theme.test.tsx src/ui/runApp.tsx src/app/startup.ts test/startup.test.ts
git commit -m "feat(ui): Follow the terminal theme live"
```

---

### Task 3: Move every UI color consumer onto the reactive palette

**Files:**

- Modify: `src/ui/App.tsx`
- Modify: `src/ui/components/BarChart.tsx`
- Modify: `src/ui/components/Chip.tsx`
- Modify: `src/ui/components/CommandPalette.tsx`
- Modify: `src/ui/components/DataTable.tsx`
- Modify: `src/ui/components/DetailBackRow.tsx`
- Modify: `src/ui/components/DetailSections.tsx`
- Modify: `src/ui/components/Dropdown.tsx`
- Modify: `src/ui/components/ErrorBoundary.tsx`
- Modify: `src/ui/components/ExploreQueryBar.tsx`
- Modify: `src/ui/components/FilterBar.tsx`
- Modify: `src/ui/components/HelpDialog.tsx`
- Modify: `src/ui/components/HighlightedLabel.tsx`
- Modify: `src/ui/components/IssueListStates.tsx`
- Modify: `src/ui/components/IssueRow.tsx`
- Modify: `src/ui/components/KeyHint.tsx`
- Modify: `src/ui/components/ModalFrame.tsx`
- Modify: `src/ui/components/NavHotkeyLabel.tsx`
- Modify: `src/ui/components/NavRail.tsx`
- Modify: `src/ui/components/Placeholder.tsx`
- Modify: `src/ui/components/SearchInput.tsx`
- Modify: `src/ui/components/SecondaryNav.tsx`
- Modify: `src/ui/components/StackTrace.tsx`
- Modify: `src/ui/components/StatusBar.tsx`
- Modify: `src/ui/components/WidgetCard.tsx`
- Modify: `src/ui/hooks/useSyntaxStyle.ts`
- Modify: `src/ui/screens/ConversationList.tsx`
- Modify: `src/ui/screens/DashboardDetail.tsx`
- Modify: `src/ui/screens/DashboardList.tsx`
- Modify: `src/ui/screens/ExploreTable.tsx`
- Modify: `src/ui/screens/IssueDetail.tsx`
- Modify: `src/ui/screens/IssueStream.tsx`
- Modify: `src/ui/screens/IssueViewsList.tsx`
- Modify: `src/ui/screens/LogStream.tsx`
- Modify: `src/ui/screens/MonitorDetail.tsx`
- Modify: `src/ui/screens/MonitorList.tsx`
- Modify: `src/ui/screens/ProfileFunctions.tsx`
- Modify: `src/ui/screens/ReleaseCards.tsx`
- Modify: `src/ui/screens/ReplayStream.tsx`
- Modify: `src/ui/screens/SavedQueries.tsx`
- Modify: `src/ui/screens/SavedQueryResults.tsx`
- Modify: `src/ui/screens/SeerExplorer.tsx`
- Modify: `src/ui/screens/SeerScreen.tsx`
- Modify: `src/ui/screens/WorkflowList.tsx`
- Modify: `src/ui/screens/exploreColumns.tsx`
- Modify: `src/ui/screens/monitorColumns.tsx`
- Modify: `src/ui/screens/monitorTimeline.tsx`
- Modify: `src/ui/screens/monitorTimelineSlot.tsx`
- Modify: `test/dataTable.test.tsx`
- Modify: `test/gotoMode.test.tsx`
- Modify: `test/issueDetail.test.tsx`
- Modify: `test/issueRow.test.tsx`
- Modify: `test/monitors.test.tsx`
- Modify: `test/selfUpdate.test.tsx`
- Modify: `scripts/check-theme-contrast.test.ts`
- Modify: `src/core/theme.ts`
- Create: `test/lightTheme.test.tsx`

**Interfaces:**

- Consumes: `useTheme(): Theme` from Task 2.
- Changes: `ExploreColumnContext` gains `theme: Theme`.
- Changes: `aggregateColumns(groupBys, yAxis, maxValue, theme)`.
- Changes: `monitorColumns(theme, context?)`.
- Changes: `renderDetectorDetail(detector, width, { projectSlugs, theme })`.
- Removes: `export const theme = darkTheme`.

- [ ] **Step 1: Write a failing representative light render test**

Render real components under a fixed light provider and assert their emitted colors:

```tsx
test("real controls use the light palette supplied by context", async () => {
  const source = new FakeThemeSource("light");
  const harness = await renderHarness(
    <ThemeProvider source={source} initialMode="light" fixed>
      <box style={{ backgroundColor: lightTheme.bg }}>
        <Chip label="Apply" />
        <KeyHint command="sentry.app.quit" />
      </box>
    </ThemeProvider>,
  );

  expect(rgbToHex(harness.spanContaining("Apply")!.fg)).toBe(lightTheme.text);
  expect(rgbToHex(harness.spanContaining("q")!.fg)).toBe(lightTheme.hotkey);
  await harness.cleanup();
});
```

Add a crash-screen case using the real `ErrorBoundary` so the fallback is also protected.
Render the real `App` under the fixed light provider and assert that the status
bar carries `lightTheme.panel`, then render a selected real `IssueRow` and
assert its spans carry `lightTheme.selected` as their background. These cases
cover the app canvas/chrome and selection surfaces named by the spec rather
than only leaf controls.

- [ ] **Step 2: Run the light render test and verify RED**

Run:

```bash
bun test test/lightTheme.test.tsx
```

Expected: FAIL because real components still read the dark singleton.

- [ ] **Step 3: Migrate component-local theme reads**

For each function component that currently imports the singleton:

```tsx
import { useTheme } from "~/ui/theme";

export function Component(props: Props) {
  const theme = useTheme();
  // Existing render logic unchanged.
}
```

Pass `theme` into non-component helper functions rather than calling hooks outside components. Add JSDoc only to newly exported functions, following repository style.

The exact migration set is the output of:

```bash
rg -l 'import \{ theme \} from "~/core/theme"' src/ui | sort
```

It must be empty after this task.

- [ ] **Step 4: Make column factories explicitly theme-aware**

Change Explore construction to:

```ts
exploreColumnsFor(table.id, { maxDurationMs, theme });
aggregateColumns(builder.groupBys, resolved.yAxis, maxAggregate, theme);
```

Include `theme` in the `useMemo` dependency list. Replace module-level `METRIC_COLUMNS`, `ERROR_COLUMNS`, and `LEVELS` with functions/local objects built from the passed palette.

Change monitor construction to:

```ts
monitorColumns(theme, timelineKind ? { visualization: ... } : undefined)
renderDetectorDetail(detector, detailWidth, { projectSlugs, theme })
```

Include `theme` in both memo/callback dependencies. Update pure column tests to pass `darkTheme`.

- [ ] **Step 5: Refresh syntax style when mode changes**

Change `useSyntaxStyle` to read context and reset/resolve per theme:

```ts
const theme = useTheme();
const [style, setStyle] = useState<SyntaxStyle>();

useEffect(() => {
  let cancelled = false;
  setStyle(undefined);
  void getSyntaxStyle(theme)
    .then((resolved) => {
      if (!cancelled) setStyle(resolved);
    })
    .catch(() => {
      if (!cancelled) setStyle(undefined);
    });
  return () => {
    cancelled = true;
  };
}, [theme]);
```

- [ ] **Step 6: Remove the singleton and update dark-default test imports**

Delete `export const theme = darkTheme`. Tests that inspect the default palette import `darkTheme` and alias it only when that makes assertions clearer:

```ts
import { darkTheme as theme } from "~/core/theme";
```

Update calls to the Explore and Monitor factories with explicit `darkTheme`.

- [ ] **Step 7: Run focused UI suites and verify GREEN**

Run:

```bash
bun test test/lightTheme.test.tsx test/app.test.tsx test/errorBoundary.test.tsx test/exploreTables.test.tsx test/monitors.test.tsx test/issueRow.test.tsx test/gotoMode.test.tsx
bun run typecheck
rg -n 'import \{ theme \} from "~/core/theme"|export const theme = darkTheme' src test scripts
```

Expected: tests and typecheck pass; `rg` prints nothing.

- [ ] **Step 8: Commit the reactive consumer migration**

```bash
git add src test scripts/check-theme-contrast.test.ts
git commit -m "ref(ui): Read colors from theme context"
```

---

### Task 4: Add size-capped light navigation assets

**Files:**

- Create: `src/assets/icons/compass_active_light.png`
- Create: `src/assets/icons/compass_inactive_light.png`
- Create: `src/assets/icons/dashboard_active_light.png`
- Create: `src/assets/icons/dashboard_inactive_light.png`
- Create: `src/assets/icons/issues_active_light.png`
- Create: `src/assets/icons/issues_inactive_light.png`
- Create: `src/assets/icons/monitors_active_light.png`
- Create: `src/assets/icons/monitors_inactive_light.png`
- Create: `src/assets/icons/seer_active_light.png`
- Create: `src/assets/icons/seer_inactive_light.png`
- Create: `src/assets/icons/settings_active_light.png`
- Create: `src/assets/icons/settings_inactive_light.png`
- Create: `src/assets/icons/sentry_light.png`
- Modify: `src/assets/navIcons.ts`
- Modify: `src/assets/navIcons.test.ts`
- Modify: `src/ui/components/NavIcon.tsx`

**Interfaces:**

- Consumes: `Theme.mode` through `useTheme()`.
- Changes: `navIconBytes(name: NavIconName, mode?: ThemeMode): Uint8Array`, defaulting to dark for compatibility.
- Preserves: stable byte identity for the same `name` and `mode`.

- [ ] **Step 1: Write failing asset-selection tests**

Structure the asset table by mode and assert real decoded data:

```ts
test("light mode selects a distinct light-canvas icon", () => {
  const dark = navIconBytes("issues_active", "dark");
  const light = navIconBytes("issues_active", "light");
  expect(light).not.toBe(dark);
  expect(imageInfo(light)).toMatchObject({ format: "png", width: 128, height: 128 });

  const image = NativeImage.decode(light);
  const raw = image.takeRaw();
  expect([...raw.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  raw.dispose();
  image.dispose();
});
```

Extend on-disk/import coverage to expect exactly one dark and one light file per logical icon, and run the existing max-size check over both modes.

- [ ] **Step 2: Run the asset tests and verify RED**

Run:

```bash
bun test src/assets/navIcons.test.ts
```

Expected: FAIL because light variants and the mode-aware lookup do not exist.

- [ ] **Step 3: Generate exact light variants from the updated 128px masks**

Use a temporary Swift/CoreGraphics script, not an AI redraw. For every source PNG:

1. Decode to RGBA.
2. Read the corner pixel as the old dark canvas.
3. Find the pixel farthest in RGB distance from the canvas as the old glyph endpoint.
4. Project each antialiased pixel onto that canvas-to-glyph vector, clamp the blend to `0...1`, and interpolate the same blend between the new colors.
5. Encode an sRGB PNG at the original 128 by 128 dimensions.

Use these target pairs:

```text
*_active.png   #FFFFFF canvas -> #5827D6 glyph
*_inactive.png #FFFFFF canvas -> #5B5864 glyph
sentry.png     #FFFFFF canvas -> #5B5864 glyph
```

Write the outputs with the `_light` names listed in this task. Inspect at least active, inactive, and Sentry outputs at original detail before proceeding.

- [ ] **Step 4: Statically import and select themed bytes**

Define:

```ts
const NAV_ICON_PATHS = {
  dark: {
    compass_active: compassActive,
    // every existing logical name
    sentry,
  },
  light: {
    compass_active: compassActiveLight,
    // every matching light import
    sentry: sentryLight,
  },
} as const satisfies Record<ThemeMode, Record<string, string>>;
```

`NAV_ICON_NAMES` remains the logical dark-map keys. `navIconBytes(name, mode = "dark")` reads from the selected map. `NavIcon` and `SentryLogo` call `useTheme()` and pass `theme.mode`.

- [ ] **Step 5: Run asset and navigation tests; verify GREEN**

Run:

```bash
bun test src/assets/navIcons.test.ts test/app.test.tsx
bun run typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit the themed navigation assets**

```bash
git add src/assets/icons src/assets/navIcons.ts src/assets/navIcons.test.ts src/ui/components/NavIcon.tsx
git commit -m "feat(ui): Add light navigation artwork"
```

---

### Task 5: Full verification, manual smoke test, and pull request

**Files:**

- Modify only files required by failures attributable to Tasks 1-4.

**Interfaces:**

- Consumes the completed feature.
- Produces a ready-for-review GitHub pull request from `feat/light-theme`.

- [ ] **Step 1: Run formatting and inspect the complete diff**

```bash
bun run format
git diff --check origin/main...HEAD
git status --short
git diff --stat origin/main...HEAD
```

Verify no unrelated files changed and no navigation image exceeds the committed cap.

- [ ] **Step 2: Run the full repository check**

```bash
bun run check
```

Expected: format, lint, typecheck, dependency boundaries, and every Bun test pass with zero failures.

- [ ] **Step 3: Load and follow the dev-pane skill**

Launch sentry-tui from this worktree in the current Herdr tab. Smoke test forced light first:

```bash
SENTRY_TUI_THEME=light bun run start
```

Inspect the app background, panels, borders, selected rows, chips, severity/status colors, syntax, timelines, crash-safe navigation, and light nav assets. Then repeat with:

```bash
SENTRY_TUI_THEME=dark bun run start
bun run start
```

For automatic mode, change the host terminal appearance if Herdr forwards the notification and verify visible state survives. If Herdr does not forward it, record that limitation and rely on the passing live-event integration test.

- [ ] **Step 4: Run verification again after any smoke-test fixes**

```bash
bun run check
git diff --check
```

Expected: all checks pass and the worktree is clean except for intended staged changes.

- [ ] **Step 5: Commit any final verification fixes**

```bash
git add src test scripts docs
git commit -m "test(ui): Cover terminal theme switching"
```

Skip this commit when there are no remaining uncommitted changes.

- [ ] **Step 6: Push and open a ready-for-review PR**

```bash
git push -u origin feat/light-theme
gh pr create --fill
```

Confirm the PR is not a draft and its base is `main`.
