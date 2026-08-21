import { useEffect } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import type { AppContext } from "~/app/startup";
import { finishStartup, setTerminalRestore, shutdownTelemetry } from "~/telemetry/index";
import { App } from "~/ui/App";
import { ErrorBoundary } from "~/ui/components/ErrorBoundary";

/**
 * Owns the renderer lifecycle. `renderer.destroy()` must run on every exit path
 * or the terminal is left in `-echo`/`-icanon` and the user has to run `reset`.
 */
export async function runApp({ client, org }: AppContext): Promise<void> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    exitOnCtrlC: false, // the app owns Ctrl-C so it can shut down cleanly
    openConsoleOnError: true,
    targetFps: 30,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    renderer.destroy();
    // Only after the terminal is its own again: closing the session waits on
    // the network, capped, and must never happen behind the alternate screen.
    await shutdownTelemetry();
    process.exit(0);
  };

  // A crash reporter needs the screen back before it can print anything.
  setTerminalRestore(() => renderer.destroy());

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  createRoot(renderer).render(
    <ErrorBoundary onQuit={() => void shutdown()}>
      <FirstPaint />
      <App onQuit={() => void shutdown()} client={client} org={org} />
    </ErrorBoundary>,
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
