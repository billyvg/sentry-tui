import { useEffect, useMemo } from "react";

import { getNavGroup, type NavGroupId } from "~/core/nav";
import { abandonNavigation, beginNavigation, breadcrumb, endNavigation } from "~/telemetry/index";

/**
 * How long to wait before believing a screen is done loading.
 *
 * A screen mounts with nothing in flight, so `loading` is false for the commit
 * or two before its fetch starts. Ending the span on that first false would
 * time the gap rather than the load.
 */
const SETTLE_DEBOUNCE_MS = 250;

/**
 * Time each screen the user opens, from the keystroke to the rows appearing.
 *
 * The span is also what the API client's request spans hang off, so a screen
 * open arrives in Sentry as one tree — the navigation, and every fetch it set
 * off underneath it. No-op unless telemetry is on.
 */
export function useNavigationTrace(group: NavGroupId, item: string, loading: boolean): void {
  const name = `${getNavGroup(group).label} › ${item}`;

  // Opened during render, not in an effect, and that is not an accident:
  // React runs child effects before parent ones, so a screen's first fetch —
  // the one the whole span exists to measure — starts before any effect here
  // could have opened a parent for it, and lands as its own orphan trace.
  // Rendering is the only point that reliably precedes the children.
  useMemo(() => {
    beginNavigation(name);
    breadcrumb({ category: "navigation", message: name });
  }, [name]);

  // Navigating away mid-load ends the span where the user abandoned it. The
  // name is passed because this cleanup runs *after* the next screen's render
  // has already opened its span — unguarded, it would close that one instead.
  useEffect(() => () => abandonNavigation(name), [name]);

  useEffect(() => {
    if (loading) return;
    // Record when it settled, not when the debounce agreed it had. A screen
    // with nothing to fetch settles at mount, and reads as the instant it is.
    const settledAt = Date.now();
    const settle = setTimeout(() => endNavigation(name, settledAt), SETTLE_DEBOUNCE_MS);
    return () => clearTimeout(settle);
  }, [name, loading]);
}
