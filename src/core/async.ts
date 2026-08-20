/**
 * Async state as data, keyed by entity.
 *
 * Component-local `isLoading` booleans can't survive a remount and can't be
 * read by the status bar, so every in-flight request lives here instead. The
 * `previous` field is what makes refreshes non-destructive: a reload keeps the
 * old value on screen (dimmed) rather than flashing back to skeletons.
 */

import { ApiError } from "~/api/client";

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
 */
export function toAsyncError(error: unknown): AsyncError {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
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

/** How long the current load has been running, for the status bar. */
export function elapsedMs<T>(status: AsyncStatus<T> | undefined, now: number): number | undefined {
  return status?.state === "loading" ? now - status.since : undefined;
}
