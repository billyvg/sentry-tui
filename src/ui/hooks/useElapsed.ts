import { useEffect, useState } from "react";

/**
 * A coarse clock that only ticks while `active`.
 *
 * Used for the "…3.2s" suffix on a slow load, which is what distinguishes slow
 * from hung. Ticking at 10Hz is plenty for one decimal place and avoids
 * re-rendering the tree every frame.
 */
export function useElapsed(active: boolean, since: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [active]);

  if (!active || since === undefined) return undefined;
  return Math.max(0, now - since);
}
