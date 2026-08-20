import { useEffect, useState } from "react";
import { useRenderer } from "@opentui/react";

/**
 * Detects whether the terminal supports image rendering via kitty graphics
 * protocol, sixel, or falls back to Unicode half-block characters.
 *
 * Returns `true` when any image rendering protocol is available (including
 * the "blocks" fallback which works everywhere but looks coarser).
 *
 * `supportsHighRes` is `true` only when kitty or sixel is available.
 */
export function useImageSupport(): { supported: boolean; supportsHighRes: boolean } {
  const renderer = useRenderer();
  const [result, setResult] = useState({ supported: false, supportsHighRes: false });

  useEffect(() => {
    function check() {
      const caps = renderer.capabilities;
      if (!caps) return;

      const hasKitty = caps.kitty_graphics;
      const hasSixel = caps.sixel;
      // "blocks" always works (uses Unicode half-block chars), so images are
      // always "supported" — but we expose a finer signal for callers that
      // care about hi-res (kitty/sixel).
      setResult({
        supported: true,
        supportsHighRes: hasKitty || hasSixel,
      });
    }

    check();
    renderer.on("capabilities", check);
    return () => {
      renderer.off("capabilities", check);
    };
  }, [renderer]);

  return result;
}
