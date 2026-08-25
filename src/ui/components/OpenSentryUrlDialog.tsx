import { useState } from "react";
import { useKeyboard } from "@opentui/react";

import { matchesCommand } from "~/core/commands";
import type { SentryUrlFailure } from "~/core/sentryUrl";
import { ModalFrame } from "~/ui/components/ModalFrame";
import { useTheme } from "~/ui/theme";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";

const DIALOG_WIDTH = 76;
const DIALOG_HEIGHT = 8;

export interface OpenSentryUrlDialogProps {
  /** Return a failure to keep the dialog open, or undefined after opening it. */
  onSubmit: (url: string) => SentryUrlFailure | undefined;
  onClose: () => void;
}

/** Prompt for a copied Sentry production URL and show parse failures in place. */
export function OpenSentryUrlDialog({ onSubmit, onClose }: OpenSentryUrlDialogProps) {
  const theme = useTheme();
  const [url, setUrl] = useState("");
  const [failure, setFailure] = useState<SentryUrlFailure>();

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        () => {
          if (matchesCommand("sentry.nav.back", key)) {
            onClose();
            return "mine";
          }
          if (matchesCommand("sentry.nav.open", key)) {
            setFailure(onSubmit(url));
            return "mine";
          }
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  const prefix = failure?.kind === "unsupported" ? "Not implemented" : "Invalid URL";

  return (
    <ModalFrame
      title=" Open Sentry URL "
      width={DIALOG_WIDTH}
      height={DIALOG_HEIGHT}
      onClose={onClose}
    >
      <text fg={theme.muted}>Paste a sentry.io URL</text>
      <input
        value={url}
        placeholder="https://acme.sentry.io/issues/…"
        focused
        onInput={(value) => {
          setUrl(value);
          setFailure(undefined);
        }}
        style={{
          marginTop: 1,
          textColor: theme.text,
          backgroundColor: theme.panel,
          focusedTextColor: theme.text,
          focusedBackgroundColor: theme.panel,
          placeholderColor: theme.subText,
        }}
      />
      {failure ? (
        <text fg={failure.kind === "invalid" ? theme.danger : theme.warning}>
          {`${prefix}: ${failure.message}`}
        </text>
      ) : (
        <text fg={theme.subText}>enter open · esc cancel</text>
      )}
    </ModalFrame>
  );
}
