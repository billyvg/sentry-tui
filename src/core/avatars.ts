import type { Actor, OrgMember, OrgUser } from "~/api/types";

/**
 * Avatar types that mean the user chose a picture.
 *
 * `letter_avatar` and `default` are drawn by Sentry from the account's
 * initials, so rendering them in a two-cell terminal image would be a blurry
 * copy of the initials we already print — worse than the text it replaced.
 */
const CUSTOM_AVATAR_TYPES: ReadonlySet<string> = new Set(["upload", "gravatar"]);

/**
 * The image URL for a user's own avatar, or undefined when Sentry would only
 * generate one from their initials.
 *
 * An upload carries its URL on the avatar itself; a Gravatar is only reachable
 * through the account's `avatarUrl`, which is populated either way and so
 * cannot be used on its own to tell the two cases apart.
 */
export function customAvatarUrl(user: OrgUser | null | undefined): string | undefined {
  if (!user?.avatar || !CUSTOM_AVATAR_TYPES.has(user.avatar.avatarType)) return undefined;
  return user.avatar.avatarUrl ?? user.avatarUrl ?? undefined;
}

/**
 * Index members by account id so an issue's `assignedTo` actor can be resolved
 * to an avatar. Members without a custom avatar are left out entirely — a
 * miss and "has no picture" are the same answer to the caller.
 */
export function avatarsByUserId(members: readonly OrgMember[]): ReadonlyMap<string, string> {
  const byId = new Map<string, string>();
  for (const member of members) {
    const url = customAvatarUrl(member.user);
    if (url && member.user) byId.set(member.user.id, url);
  }
  return byId;
}

/**
 * Look up an assignee's avatar. Only user assignees resolve: a team's avatar
 * would stand in for a group of people, so teams keep their initials.
 */
export function assigneeAvatarUrl(
  assignee: Actor | null | undefined,
  avatars: ReadonlyMap<string, string>,
): string | undefined {
  if (assignee?.type !== "user") return undefined;
  return avatars.get(assignee.id);
}

/** Placeholder for the assignee cell when nobody is assigned. */
export const UNASSIGNED_GLYPH = "·";

/**
 * Up to two initials for an assignee, as the web app's letter avatar shows.
 *
 * Names arrive in every shape Sentry accepts — "Ada Lovelace", "ada.lovelace",
 * "ada@example.com" — so the split covers the separators all of them use.
 */
export function assigneeInitials(assignee: Actor | null | undefined): string {
  const name = assignee?.name;
  if (!name) return UNASSIGNED_GLYPH;
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]!.toUpperCase());
  return letters.join("") || UNASSIGNED_GLYPH;
}
