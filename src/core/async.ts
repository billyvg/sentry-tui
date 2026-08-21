/**
 * Async state as data, keyed by entity.
 *
 * Component-local `isLoading` booleans can't survive a remount and can't be
 * read by the status bar, so every in-flight request lives here instead. The
 * `previous` field is what makes refreshes non-destructive: a reload keeps the
 * old value on screen (dimmed) rather than flashing back to skeletons.
 */

import { ApiError } from "~/api/client";
import { reportError } from "~/telemetry/index";

export interface AsyncError {
  message: string;
  retryable: boolean;
  /** Seconds to wait before retrying, when the server said so. */
  retryAfterSeconds?: number;
}

/**
 * Narrow anything thrown by a fetch into the shape the UI renders.
 *
 * An `ApiError` already knows whether it is worth retrying; anything else is a
 * surprise, and surprises are assumed transient so the user gets a retry hint
 * rather than a dead end.
 *
 * That second branch is also the one worth reporting. A response the client
 * accepted but a normalizer choked on is a bug in sentry-tui — invisible
 * otherwise, since the UI shows one line and moves on. `ApiError`s are left
 * alone here: the client already decides which of those deserve a report.
 */
export function toAsyncError(error: unknown): AsyncError {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  if (!isAbort(error)) reportError(error, { source: "fetch.unexpected" });

  return {
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

/**
 * A superseded or timed-out request, not a fault.
 *
 * Callers guard against these before they get here, but a fetch that a caller
 * forgot to guard would otherwise report on every keystroke.
 */
function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

export type AsyncStatus<T> =
  | { state: "idle" }
  | { state: "loading"; since: number; previous?: T }
  | { state: "ready"; value: T; fetchedAt: number }
  | { state: "error"; error: AsyncError; previous?: T };

export const idle = <T>(): AsyncStatus<T> => ({ state: "idle" });

/** Begin a load, carrying forward whatever value is currently on screen. */
export function startLoading<T>(current: AsyncStatus<T> | undefined, now: number): AsyncStatus<T> {
  return { state: "loading", since: now, previous: valueOf(current) };
}

export function resolved<T>(value: T, now: number): AsyncStatus<T> {
  return { state: "ready", value, fetchedAt: now };
}

export function rejected<T>(
  current: AsyncStatus<T> | undefined,
  error: AsyncError,
): AsyncStatus<T> {
  return { state: "error", error, previous: valueOf(current) };
}

/**
 * The value to render right now: the settled one, or the stale one still on
 * screen during a refresh or after a failure.
 */
export function valueOf<T>(status: AsyncStatus<T> | undefined): T | undefined {
  if (!status) return undefined;
  switch (status.state) {
    case "ready":
      return status.value;
    case "loading":
    case "error":
      return status.previous;
    case "idle":
      return undefined;
  }
}

export function isLoading<T>(status: AsyncStatus<T> | undefined): boolean {
  return status?.state === "loading";
}

/**
 * True when there is nothing to render yet — the case that warrants skeletons
 * rather than a dimmed stale list.
 */
export function isInitialLoad<T>(status: AsyncStatus<T> | undefined): boolean {
  return status?.state === "loading" && status.previous === undefined;
}

export function errorOf<T>(status: AsyncStatus<T> | undefined): AsyncError | undefined {
  return status?.state === "error" ? status.error : undefined;
}

/**
 * When the current load started, for the status bar to count up from.
 *
 * The bar is handed the start time rather than an elapsed duration on purpose:
 * a duration has to be recomputed on a timer, and a timer in a screen re-renders
 * the screen. Only the bar itself needs to tick.
 */
export function loadingSince<T>(status: AsyncStatus<T> | undefined): number | undefined {
  return status?.state === "loading" ? status.since : undefined;
}
