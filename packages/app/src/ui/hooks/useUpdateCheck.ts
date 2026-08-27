import { useEffect, useState } from "react";

import { type ReadyUpdate, watchForUpdate } from "@sentry-tui/runtime-contract/update";

/**
 * Watch for a newer build, and report it once it is on disk and runnable.
 *
 * React plumbing only — when the app looks, and whether it looks at all, is
 * `watchForUpdate`'s to decide (the runtime host states the cadence in full).
 * cadence in full). Inert unless the npm launcher started us, so tests,
 * `bun run start`, and a hand-downloaded binary never reach the network.
 */
export function useUpdateCheck(): ReadyUpdate | undefined {
  const [update, setUpdate] = useState<ReadyUpdate | undefined>(undefined);

  useEffect(() => watchForUpdate(setUpdate), []);

  return update;
}
