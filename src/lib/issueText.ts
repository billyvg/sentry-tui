/**
 * Title / message extraction, ported from `utils/events.tsx`'s `getTitle` and
 * `getMessage`.
 *
 * Sentry's stream renders an issue as two lines: a short type on top and the
 * long message beneath it. The API's `title` is the two concatenated
 * (`compute_title` in `eventtypes/error.py` builds `"{type}: {value}"`), so
 * splitting them back apart means reading `metadata`, not the title string.
 *
 * Declared structurally rather than importing `~/api/types` so this stays a
 * dependency-free leaf module.
 */
export interface IssueTextLike {
  title: string;
  culprit?: string | null;
  metadata?: {
    type?: string;
    value?: string;
    function?: string;
    filename?: string;
  };
}

/**
 * The bold first line: the exception type.
 *
 * `getTitle` prefers `metadata.type`, then `metadata.function`. When neither is
 * present the issue isn't an error (a performance issue, say) and its `title`
 * is already the short form — use it whole rather than guessing at a delimiter.
 */
export function issueTitle(group: IssueTextLike): string {
  return group.metadata?.type || group.metadata?.function || group.title;
}

/**
 * The second line: the exception value, falling back to the culprit the way
 * `getMessage`'s default branch does.
 */
export function issueMessage(group: IssueTextLike): string {
  const value = group.metadata?.value;
  if (value) return collapseWhitespace(value);
  // Only fall back to the culprit when it isn't already the title, or the row
  // would print the same string twice.
  const culprit = group.culprit ?? "";
  return culprit === issueTitle(group) ? "" : collapseWhitespace(culprit);
}

/** Multi-line exception values would break the single-line row. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
