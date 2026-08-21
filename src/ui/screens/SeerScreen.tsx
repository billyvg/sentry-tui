import { useCallback, useContext, useEffect, useState } from "react";

import { matchesCommand } from "~/core/commands";
import { SEER_SUGGESTED_QUESTIONS } from "~/core/seer";
import { theme } from "~/core/theme";
import { SeerChatContext } from "~/ui/hooks/useSeerChat";
import { SeerExplorer } from "~/ui/screens/SeerExplorer";
import type { ScreenProps } from "~/ui/screens/types";

/**
 * Seer › Ask Seer, as a registered screen.
 *
 * The adapter between a chat and the screen contract. Two things it does that
 * a table screen doesn't:
 *
 * - The transcript comes from `SeerChatContext`, not from a hook called here,
 *   so navigating away and back does not throw the conversation away.
 * - The composer claims the keyboard through `registerActions`, the same seam
 *   the log detail panel uses for Escape. While it holds focus, Enter sends and
 *   Escape releases; without that the app's global commands would fire on the
 *   letters being typed.
 *
 * The composer's text lives in the screen's own state slice, so a half-written
 * question survives a trip to another screen exactly as a half-written filter
 * does.
 */
export function SeerScreen({ state, width, height, focused, registerActions }: ScreenProps) {
  const chat = useContext(SeerChatContext);
  const [inputFocused, setInputFocused] = useState(true);

  const value = state.searchQuery;
  const setValue = state.setSearchQuery;

  // The composer only counts as focused while the content pane holds focus, so
  // tabbing to the nav rail can't leave two widgets both claiming keys.
  const composerFocused = focused && inputFocused;

  const submit = useCallback(() => {
    if (!chat) return false;
    chat.send(value);
    setValue("");
    return true;
  }, [chat, value, setValue]);

  /** Keys that belong to the transcript, i.e. while the composer is let go. */
  const handleKey = useCallback(
    (key: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) => {
      if (!chat) return false;
      if (matchesCommand("sentry.seer.compose", key) || matchesCommand("sentry.nav.open", key)) {
        setInputFocused(true);
        return true;
      }
      if (matchesCommand("sentry.seer.newChat", key)) {
        chat.reset();
        setValue("");
        setInputFocused(true);
        return true;
      }
      if (matchesCommand("sentry.seer.interrupt", key)) {
        if (chat.thinking) chat.interrupt();
        return true;
      }
      // Suggested prompts are only offered while the chat is empty.
      if (chat.blocks.length === 0 && !key.ctrl && !key.meta) {
        const question = SEER_SUGGESTED_QUESTIONS[Number(key.name) - 1];
        if (question !== undefined) {
          chat.send(question);
          return true;
        }
      }
      return false;
    },
    [chat, setValue],
  );

  useEffect(() => {
    registerActions({
      inputFocused: () => composerFocused,
      submitInput: submit,
      blurInput: () => setInputFocused(false),
      handleKey,
    });
    return () => registerActions(null);
  }, [registerActions, composerFocused, submit, handleKey]);

  if (!chat) {
    // Only reachable if the screen is rendered outside `App`'s provider.
    return <text fg={theme.muted}>Seer is unavailable.</text>;
  }

  return (
    <SeerExplorer
      chat={chat}
      width={width}
      height={height}
      focused={focused}
      value={value}
      onInput={setValue}
      inputFocused={composerFocused}
      onInputFocus={() => setInputFocused(true)}
      onInputBlur={() => setInputFocused(false)}
    />
  );
}
