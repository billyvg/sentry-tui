import { useCallback, useRef, useState } from "react";

import { ApiError, type SentryClient } from "~/api/client";
import { updateIssue } from "~/api/issues";
import type { Group } from "~/api/types";
import { applyUpdate, findTriageAction, noOpNotice } from "~/core/triage";

export interface TriageResult {
  /** Issue ids with a PUT currently in flight, for the ⟳ row marker. */
  pending: ReadonlySet<string>;
  /** Run the action bound to a command id against an issue. */
  run: (commandId: string, group: Group) => void;
}

export interface TriageCallbacks {
  /** Replace an issue in the list — used for both the optimistic write and rollback. */
  onOptimistic: (group: Group) => void;
  onNotice: (notice: { kind: "success" | "error" | "warning"; text: string }) => void;
}

/**
 * Mutations applied optimistically, rolled back on failure.
 *
 * The row updates immediately because waiting on a slow API to redraw a
 * checkbox is what makes a triage tool feel broken. The original is kept so a
 * failure restores exactly what was there, rather than a refetch guess.
 */
export function useTriage(
  client: SentryClient | null,
  org: string,
  { onOptimistic, onNotice }: TriageCallbacks,
): TriageResult {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  // Keyed by issue id so a second action on the same row supersedes the first.
  const controllers = useRef(new Map<string, AbortController>());

  const run = useCallback(
    (commandId: string, group: Group) => {
      const action = findTriageAction(commandId);
      if (!action || !client) return;

      const update = action.update(group);
      if (!update) {
        onNotice({ kind: "warning", text: noOpNotice(commandId) });
        return;
      }

      const original = group;
      const optimistic = applyUpdate(group, update);
      onOptimistic(optimistic);

      controllers.current.get(group.id)?.abort();
      const controller = new AbortController();
      controllers.current.set(group.id, controller);

      setPending((current) => new Set(current).add(group.id));
      const settle = () =>
        setPending((current) => {
          const next = new Set(current);
          next.delete(group.id);
          return next;
        });

      void (async () => {
        try {
          const confirmed = await updateIssue(client, {
            org,
            issueId: group.id,
            update,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          // Trust the server's version over the optimistic one.
          onOptimistic({ ...optimistic, ...confirmed });
          onNotice({
            kind: "success",
            text: `${action.pastTense} ${group.shortId}`,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          onOptimistic(original); // roll back
          onNotice({
            kind: "error",
            text: `failed: ${error instanceof ApiError ? error.message : String(error)}`,
          });
        } finally {
          if (!controller.signal.aborted) {
            controllers.current.delete(group.id);
            settle();
          }
        }
      })();
    },
    [client, org, onOptimistic, onNotice],
  );

  return { pending, run };
}
