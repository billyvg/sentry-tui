import { describe, expect, test } from "bun:test";

import type { Actor } from "~/api/types";
import {
  assigneeAvatarUrl,
  assigneeInitials,
  avatarsByUserId,
  customAvatarUrl,
} from "~/core/avatars";
import { membersFixture } from "./fixtures";

const [ada, grace, alan, invited] = membersFixture;

describe("customAvatarUrl", () => {
  test("an uploaded picture resolves to the avatar's own URL", () => {
    expect(customAvatarUrl(ada!.user)).toBe("https://sentry.io/avatar/aaaa1111/");
  });

  test("a Gravatar falls back to the account URL, which is where it lives", () => {
    expect(customAvatarUrl(grace!.user)).toBe("https://gravatar.com/avatar/grace?s=32&d=mm");
  });

  test("a generated letter avatar resolves to nothing, despite having a URL", () => {
    // The trap: `avatarUrl` is populated for every account, so only
    // `avatarType` distinguishes a real picture from a rendered placeholder.
    expect(alan!.user?.avatarUrl).toBeTruthy();
    expect(customAvatarUrl(alan!.user)).toBeUndefined();
  });

  test("an unaccepted invitation has no account to read", () => {
    expect(customAvatarUrl(invited!.user)).toBeUndefined();
  });
});

describe("avatarsByUserId", () => {
  test("indexes only the members with a picture, keyed by account id", () => {
    const avatars = avatarsByUserId(membersFixture);

    expect([...avatars.keys()].sort()).toEqual(["100", "101"]);
    expect(avatars.get("100")).toBe("https://sentry.io/avatar/aaaa1111/");
  });

  test("keys on the account id, not the membership id", () => {
    // The two are different numbers on the same row, and an issue's assignee
    // carries the account one — mixing them up would silently never match.
    const avatars = avatarsByUserId(membersFixture);
    expect(avatars.has(ada!.id)).toBe(false);
  });
});

describe("assigneeAvatarUrl", () => {
  const avatars = avatarsByUserId(membersFixture);
  const user = (id: string): Actor => ({ id, name: "Ada Lovelace", type: "user" });

  test("resolves a user assignee to their picture", () => {
    expect(assigneeAvatarUrl(user("100"), avatars)).toBe("https://sentry.io/avatar/aaaa1111/");
  });

  test("a user without a picture resolves to nothing", () => {
    expect(assigneeAvatarUrl(user("102"), avatars)).toBeUndefined();
  });

  test("a team keeps its initials — an avatar would stand in for a group", () => {
    const team: Actor = { id: "100", name: "Backend", type: "team" };
    expect(assigneeAvatarUrl(team, avatars)).toBeUndefined();
  });

  test("an unassigned issue resolves to nothing", () => {
    expect(assigneeAvatarUrl(null, avatars)).toBeUndefined();
    expect(assigneeAvatarUrl(undefined, avatars)).toBeUndefined();
  });
});

describe("assigneeInitials", () => {
  const actor = (name: string): Actor => ({ id: "1", name, type: "user" });

  test("takes the first letter of the first two name parts", () => {
    expect(assigneeInitials(actor("Ada Lovelace"))).toBe("AL");
  });

  test("splits the separators Sentry names actually arrive with", () => {
    expect(assigneeInitials(actor("ada.lovelace"))).toBe("AL");
    expect(assigneeInitials(actor("ada-lovelace"))).toBe("AL");
    expect(assigneeInitials(actor("ada_lovelace"))).toBe("AL");
    expect(assigneeInitials(actor("ada@example.com"))).toBe("AE");
  });

  test("a one-word name yields one letter, not a padded pair", () => {
    expect(assigneeInitials(actor("ada"))).toBe("A");
  });

  test("nobody assigned, or a name made only of separators, shows the dot", () => {
    expect(assigneeInitials(null)).toBe("·");
    expect(assigneeInitials(actor(""))).toBe("·");
    expect(assigneeInitials(actor("  "))).toBe("·");
  });
});
