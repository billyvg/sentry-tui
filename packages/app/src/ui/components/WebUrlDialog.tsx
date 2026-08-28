import { useKeyboard } from "@opentui/react";

import { matchesCommand } from "~/core/commands";
import { ModalFrame } from "~/ui/components/ModalFrame";
import { useTheme } from "~/ui/theme";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";

const DIALOG_WIDTH = 84;
const DIALOG_HEIGHT = 12;

/** Show the canonical URL when this machine cannot launch a browser. */
export function WebUrlDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const theme = useTheme();

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        () => {
          if (!matchesCommand("sentry.nav.back", key)) return "notMine";
          onClose();
          return "mine";
        },
      ],
      key,
      consumeKey,
    );
  });

  return (
    <ModalFrame
      title=" Open in Sentry "
      width={DIALOG_WIDTH}
      height={DIALOG_HEIGHT}
      onClose={onClose}
    >
      <text fg={theme.warning}>Could not launch a browser. Open this production URL:</text>
      <text fg={theme.text} style={{ wrapMode: "char" }}>
        {url}
      </text>
      <text fg={theme.subText}>esc close</text>
    </ModalFrame>
  );
}
