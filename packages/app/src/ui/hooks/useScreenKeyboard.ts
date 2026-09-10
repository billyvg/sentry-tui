import { useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";

/**
 * How many modal overlays are mounted.
 *
 * A count rather than a boolean: modals stack (a dialog opened from a dialog),
 * and the one unmounting is not always the last one mounted.
 */
let openModals = 0;

/**
 * Give the calling modal the keyboard for as long as it is mounted.
 *
 * `ModalFrame` is the only caller — a modal owns the keyboard by virtue of
 * being on screen, so nothing has to remember to claim it.
 */
export function useModalKeyOwnership(): void {
  useEffect(() => {
    openModals += 1;
    return () => {
      openModals -= 1;
    };
  }, []);
}

/** Whether a modal overlay currently owns the keyboard. */
export function isModalOpen(): boolean {
  return openModals > 0;
}

/**
 * A global key listener owned by whatever the content pane is drawing, silent
 * while a modal is open.
 *
 * The app's own listener stops routing at an open overlay, but it can only
 * speak for the handlers in its own chain. OpenTUI delivers each key to every
 * global listener, oldest first, so a screen that mounted before the modal
 * hears — and consumes — the modal's keys first: enter collapsed a stack frame
 * behind the command palette instead of running the selected command. A screen
 * listener asks here instead of inspecting overlay state it cannot see.
 */
export function useScreenKeyboard(handler: (key: KeyEvent) => void): void {
  useKeyboard((key) => {
    if (isModalOpen()) return;
    handler(key);
  });
}
