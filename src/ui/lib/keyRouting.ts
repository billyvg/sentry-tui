import type { KeyEvent } from "@opentui/core";

/**
 * OpenTUI delivers keys to global listeners *before* the focused renderable —
 * the inverse of the browser. So "I didn't handle this" doesn't mean "leave it
 * alone", it means "a scrollbox is about to scroll a page". A boolean can't
 * express the difference between those outcomes, so handlers return an owner.
 *
 * | answer      | ends chain? | widget gets key? | consumed?        |
 * | "notMine"   | no          | (decided later)  | (decided later)  |
 * | "mine"      | yes         | no               | yes, by dispatch |
 * | "focused"   | yes         | yes              | no               |
 *
 * `"focused"` has exactly one trigger: a focused text input needs the key as
 * text.
 */
export type KeyOwner = "notMine" | "mine" | "focused";

export type KeyOwnerHandler = (key: KeyEvent) => KeyOwner;

/**
 * Consuming a key means both stopping the default *and* stopping propagation —
 * the latter also stops sibling global listeners.
 */
export function consumeKey(key: KeyEvent): void {
  key.preventDefault();
  key.stopPropagation();
}

/**
 * Walk handlers in precedence order until one claims the key.
 *
 * Centralizing `consume` here means a handler can no longer act on a key and
 * forget to consume it — "acted" and "consumed" are the same return value.
 *
 * @returns whether the chain ended (i.e. some handler claimed the key)
 */
export function routeKeyOwnership(
  handlers: readonly KeyOwnerHandler[],
  key: KeyEvent,
  consume: (key: KeyEvent) => void = consumeKey,
): boolean {
  for (const handle of handlers) {
    const owner = handle(key);
    if (owner === "notMine") continue;
    if (owner === "mine") consume(key);
    return true;
  }
  return false;
}
