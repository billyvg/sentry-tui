import type { ReactNode } from "react";
import { useTerminalDimensions } from "@opentui/react";

import { theme } from "~/core/theme";
import { resolveModalGeometry } from "~/ui/lib/modalGeometry";

const SCRIM_Z = 55;
const FRAME_Z = 60;

/**
 * OpenTUI ships no modal component. This is the primitive: a full-screen scrim
 * that swallows clicks, plus a centered, clamped frame above it.
 */
export function ModalFrame({
  title,
  width,
  height,
  onClose,
  children,
}: {
  title: string;
  width: number;
  height: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const geo = resolveModalGeometry({
    width,
    height,
    terminalWidth: termWidth,
    terminalHeight: termHeight,
  });

  return (
    <>
      <box
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: termWidth,
          height: termHeight,
          zIndex: SCRIM_Z,
        }}
        onMouseUp={onClose}
      />
      <box
        title={title}
        style={{
          position: "absolute",
          top: geo.top,
          left: geo.left,
          width: geo.width,
          height: geo.height,
          zIndex: FRAME_Z,
          border: true,
          borderColor: theme.accent,
          backgroundColor: theme.panel,
          flexDirection: "column",
          padding: 1,
        }}
        onMouseUp={(event) => event.stopPropagation()}
      >
        {children}
      </box>
    </>
  );
}
