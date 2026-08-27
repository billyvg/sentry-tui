import type { IssueUpdate } from "~/api/issues";
import { GroupStatus, GroupSubstatus, type Group } from "~/api/types";

/**
 * Triage actions, as data.
 *
 * Each action derives its request body and its optimistic local effect from
 * the same declaration, so the row can never show a state the PUT wouldn't
 * produce. Deletion is deliberately absent — every action here is reversible.
 */
export interface TriageAction {
  /** Command id from the catalog, so keys and help stay in sync. */
  commandId: string;
  /** Past-tense label for the confirmation notice. Lower case, like every notice. */
  pastTense: string;
  /** The PUT body. Returns null when the action doesn't apply to this issue. */
  update: (group: Group) => IssueUpdate | null;
}

/** Apply an update to a group locally, mirroring what the server will do. */
export function applyUpdate(group: Group, update: IssueUpdate): Group {
  const next: Group = { ...group };
  if (update.status !== undefined) next.status = update.status;
  if (update.substatus !== undefined) next.substatus = update.substatus;
  if (update.isBookmarked !== undefined) next.isBookmarked = update.isBookmarked;
  if (update.isSubscribed !== undefined) next.isSubscribed = update.isSubscribed;
  if (update.hasSeen !== undefined) next.hasSeen = update.hasSeen;
  if (update.priority !== undefined) next.priority = update.priority;
  if (update.inbox === false) next.hasSeen = true;
  return next;
}

export const TRIAGE_ACTIONS: readonly TriageAction[] = [
  {
    commandId: "sentry.issue.resolve",
    pastTense: "resolved",
    update: (group) =>
      group.status === GroupStatus.RESOLVED ? null : { status: GroupStatus.RESOLVED },
  },
  {
    commandId: "sentry.issue.archive",
    pastTense: "archived",
    // Archiving an already-archived issue un-archives it, matching the web
    // app's toggle.
    update: (group) =>
      group.status === GroupStatus.IGNORED
        ? { status: GroupStatus.UNRESOLVED }
        : {
            status: GroupStatus.IGNORED,
            substatus: GroupSubstatus.ARCHIVED_UNTIL_ESCALATING,
          },
  },
  {
    commandId: "sentry.issue.unresolve",
    pastTense: "unresolved",
    update: (group) =>
      group.status === GroupStatus.UNRESOLVED ? null : { status: GroupStatus.UNRESOLVED },
  },
  {
    commandId: "sentry.issue.bookmark",
    pastTense: "bookmarked",
    update: (group) => ({ isBookmarked: !group.isBookmarked }),
  },
  {
    commandId: "sentry.issue.markReviewed",
    pastTense: "marked reviewed",
    update: (group) => (group.hasSeen ? null : { inbox: false, hasSeen: true }),
  },
];

export function findTriageAction(commandId: string): TriageAction | undefined {
  return TRIAGE_ACTIONS.find((action) => action.commandId === commandId);
}

/** Notice text for an action that changed nothing. Lower case, like every notice. */
export function noOpNotice(commandId: string): string {
  switch (commandId) {
    case "sentry.issue.resolve":
      return "already resolved";
    case "sentry.issue.unresolve":
      return "already unresolved";
    case "sentry.issue.markReviewed":
      return "already reviewed";
    default:
      return "nothing to do";
  }
}
