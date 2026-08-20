import { useEffect } from "react";

import type { ScreenActions } from "~/ui/screens/types";

/**
 * Register the keyboard actions the app should route to this screen.
 *
 * The registration is cleared on unmount, so a screen that has navigated away
 * can't answer for Enter on the screen that replaced it.
 *
 * @param register `props.registerActions`.
 * @param actions What Enter means on this screen. Rebuilt every render is
 *   fine — the app reads it through a ref, not a dependency.
 */
export function useScreenActions(
  register: (actions: ScreenActions | null) => void,
  actions: ScreenActions,
): void {
  useEffect(() => {
    register(actions);
    return () => register(null);
  });
}
