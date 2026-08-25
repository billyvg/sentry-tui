import type { ReactNode } from "react";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { CapturedSpan } from "@opentui/core";
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
  /**
   * Click a terminal cell, in the same `act()` envelope `press` uses so the
   * resulting state update reaches the renderer before the next capture.
   */
  click: (x: number, y: number) => Promise<void>;
  /** Expand the compact primary nav through its mouse interaction. */
  openNav: () => Promise<void>;
  /**
   * Let real time pass, settling whatever it releases — a debounce, a poll.
   *
   * In the same `act()` envelope `press` uses: a timer that fires outside one
   * updates React after the assertion has already read the frame, and says so
   * on stderr.
   */
  wait: (ms: number) => Promise<void>;
  frame: () => string;
  /**
   * The rendered span containing `needle`, with its real color and attribute
   * bits. `frame()` flattens styling away, so this is the only way to assert
   * that italic or a specific `fg` actually reached the terminal.
   */
  spanContaining: (needle: string) => CapturedSpan | undefined;
  /** Tear down the renderer, settling the unmount so React stays quiet. */
  cleanup: () => Promise<void>;
}

/**
 * How long to hold a bare ESC so the parser can rule out an escape sequence.
 *
 * Measured: the parser needs somewhere between 10ms and 20ms, so this keeps a
 * 2.5x margin. It was 100ms, which across the suite was ~3s of pure sleeping.
 * A longer wait is always safe (the risk is waiting too little), so err up
 * rather than down if this ever gets flaky.
 *
 * Zero wait is possible under the kitty keyboard protocol, where ESC is
 * unambiguous — but that would parse keys differently from how the app is
 * actually driven, so it is deliberately not used here.
 */
const ESCAPE_DISAMBIGUATION_MS = 40;

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

  const click = async (x: number, y: number) => {
    // Settle mouse-down before release. A real terminal delivers these as
    // separate events, and the first can mount an overlay that receives the
    // second; batching both would hide event-order regressions in tests.
    await act(async () => {
      await setup.mockMouse.pressDown(x, y);
    });
    await setup.flush();
    await act(async () => {
      await setup.mockMouse.release(x, y);
    });
    await setup.flush();
  };

  return Object.assign(setup, {
    press,
    pressEscape: async () => {
      await act(async () => {
        setup.mockInput.pressEscape();
        await new Promise((resolve) => setTimeout(resolve, ESCAPE_DISAMBIGUATION_MS));
      });
      await setup.flush();
    },
    click,
    // Inside the collapsed rail's top row whether or not an org marker is
    // present; the rail owns the whole compact surface as its hit target.
    openNav: () => click(2, 1),
    wait: async (ms: number) => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
      await setup.flush();
    },
    frame: () => setup.captureCharFrame(),
    spanContaining: (needle: string) =>
      setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes(needle)),
    cleanup: async () => {
      await act(async () => {
        setup.renderer.destroy();
      });
    },
  });
}
