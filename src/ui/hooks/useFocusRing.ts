import { useCallback, useMemo, useRef, useState } from "react";

/**
 * OpenTUI has no automatic Tab traversal — "your application must choose the
 * next renderable and call focus()". This is that choice, kept declarative:
 * regions are an ordered list and components read `isFocused(region)` into the
 * `focused` prop rather than calling `focus()` imperatively.
 */
export function useFocusRing<T extends string>(regions: readonly T[]) {
  const [focused, setFocused] = useState<T>(regions[0]!);

  // Keyboard handlers run against a stdin burst before any render answers, so
  // they must read the live value rather than a captured one.
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const move = useCallback(
    (delta: number) => {
      const current = regions.indexOf(focusedRef.current);
      const next = (current + delta + regions.length) % regions.length;
      setFocused(regions[next]!);
    },
    [regions],
  );

  return useMemo(
    () => ({
      focused,
      focusedRef,
      isFocused: (region: T) => focused === region,
      focus: setFocused,
      next: () => move(1),
      prev: () => move(-1),
    }),
    [focused, move],
  );
}
