/** A low-cardinality telemetry name: `<namespace>.<subject>.<event>`. */
export type TelemetryName = `${string}.${string}.${string}`;

export type TelemetryAttributes = Record<string, string | number | boolean | undefined>;

export interface ReportContext {
  source?: TelemetryName;
  handled?: boolean;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface Crumb {
  category: "navigation" | "http" | "ui" | "auth";
  message: string;
  level?: "info" | "warning" | "error";
  data?: Record<string, unknown>;
}

export interface RequestSpec {
  method: string;
  path: string;
  query?: string | undefined;
}

export interface RequestOutcome {
  status: number;
  retries: number;
  cancelled?: boolean | undefined;
}

export type FinishRequest = (outcome: RequestOutcome) => void;

/** Host-owned observability available to a replaceable app payload. */
export interface TelemetryService {
  isTelemetryEnabled(): boolean;
  identify(who: {
    user?: { id?: string; name?: string; email?: string } | undefined;
    org?: string | undefined;
  }): void;
  reportError(error: unknown, context?: ReportContext): void;
  breadcrumb(crumb: Crumb): void;
  log(
    level: "info" | "warn" | "error",
    name: TelemetryName,
    attributes?: TelemetryAttributes,
  ): void;
  countMetric(name: TelemetryName, attributes?: TelemetryAttributes): void;
  beginNavigation(name: string): void;
  endNavigation(name: string, settledAt?: number): void;
  abandonNavigation(name: string): void;
  beginRequest(spec: RequestSpec): FinishRequest;
}

const inertTelemetryService: TelemetryService = {
  isTelemetryEnabled: () => false,
  identify: () => {},
  reportError: () => {},
  breadcrumb: () => {},
  log: () => {},
  countMetric: () => {},
  beginNavigation: () => {},
  endNavigation: () => {},
  abandonNavigation: () => {},
  beginRequest: () => () => {},
};

let service = inertTelemetryService;

/** Bind the host implementation before the app payload is rendered. */
export function installTelemetryService(implementation: TelemetryService): void {
  service = implementation;
}

export function isTelemetryEnabled(): boolean {
  return service.isTelemetryEnabled();
}

export function identify(who: Parameters<TelemetryService["identify"]>[0]): void {
  service.identify(who);
}

export function reportError(error: unknown, context?: ReportContext): void {
  service.reportError(error, context);
}

export function breadcrumb(crumb: Crumb): void {
  service.breadcrumb(crumb);
}

export function log(
  level: "info" | "warn" | "error",
  name: TelemetryName,
  attributes?: TelemetryAttributes,
): void {
  service.log(level, name, attributes);
}

export function countMetric(name: TelemetryName, attributes?: TelemetryAttributes): void {
  service.countMetric(name, attributes);
}

export function beginNavigation(name: string): void {
  service.beginNavigation(name);
}

export function endNavigation(name: string, settledAt?: number): void {
  service.endNavigation(name, settledAt);
}

export function abandonNavigation(name: string): void {
  service.abandonNavigation(name);
}

export function beginRequest(spec: RequestSpec): FinishRequest {
  return service.beginRequest(spec);
}
