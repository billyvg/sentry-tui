import type { SentryClient } from "~/api/client";

/** Resolve only the teams referenced by a workflow, following any result pages. */
export async function fetchTeamNames(
  client: SentryClient,
  org: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  let cursor: string | undefined;
  do {
    const page = await client.request<unknown>(`/organizations/${org}/teams/`, {
      query: { query: ids.map((id) => `id:${id}`).join(" "), per_page: 100, cursor },
    });
    if (Array.isArray(page.data)) {
      for (const team of page.data) {
        if (
          team &&
          typeof team === "object" &&
          (typeof team.id === "string" || typeof team.id === "number") &&
          typeof team.slug === "string" &&
          team.slug
        ) {
          names.set(String(team.id), team.slug);
        }
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return names;
}
