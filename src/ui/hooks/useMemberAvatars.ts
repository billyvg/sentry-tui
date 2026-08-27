import { useMemo } from "react";

import type { SentryClient } from "~/api/client";
import { avatarsByUserId } from "~/core/avatars";
import { valueOf } from "~/core/async";
import { useImageSupport } from "~/ui/hooks/useImageSupport";
import { useOrganizationMembers } from "~/ui/hooks/useOrganizationMembers";

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * Custom avatar URLs for the organization's members, keyed by account id.
 *
 * The member list is a whole extra round trip that only pays for itself if
 * the terminal can actually draw a picture, so it is fetched lazily: nothing
 * is requested until a hi-res protocol is confirmed and something on screen
 * is assigned. The organization-wide directory is shared with other screens;
 * a failure resolves to an empty map and rows fall back to initials.
 *
 * @param enabled Whether any visible row has a user assignee.
 */
export function useMemberAvatars(
  client: SentryClient | null,
  org: string,
  enabled: boolean,
): ReadonlyMap<string, string> {
  const { supportsHighRes } = useImageSupport();
  const wanted = enabled && supportsHighRes;
  const status = useOrganizationMembers(client, org, wanted);
  const members = valueOf(status);

  return useMemo(() => (members ? avatarsByUserId([...members.values()]) : EMPTY), [members]);
}
