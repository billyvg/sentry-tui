import type { SeerCodeMode, SeerRunId } from "~/api/seer";
import { parseSentryUrl, type SentryUrlLocation } from "~/core/sentryUrl";

export const APP_SESSION_SNAPSHOT_KIND = "sentry-tui.session";
export const APP_SESSION_SNAPSHOT_VERSION = 1;

/** Durable state for one screen slice. Fetched rows and transient UI stay out. */
export interface ScreenSessionSnapshot {
  /** Screen or pushed view whose cursor this slice belongs to. */
  source: string | null;
  selected: number;
  query: string;
  sort: string;
  statsPeriod: string;
  selectedProjects: string[];
  selectedEnvs: string[];
  detailOpen: boolean;
}

/** Serializable navigation and screen state owned by the app payload. */
export interface NavigationSessionSnapshot {
  /** Canonical production URL for the location currently on screen. */
  location: string;
  /** Canonical URLs for pushed views, from bottom to top. */
  viewStack: string[];
  screens: Record<string, ScreenSessionSnapshot>;
}

/** Version 1 of the replaceable app payload's in-memory session contract. */
export interface AppSessionSnapshot {
  kind: typeof APP_SESSION_SNAPSHOT_KIND;
  version: typeof APP_SESSION_SNAPSHOT_VERSION;
  org: string;
  navigation: NavigationSessionSnapshot;
  projectsByOrg: Record<string, string[]>;
  seerCodeModeByOrg: Record<string, SeerCodeMode>;
  seerBashModeByOrg: Record<string, boolean>;
  seerShowThinkingByOrg: Record<string, boolean>;
  /** Enough to refetch a transcript without serializing its response bodies. */
  seerRunId?: SeerRunId;
}

/** Validated session plus its parsed canonical navigation locations. */
export interface RestoredAppSession {
  snapshot: AppSessionSnapshot;
  location: SentryUrlLocation;
  viewStack: SentryUrlLocation[];
}

/** Add the current schema identity to an app-owned session payload. */
export function createAppSessionSnapshot(
  value: Omit<AppSessionSnapshot, "kind" | "version">,
): AppSessionSnapshot {
  return {
    kind: APP_SESSION_SNAPSHOT_KIND,
    version: APP_SESSION_SNAPSHOT_VERSION,
    ...value,
  };
}

/**
 * Validate and migrate a runtime-host snapshot for this payload version.
 *
 * The version switch is the migration boundary for future schemas. Unknown or
 * malformed input is intentionally ignored so a new payload always has a clean
 * cold-start fallback.
 */
export function restoreAppSessionSnapshot(value: unknown): RestoredAppSession | undefined {
  if (!isRecord(value) || value.kind !== APP_SESSION_SNAPSHOT_KIND) return undefined;
  switch (value.version) {
    case APP_SESSION_SNAPSHOT_VERSION:
      return restoreV1(value);
    default:
      return undefined;
  }
}

function restoreV1(value: Record<string, unknown>): RestoredAppSession | undefined {
  const org = nonEmptyString(value.org);
  const navigation = navigationSnapshot(value.navigation);
  const projectsByOrg = stringArrayRecord(value.projectsByOrg);
  const seerCodeModeByOrg = codeModeRecord(value.seerCodeModeByOrg);
  const seerBashModeByOrg = booleanRecord(value.seerBashModeByOrg);
  const seerShowThinkingByOrg = booleanRecord(value.seerShowThinkingByOrg);
  const seerRunId = runId(value.seerRunId);
  if (
    !org ||
    !navigation ||
    !projectsByOrg ||
    !seerCodeModeByOrg ||
    !seerBashModeByOrg ||
    !seerShowThinkingByOrg ||
    seerRunId === null
  ) {
    return undefined;
  }

  const location = parsedLocation(navigation.location, org);
  if (!location) return undefined;
  const viewStack: SentryUrlLocation[] = [];
  for (const url of navigation.viewStack) {
    const view = parsedLocation(url, org);
    if (!view?.detail) return undefined;
    viewStack.push(view);
  }

  const snapshot: AppSessionSnapshot = {
    kind: APP_SESSION_SNAPSHOT_KIND,
    version: APP_SESSION_SNAPSHOT_VERSION,
    org,
    navigation,
    projectsByOrg,
    seerCodeModeByOrg,
    seerBashModeByOrg,
    seerShowThinkingByOrg,
    ...(seerRunId === undefined ? {} : { seerRunId }),
  };
  return { snapshot, location, viewStack };
}

function navigationSnapshot(value: unknown): NavigationSessionSnapshot | undefined {
  if (!isRecord(value) || typeof value.location !== "string") return undefined;
  if (
    !Array.isArray(value.viewStack) ||
    value.viewStack.length > 32 ||
    !value.viewStack.every((url) => typeof url === "string")
  ) {
    return undefined;
  }
  const screens = screenSnapshotRecord(value.screens);
  if (!screens) return undefined;
  return { location: value.location, viewStack: [...value.viewStack], screens };
}

function screenSnapshotRecord(value: unknown): Record<string, ScreenSessionSnapshot> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 256) return undefined;
  const screens: Record<string, ScreenSessionSnapshot> = Object.create(null);
  for (const [key, raw] of entries) {
    const screen = screenSnapshot(raw);
    if (!key || !screen) return undefined;
    screens[key] = screen;
  }
  return screens;
}

function screenSnapshot(value: unknown): ScreenSessionSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const source = value.source === null ? null : nonEmptyString(value.source);
  const selected = value.selected;
  const selectedProjects = stringArray(value.selectedProjects);
  const selectedEnvs = stringArray(value.selectedEnvs);
  if (
    (source === undefined && value.source !== null) ||
    !Number.isSafeInteger(selected) ||
    (selected as number) < 0 ||
    typeof value.query !== "string" ||
    typeof value.sort !== "string" ||
    typeof value.statsPeriod !== "string" ||
    !selectedProjects ||
    !selectedEnvs ||
    typeof value.detailOpen !== "boolean"
  ) {
    return undefined;
  }
  return {
    source: source ?? null,
    selected: selected as number,
    query: value.query,
    sort: value.sort,
    statsPeriod: value.statsPeriod,
    selectedProjects,
    selectedEnvs,
    detailOpen: value.detailOpen,
  };
}

function parsedLocation(url: string, org: string): SentryUrlLocation | undefined {
  const result = parseSentryUrl(url);
  return result.kind === "location" && result.location.org === org ? result.location : undefined;
}

function stringArrayRecord(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string[]> = Object.create(null);
  for (const [key, raw] of Object.entries(value)) {
    const values = stringArray(raw);
    if (!key || !values) return undefined;
    result[key] = values;
  }
  return result;
}

function booleanRecord(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, boolean> = Object.create(null);
  for (const [key, raw] of Object.entries(value)) {
    if (!key || typeof raw !== "boolean") return undefined;
    result[key] = raw;
  }
  return result;
}

function codeModeRecord(value: unknown): Record<string, SeerCodeMode> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, SeerCodeMode> = Object.create(null);
  for (const [key, raw] of Object.entries(value)) {
    if (!key || (raw !== "off" && raw !== "on" && raw !== "only")) return undefined;
    result[key] = raw;
  }
  return result;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function runId(value: unknown): SeerRunId | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
