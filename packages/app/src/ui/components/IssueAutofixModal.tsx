import { useCallback, useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import type { Group } from "~/api/types";
import { matchesCommand } from "~/core/commands";
import { issueTitle } from "~/lib/issueText";
import { ModalFrame } from "~/ui/components/ModalFrame";
import type { SeerChatState } from "~/ui/hooks/useSeerChat";
import { consumeKey } from "~/ui/lib/keyRouting";
import { resolveModalGeometry } from "~/ui/lib/modalGeometry";
import { SeerConversation } from "~/ui/screens/SeerScreen";
import type { ScreenActions, ScreenProps } from "~/ui/screens/types";

/** The issue-scoped request sent as the first turn of an Autofix conversation. */
export function issueAutofixPrompt(issue: Group): string {
  return `Please try to root cause and propose a fix for issue ${issue.shortId}: ${issueTitle(issue)} (${issue.permalink})`;
}

/** A Seer conversation in a modal window over the issue that started it. */
export function IssueAutofixModal({
  issue,
  chat,
  client,
  org,
  navigateToScreen,
  notify,
  onClose,
}: {
  issue: Group;
  chat: SeerChatState;
  client: ScreenProps["client"];
  org: string;
  navigateToScreen: ScreenProps["navigateToScreen"];
  notify: ScreenProps["notify"];
  onClose: () => void;
}) {
  const terminal = useTerminalDimensions();
  const [value, setValue] = useState("");
  const actions = useRef<ScreenActions | null>(null);
  const sent = useRef(false);
  const desiredWidth = Math.min(100, Math.max(40, terminal.width - 8));
  const desiredHeight = Math.min(40, Math.max(18, terminal.height - 6));
  const geometry = resolveModalGeometry({
    width: desiredWidth,
    height: desiredHeight,
    terminalWidth: terminal.width,
    terminalHeight: terminal.height,
  });

  const registerActions = useCallback((next: ScreenActions | null) => {
    actions.current = next;
  }, []);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    chat.send(issueAutofixPrompt(issue));
  }, [chat.send, issue]);

  useKeyboard((key) => {
    const current = actions.current;
    if (current?.inputFocused?.()) {
      if (matchesCommand("sentry.nav.back", key)) {
        current.blurInput?.();
        consumeKey(key);
        return;
      }
      if (matchesCommand("sentry.nav.open", key)) {
        current.submitInput?.();
        consumeKey(key);
        return;
      }
      if (current.handleInputKey?.(key)) consumeKey(key);
      // Every other key belongs to the focused input renderable.
      return;
    }

    if (matchesCommand("sentry.nav.back", key)) {
      if (!current?.back?.()) onClose();
      consumeKey(key);
      return;
    }
    if (current?.handleKey?.(key)) {
      consumeKey(key);
      return;
    }
    // Nothing behind a modal should answer an unclaimed key.
    consumeKey(key);
  });

  return (
    <ModalFrame
      title={` Autofix · ${issue.shortId} `}
      width={desiredWidth}
      height={desiredHeight}
      onClose={onClose}
    >
      <SeerConversation
        chat={chat}
        client={client}
        org={org}
        width={Math.max(10, geometry.width - 4)}
        height={Math.max(8, geometry.height - 3)}
        focused
        value={value}
        setValue={setValue}
        registerActions={registerActions}
        navigateToScreen={(screen, initialState) => {
          onClose();
          navigateToScreen(screen, initialState);
        }}
        notify={notify}
      />
    </ModalFrame>
  );
}
