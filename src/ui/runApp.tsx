import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import type { AppContext } from "~/app/startup";
import { App } from "~/ui/App";

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
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    renderer.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  createRoot(renderer).render(<App onQuit={shutdown} client={client} org={org} />);
}
