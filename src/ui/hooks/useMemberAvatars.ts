import { useEffect, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listOrganizationMembers } from "~/api/issues";
import { avatarsByUserId } from "~/core/avatars";
import { useImageSupport } from "~/ui/hooks/useImageSupport";

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * Custom avatar URLs for the organization's members, keyed by account id.
 *
 * The member list is a whole extra round trip that only pays for itself if
 * the terminal can actually draw a picture, so it is fetched lazily: nothing
 * is requested until a hi-res protocol is confirmed and something on screen
 * is assigned. A failure resolves to an empty map — the rows fall back to
 * initials, which is what they showed before the request existed.
 *
 * @param enabled Whether any visible row has a user assignee.
 */
export function useMemberAvatars(
  client: SentryClient | null,
  org: string,
  enabled: boolean,
): ReadonlyMap<string, string> {
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(EMPTY);
  const { supportsHighRes } = useImageSupport();
  const wanted = enabled && supportsHighRes;

  useEffect(() => {
    if (!client || !org || !wanted) return;
    const controller = new AbortController();

    void listOrganizationMembers(client, { org, signal: controller.signal })
      .then((members) => {
        if (!controller.signal.aborted) setAvatars(avatarsByUserId(members));
      })
      .catch(() => {});

    return () => controller.abort();
  }, [client, org, wanted]);

  return avatars;
}
