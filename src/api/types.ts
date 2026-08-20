/**
 * Sentry domain types.
 *
 * Derived from `sentry/static/app/types/{group,event,stacktrace,core}.tsx`,
 * pruned to what the TUI renders. The originals reach into React component
 * modules for context interfaces, so they can't be vendored wholesale.
 */

export type Level =
  | "error"
  | "fatal"
  | "info"
  | "warning"
  | "sample"
  | "unknown";

export const GroupStatus = {
  RESOLVED: "resolved",
  UNRESOLVED: "unresolved",
  IGNORED: "ignored",
  REPROCESSING: "reprocessing",
} as const;
export type GroupStatus = (typeof GroupStatus)[keyof typeof GroupStatus];

export const GroupSubstatus = {
  ARCHIVED_UNTIL_ESCALATING: "archived_until_escalating",
  ARCHIVED_UNTIL_CONDITION_MET: "archived_until_condition_met",
  ARCHIVED_FOREVER: "archived_forever",
  ESCALATING: "escalating",
  ONGOING: "ongoing",
  REGRESSED: "regressed",
  NEW: "new",
} as const;
export type GroupSubstatus =
  (typeof GroupSubstatus)[keyof typeof GroupSubstatus];

export const PriorityLevel = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;
export type PriorityLevel = (typeof PriorityLevel)[keyof typeof PriorityLevel];

export interface Actor {
  id: string;
  name: string;
  type: "user" | "team";
  email?: string;
}

export interface AvatarProject {
  id: string;
  slug: string;
  name?: string;
  platform?: string;
}

/** `[unixSeconds, count]`, as returned in `group.stats`. */
export type TimeseriesValue = [number, number];

export interface Group {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: Level;
  status: GroupStatus;
  substatus: GroupSubstatus | null;
  priority?: PriorityLevel;
  /** Event count as a string — Sentry returns these stringified. */
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  project: AvatarProject;
  isBookmarked: boolean;
  isSubscribed: boolean;
  hasSeen: boolean;
  isUnhandled?: boolean;
  numComments: number;
  logger: string | null;
  platform?: string;
  metadata?: { type?: string; value?: string; filename?: string };
  assignedTo?: Actor | null;
  /** Keyed by stats period (`24h`, `14d`); absent when `collapse=stats`. */
  stats?: Record<string, TimeseriesValue[]>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const EntryType = {
  EXCEPTION: "exception",
  MESSAGE: "message",
  REQUEST: "request",
  STACKTRACE: "stacktrace",
  TEMPLATE: "template",
  CSP: "csp",
  BREADCRUMBS: "breadcrumbs",
  THREADS: "threads",
  DEBUGMETA: "debugmeta",
  SPANS: "spans",
} as const;
export type EntryType = (typeof EntryType)[keyof typeof EntryType];

export interface Frame {
  filename: string | null;
  absPath: string | null;
  module: string | null;
  package: string | null;
  function: string | null;
  rawFunction: string | null;
  symbol: string | null;
  lineNo: number | null;
  colNo: number | null;
  inApp: boolean;
  platform: string | null;
  /** Source context as `[lineNumber, sourceText]` pairs. */
  context: Array<[number, string | null]>;
  vars: Record<string, unknown> | null;
  instructionAddr?: string | null;
  symbolAddr?: string | null;
  trust?: unknown;
}

export interface StacktraceType {
  frames?: Frame[];
  /** Inclusive `[start, end]` range of frames the server dropped. */
  framesOmitted: [number, number] | null;
  hasSystemFrames: boolean;
  registers: Record<string, string | null> | null;
}

export interface StackTraceMechanism {
  type: string;
  handled: boolean;
  description?: string;
  synthetic?: boolean;
}

export interface ExceptionValue {
  type: string | null;
  value: string | null;
  module: string | null;
  threadId: number | null;
  mechanism: StackTraceMechanism | null;
  stacktrace: StacktraceType | null;
  rawStacktrace: StacktraceType | null;
}

export interface ExceptionType {
  values?: ExceptionValue[];
  excOmitted: unknown | null;
  hasSystemFrames: boolean;
}

export interface Thread {
  id: number;
  crashed: boolean;
  current: boolean;
  name?: string | null;
  state?: string | null;
  stacktrace: StacktraceType | null;
  rawStacktrace: StacktraceType | null;
}

export interface Breadcrumb {
  type: string;
  level: string;
  category?: string | null;
  message?: string | null;
  timestamp?: string | null;
  data?: Record<string, unknown> | null;
}

export interface RequestEntryData {
  url: string | null;
  method: string | null;
  query?: Array<[string, string]> | null;
  headers?: Array<[string, string]> | null;
  cookies?: Array<[string, string]> | null;
  data?: unknown;
  fragment?: string | null;
}

export type Entry =
  | { type: "exception"; data: ExceptionType }
  | { type: "stacktrace"; data: StacktraceType }
  | { type: "threads"; data: { values?: Thread[] } }
  | { type: "breadcrumbs"; data: { values: Breadcrumb[] } }
  | { type: "request"; data: RequestEntryData }
  | { type: "message"; data: { formatted: string } }
  | { type: string; data: unknown };

export interface EventTag {
  key: string;
  value: string;
}

export interface SentryEvent {
  id: string;
  eventID: string;
  groupID?: string | null;
  projectID?: string;
  title: string;
  message: string;
  culprit: string | null;
  location?: string | null;
  platform?: string | null;
  type: string;
  size?: number;
  dateCreated?: string | null;
  dateReceived?: string;
  tags: EventTag[];
  contexts: Record<string, Record<string, unknown>>;
  packages?: Record<string, string> | null;
  sdk?: { name: string; version: string } | null;
  user?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  entries: Entry[];
  nextEventID?: string | null;
  previousEventID?: string | null;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  platform?: string | null;
}

/** Narrow an entry union member by type, preserving its data shape. */
export function findEntry<T extends Entry["type"]>(
  entries: Entry[],
  type: T,
): Extract<Entry, { type: T }> | undefined {
  return entries.find((e) => e.type === type) as
    | Extract<Entry, { type: T }>
    | undefined;
}
