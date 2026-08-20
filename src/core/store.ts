/**
 * A synchronous observable store — no zustand, no context.
 *
 * Deliberately small: state is one object, updates go through a reducer, and
 * subscribers are notified after the snapshot swaps.
 */
export interface Store<S, A> {
  getSnapshot(): S;
  subscribe(listener: () => void): () => void;
  dispatch(action: A): S;
}

export function createStore<S, A>(
  initial: S,
  reduce: (state: S, action: A) => S,
): Store<S, A> {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(action) {
      const next = reduce(snapshot, action);
      if (next === snapshot) return snapshot;
      snapshot = next;
      // Copy first: a listener may unsubscribe while we're notifying.
      for (const listener of Array.from(listeners)) listener();
      return snapshot;
    },
  };
}
