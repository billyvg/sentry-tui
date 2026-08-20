import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const FRAME_MS = 80;

/**
 * OpenTUI ships no spinner. This is a braille cycle driven by an interval.
 *
 * It only ticks while mounted, so callers must unmount it when nothing is in
 * flight — a permanently animating frame redraws the terminal for nothing.
 */
export function useSpinnerFrame(active = true): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(timer);
  }, [active]);

  return FRAMES[index]!;
}
