import type { ReactNode } from "react";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";

export interface Harness extends TestRendererSetup {
  /**
   * Send input and settle the resulting React work.
   *
   * Input must be wrapped in `act()` — `mockInput` delivers the key
   * synchronously, but the state update it schedules won't reach the renderer
   * before the next `captureCharFrame()` otherwise, so assertions silently see
   * the previous frame.
   */
  press: (fn: (input: TestRendererSetup["mockInput"]) => void) => Promise<void>;
  /**
   * Press Escape. A bare ESC is held briefly to disambiguate it from the start
   * of an escape sequence (`ESC[A` etc.), so it needs a real wait, not a flush.
   */
  pressEscape: () => Promise<void>;
  frame: () => string;
  /** Tear down the renderer, settling the unmount so React stays quiet. */
  cleanup: () => Promise<void>;
}

const ESCAPE_DISAMBIGUATION_MS = 100;

export async function renderHarness(
  node: ReactNode,
  { width = 100, height = 24 } = {},
): Promise<Harness> {
  const setup = await act(async () => testRender(node, { width, height }));
  await setup.flush();

  const press = async (fn: (input: TestRendererSetup["mockInput"]) => void) => {
    await act(async () => {
      fn(setup.mockInput);
    });
    await setup.flush();
  };

  return Object.assign(setup, {
    press,
    pressEscape: async () => {
      await act(async () => {
        setup.mockInput.pressEscape();
        await new Promise((resolve) =>
          setTimeout(resolve, ESCAPE_DISAMBIGUATION_MS),
        );
      });
      await setup.flush();
    },
    frame: () => setup.captureCharFrame(),
    cleanup: async () => {
      await act(async () => {
        setup.renderer.destroy();
      });
    },
  });
}
