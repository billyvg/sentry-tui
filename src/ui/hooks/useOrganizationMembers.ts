import { useCallback, useMemo } from "react";

import type { SentryClient } from "~/api/client";
import { listOrganizationMembers } from "~/api/issues";
import type { OrgMember } from "~/api/types";
import type { AsyncStatus } from "~/core/async";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";

export type OrganizationMemberDirectory = ReadonlyMap<string, OrgMember>;

/** Resolved and in-flight member directories, scoped to one authenticated session. */
const directories = new WeakMap<SentryClient, Map<string, Promise<OrganizationMemberDirectory>>>();

/**
 * Load an organization's members once, sharing the result with every caller.
 *
 * The request deliberately outlives any one component: an issue list may
 * unmount while a monitor detail still needs the same directory. Failed
 * requests are evicted so a later mount can retry.
 */
function loadOrganizationMembers(
  client: SentryClient,
  org: string,
): Promise<OrganizationMemberDirectory> {
  let byOrg = directories.get(client);
  if (!byOrg) {
    byOrg = new Map();
    directories.set(client, byOrg);
  }

  const held = byOrg.get(org);
  if (held) return held;

  const request = listOrganizationMembers(client, { org }).then(
    (members) =>
      new Map(
        members.flatMap((member): Array<readonly [string, OrgMember]> =>
          member.user ? [[member.user.id, member]] : [],
        ),
      ),
  );
  byOrg.set(org, request);
  void request.catch(() => {
    if (byOrg.get(org) === request) byOrg.delete(org);
  });
  return request;
}

/**
 * Organization members keyed by account id, cached for the authenticated session.
 *
 * Account ids are the identifiers carried by assignees and detector
 * `createdBy` fields; membership ids are intentionally not indexed.
 */
export function useOrganizationMembers(
  client: SentryClient | null,
  org: string,
  enabled = true,
): AsyncStatus<OrganizationMemberDirectory> {
  const loader = useCallback(
    (_signal: AbortSignal) =>
      client && org && enabled ? loadOrganizationMembers(client, org) : null,
    [client, org, enabled],
  );
  const scope = useMemo(() => ({ client, org, enabled }), [client, org, enabled]);
  return useAsyncFetch(loader, { resetKey: scope }).status;
}
