import { useCallback, useSyncExternalStore } from "react";
import { useRenderer } from "@opentui/react";

type Renderer = ReturnType<typeof useRenderer>;

export interface ImageSupport {
  supported: boolean;
  supportsHighRes: boolean;
}

/**
 * Terminal multiplexers (Herdr, tmux, screen) may advertise kitty/sixel
 * because the outer terminal supports them, but intercept the protocol and
 * render ugly Unicode half-block fallbacks. Detect these environments so we
 * can skip image rendering entirely.
 */
const INSIDE_MUX = !!(process.env.HERDR_ENV || process.env.TMUX || process.env.STY);

const UNSUPPORTED: ImageSupport = { supported: false, supportsHighRes: false };

interface Store {
  value: ImageSupport;
  listeners: Set<() => void>;
  /** Retained so it can be detached once the last subscriber goes away. */
  handler: (() => void) | null;
}

/**
 * One capabilities subscription per renderer, shared by every caller.
 *
 * The answer is a property of the terminal, not of any component, and list
 * rows ask by the dozen — a listener each would blow past the renderer's
 * EventTarget limit on a long issue stream.
 */
const stores = new WeakMap<Renderer, Store>();

function storeFor(renderer: Renderer): Store {
  let store = stores.get(renderer);
  if (!store) {
    store = { value: UNSUPPORTED, listeners: new Set(), handler: null };
    stores.set(renderer, store);
  }
  return store;
}

/** Re-read capabilities, notifying subscribers only when the answer moved. */
function refresh(renderer: Renderer): void {
  const caps = renderer.capabilities;
  if (!caps) return;

  // "blocks" always works (uses Unicode half-block chars), so images are
  // always "supported" — but we expose a finer signal for callers that
  // care about hi-res (kitty/sixel).
  const next: ImageSupport = {
    supported: true,
    supportsHighRes: !INSIDE_MUX && (caps.kitty_graphics || caps.sixel),
  };

  const store = storeFor(renderer);
  if (
    store.value.supported === next.supported &&
    store.value.supportsHighRes === next.supportsHighRes
  ) {
    return;
  }

  // The snapshot is compared by reference, so it may only be replaced when the
  // value genuinely changed — otherwise every render schedules another.
  store.value = next;
  for (const listener of store.listeners) listener();
}

/**
 * Detects whether the terminal supports image rendering via kitty graphics
 * protocol, sixel, or falls back to Unicode half-block characters.
 *
 * `supported` is `true` when any image rendering protocol is available
 * (including the "blocks" fallback which works everywhere but looks coarser).
 *
 * `supportsHighRes` is `true` only when kitty or sixel is available **and**
 * we are not running inside a terminal multiplexer that would degrade them
 * to block characters.
 */
export function useImageSupport(): ImageSupport {
  const renderer = useRenderer();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const store = storeFor(renderer);
      store.listeners.add(onStoreChange);

      if (!store.handler) {
        store.handler = () => refresh(renderer);
        renderer.on("capabilities", store.handler);
      }

      // Capabilities may have landed before this subscriber existed.
      refresh(renderer);

      return () => {
        store.listeners.delete(onStoreChange);
        if (store.listeners.size === 0 && store.handler) {
          renderer.off("capabilities", store.handler);
          store.handler = null;
        }
      };
    },
    [renderer],
  );

  const getSnapshot = useCallback(() => storeFor(renderer).value, [renderer]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
