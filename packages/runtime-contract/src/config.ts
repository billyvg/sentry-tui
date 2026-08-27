/** Preferences persisted by the runtime host. Never holds credentials. */
export interface StoredConfig {
  org?: string;
  projectsByOrg?: Record<string, string[]>;
  seerCodeModeByOrg?: Record<string, "off" | "on" | "only">;
  seerBashModeByOrg?: Record<string, boolean>;
  seerShowThinkingByOrg?: Record<string, boolean>;
  /** Read only during migration from releases that stored the token here. */
  token?: string;
}

/** Whatever proves the app may talk to Sentry, however it was obtained. */
export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes?: string[];
  clientId?: string;
  siteUrl?: string;
  user?: { id?: string; name?: string; email?: string };
}

/** Host-owned persistence available to a replaceable app payload. */
export interface ConfigService {
  readConfig(): Promise<StoredConfig>;
  writeConfig(updates: Partial<StoredConfig>): Promise<void>;
  flushConfigWrites(): Promise<void>;
  readCredentials(): Promise<StoredCredentials | null>;
  writeCredentials(credentials: StoredCredentials): Promise<void>;
  clearCredentials(): Promise<boolean>;
}

const inertConfigService: ConfigService = {
  readConfig: async () => ({}),
  writeConfig: async () => {},
  flushConfigWrites: async () => {},
  readCredentials: async () => null,
  writeCredentials: async () => {},
  clearCredentials: async () => false,
};

let service = inertConfigService;

/** Bind the host implementation before the app payload is rendered. */
export function installConfigService(implementation: ConfigService): void {
  service = implementation;
}

/** Read the user's non-secret preferences through the active runtime. */
export function readConfig(): Promise<StoredConfig> {
  return service.readConfig();
}

/** Persist non-secret preference updates through the active runtime. */
export function writeConfig(updates: Partial<StoredConfig>): Promise<void> {
  return service.writeConfig(updates);
}

/** Wait for all preference writes scheduled through the active runtime. */
export function flushConfigWrites(): Promise<void> {
  return service.flushConfigWrites();
}

/** Read credentials through the active runtime. */
export function readCredentials(): Promise<StoredCredentials | null> {
  return service.readCredentials();
}

/** Persist credentials through the active runtime. */
export function writeCredentials(credentials: StoredCredentials): Promise<void> {
  return service.writeCredentials(credentials);
}

/** Remove credentials through the active runtime. */
export function clearCredentials(): Promise<boolean> {
  return service.clearCredentials();
}
