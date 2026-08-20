import { useCallback, useEffect, useMemo, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listOrganizations } from "~/api/issues";
import type { Organization } from "~/api/types";
import { Dropdown, type DropdownItem } from "~/ui/components/Dropdown";

export interface OrgPickerProps {
  client: SentryClient | null;
  /** Slug of the organization currently open — marked as the active row. */
  currentOrg: string;
  /** Column the list drops from, relative to the terminal. */
  anchorLeft: number;
  /** Row the list drops from, relative to the terminal. */
  anchorTop: number;
  /** Chosen slug. Fires for the current org too; the caller decides to no-op. */
  onSelect: (slug: string) => void;
  onClose: () => void;
}

/**
 * Name an organization the way the first-run CLI prompt does, so the same org
 * reads the same whichever surface offered it.
 */
function orgLabel(org: Organization): string {
  return org.name && org.name !== org.slug ? `${org.name} (${org.slug})` : org.slug;
}

/**
 * The organization switcher, hanging off the org header in the nav rail.
 *
 * The list is fetched on open rather than at startup: switching orgs is rare,
 * and a request nobody asked for is a request that can fail silently in the
 * background.
 */
export function OrgPicker({
  client,
  currentOrg,
  anchorLeft,
  anchorTop,
  onSelect,
  onClose,
}: OrgPickerProps) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(client !== null);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setLoading(true);
    listOrganizations(client, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setOrgs(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client]);

  const items: DropdownItem[] = useMemo(
    () => orgs.map((org) => ({ label: orgLabel(org), value: org.slug })),
    [orgs],
  );

  const handleSelect = useCallback(
    (values: string[]) => {
      const slug = values[0];
      if (slug) onSelect(slug);
    },
    [onSelect],
  );

  return (
    <Dropdown
      title="Organization"
      items={items}
      selected={currentOrg ? [currentOrg] : []}
      anchorLeft={anchorLeft}
      anchorTop={anchorTop}
      // Every view is scoped to exactly one org, so "all" is not a thing you
      // can be looking at.
      showAll={false}
      placeholder={loading ? "Loading organizations…" : (error ?? "No organizations")}
      onSelect={handleSelect}
      onClose={onClose}
    />
  );
}
