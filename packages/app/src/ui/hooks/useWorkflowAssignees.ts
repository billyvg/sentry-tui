import { useCallback, useMemo } from "react";

import type { SentryClient } from "~/api/client";
import { fetchTeamNames } from "~/api/teams";
import type { Workflow } from "~/api/workflows";
import { valueOf } from "~/core/async";
import { workflowAssigneeTargets, type WorkflowAssignees } from "~/core/workflows";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";
import { useOrganizationMembers } from "~/ui/hooks/useOrganizationMembers";

/** In-flight and resolved team batches, isolated to the authenticated client and org. */
const teamBatches = new WeakMap<SentryClient, Map<string, Promise<ReadonlyMap<string, string>>>>();

/** Share one team request per set of ids across repeated cards; evict failures for retry. */
function loadTeams(client: SentryClient, org: string, ids: string[]) {
  let batches = teamBatches.get(client);
  if (!batches) {
    batches = new Map();
    teamBatches.set(client, batches);
  }
  const key = JSON.stringify([org, ids]);
  const held = batches.get(key);
  if (held) return held;
  const request = fetchTeamNames(client, org, ids);
  batches.set(key, request);
  void request.catch(() => {
    if (batches.get(key) === request) batches.delete(key);
  });
  return request;
}

/** Reuse the member directory and batch team ids only when an alert needs them. */
export function useWorkflowAssignees(
  client: SentryClient | null,
  org: string,
  workflow: Workflow | undefined,
): WorkflowAssignees {
  const targets = useMemo(() => workflowAssigneeTargets(workflow), [workflow]);
  const members = useOrganizationMembers(client, org, targets.members.length > 0);
  const loader = useCallback(
    () => (client && org && targets.teams.length ? loadTeams(client, org, targets.teams) : null),
    [client, org, targets],
  );
  const scope = useMemo(() => ({ client, org, targets }), [client, org, targets]);
  const teams = useAsyncFetch(loader, { resetKey: scope });
  return {
    teams: valueOf(teams.status),
    members: new Map(
      [...(valueOf(members) ?? [])].map(([id, member]) => [
        id,
        member.user?.email || member.email || member.user?.name || member.name,
      ]),
    ),
  };
}
