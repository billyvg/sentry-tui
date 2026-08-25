import { useEffect } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { restartInto } from "~/app/selfUpdate";
import type { AppContext } from "~/app/startup";
import { flushConfigWrites } from "~/api/config";
import { parseThemePreference } from "~/core/theme";
import { finishStartup, log, setTerminalRestore, shutdownTelemetry } from "~/telemetry/index";
import { App } from "~/ui/App";
import { ErrorBoundary } from "~/ui/components/ErrorBoundary";
import { resolveInitialTheme, ThemeProvider } from "~/ui/theme";

/**
 * Owns the renderer lifecycle. `renderer.destroy()` must run on every exit path
 * or the terminal is left in `-echo`/`-icanon` and the user has to run `reset`.
 */
export async function runApp({
  client,
  org,
  projectsByOrg,
  initialLocation,
}: AppContext): Promise<void> {
  const preference = parseThemePreference(process.env["SENTRY_TUI_THEME"]);
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    exitOnCtrlC: false, // the app owns Ctrl-C so it can shut down cleanly
    openConsoleOnError: true,
    targetFps: 30,
  });
  const selection = await resolveInitialTheme(renderer, preference);

  const openedAt = Date.now();
  log("info", "app.session.started", {
    org,
    // Terminal shape decides what the app can draw, so it is the first thing
    // worth knowing when a screen looks wrong for someone and not for us.
    columns: renderer.terminalWidth,
    rows: renderer.terminalHeight,
    theme: selection.mode,
    theme_source: selection.source,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    renderer.destroy();
    await flushConfigWrites();
    log("info", "app.session.ended", { duration_ms: Date.now() - openedAt });
    // Only after the terminal is its own again: closing the session waits on
    // the network, capped, and must never happen behind the alternate screen.
    await shutdownTelemetry();
    process.exit(0);
  };

  /**
   * Hand the terminal to a newly downloaded build.
   *
   * `renderer.destroy()` first, for the same reason `shutdown` does it: the
   * child inherits this terminal, and one left in `-echo`/`-icanon` reaches it
   * that way. Telemetry is closed the same way too — the exec never returns, so
   * anything still buffered would die with this process.
   *
   * The line to stderr covers the gap the exec opens: the new binary resolves
   * credentials before it can draw, and a blank terminal for a second reads as
   * a crash.
   */
  const restart = async (binaryPath: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    renderer.destroy();
    await flushConfigWrites();
    log("info", "app.session.ended", { duration_ms: Date.now() - openedAt, reason: "update" });
    await shutdownTelemetry();
    process.stderr.write("sentry-tui: restarting into the new version…\n");
    restartInto(binaryPath);
  };

  // A crash reporter needs the screen back before it can print anything.
  setTerminalRestore(() => renderer.destroy());

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  createRoot(renderer).render(
    <ThemeProvider source={renderer} initialMode={selection.mode} fixed={selection.fixed}>
      <ErrorBoundary onQuit={() => void shutdown()}>
        <FirstPaint />
        <App
          onQuit={() => void shutdown()}
          onRestart={(path) => void restart(path)}
          client={client}
          org={org}
          initialLocation={initialLocation}
          initialProjectsByOrg={projectsByOrg}
        />
      </ErrorBoundary>
    </ThemeProvider>,
  );
}

/**
 * Marks the end of startup, the moment React first commits.
 *
 * A sibling of `App` rather than something inside it: startup timing is the
 * renderer's business, and `App` has enough to think about.
 */
function FirstPaint() {
  useEffect(() => finishStartup(), []);
  return null;
}
