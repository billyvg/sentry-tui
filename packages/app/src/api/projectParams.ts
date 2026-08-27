/** Sentry's sentinel for every project the caller can access. */
const ALL_PROJECTS = "-1";

/**
 * Turn the UI's empty project selection into an organization-wide API scope.
 *
 * Omitting `project` does not mean every accessible project: Sentry falls back
 * to projects the user explicitly belongs to, which can be none even when an
 * organization role grants access. The web sends `-1` for the "all projects"
 * selection, and every project-scoped request in the TUI must do the same.
 */
export function projectParams(projects?: readonly string[]): string[] {
  return projects && projects.length > 0 ? [...projects] : [ALL_PROJECTS];
}
