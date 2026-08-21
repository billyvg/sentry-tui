import { useEffect, useState } from "react";

import {
  canSelfUpdate,
  checkForUpdate,
  readyUpdate,
  UPDATE_POLL_MS,
  type ReadyUpdate,
} from "~/app/selfUpdate";

/**
 * Watch for a newer build, and report it once it is on disk and runnable.
 *
 * Inert unless the npm launcher started us — see `canSelfUpdate` — so tests,
 * `bun run start`, and a hand-downloaded binary never reach the network.
 *
 * The first look is a cache read with no request behind it. The launcher spawns
 * its own background worker moments before the app starts, so a check here at
 * mount would be the same request twice; what this picks up instead is whatever
 * that worker already left behind. The hourly poll then covers the only case
 * the launcher cannot: a release that lands while the app is open.
 */
export function useUpdateCheck(): ReadyUpdate | undefined {
  const [update, setUpdate] = useState<ReadyUpdate | undefined>(undefined);

  useEffect(() => {
    if (!canSelfUpdate()) return;

    let live = true;
    setUpdate(readyUpdate());

    const timer = setInterval(() => {
      void checkForUpdate().then((found) => {
        // An unmount mid-download would otherwise set state on a dead tree.
        if (live) setUpdate(found);
      });
    }, UPDATE_POLL_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return update;
}
