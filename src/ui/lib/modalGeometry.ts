export interface ModalGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Center a modal and clamp it to the terminal, leaving a small margin. */
export function resolveModalGeometry({
  width,
  height,
  terminalWidth,
  terminalHeight,
  margin = 2,
}: {
  width: number;
  height: number;
  terminalWidth: number;
  terminalHeight: number;
  margin?: number;
}): ModalGeometry {
  const clampedWidth = Math.max(
    1,
    Math.min(width, terminalWidth - margin * 2),
  );
  const clampedHeight = Math.max(
    1,
    Math.min(height, terminalHeight - margin * 2),
  );
  return {
    width: clampedWidth,
    height: clampedHeight,
    left: Math.max(0, Math.floor((terminalWidth - clampedWidth) / 2)),
    top: Math.max(0, Math.floor((terminalHeight - clampedHeight) / 2)),
  };
}

/**
 * Window a list so the selected row stays visible, centered when possible.
 * @returns index of the first row to render
 */
export function listWindowStart(
  selectedIndex: number,
  rowCount: number,
  visibleRows: number,
): number {
  if (rowCount <= visibleRows) return 0;
  const centered = selectedIndex - Math.floor(visibleRows / 2);
  return Math.min(Math.max(centered, 0), rowCount - visibleRows);
}
