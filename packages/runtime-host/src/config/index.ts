import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  installConfigService,
  type StoredConfig,
  type StoredCredentials,
} from "@sentry-tui/runtime-contract/config";

export type { StoredConfig, StoredCredentials } from "@sentry-tui/runtime-contract/config";

/**
 * On-disk state lives in two files with different threat models:
 *
 *   config.json       preferences the app rewrites as you use it (org, …)
 *   credentials.json  secrets, written 0600 and never rewritten casually
 *
 * Keeping them apart means the file the app has to keep writable is not the
 * file holding a token.
 */
export function configDir(): string {
  const override = process.env["SENTRY_TUI_CONFIG_DIR"]?.trim();
  return override ? override : join(homedir(), ".config", "sentry-tui");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

/** Keep only well-formed org-to-project entries from user-editable config. */
export function normalizeProjectsByOrg(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: Record<string, string[]> = {};
  for (const [org, projects] of Object.entries(value)) {
    if (!Array.isArray(projects)) continue;
    normalized[org] = projects.filter((project): project is string => typeof project === "string");
  }
  return normalized;
}

/** Keep only valid per-organization Seer Code Mode choices from editable config. */
export function normalizeSeerCodeModeByOrg(value: unknown): Record<string, "off" | "on" | "only"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: Record<string, "off" | "on" | "only"> = {};
  for (const [org, mode] of Object.entries(value)) {
    if (mode === "off" || mode === "on" || mode === "only") normalized[org] = mode;
  }
  return normalized;
}

/** Keep only boolean per-organization preferences from editable config. */
export function normalizeBooleansByOrg(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: Record<string, boolean> = {};
  for (const [org, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") normalized[org] = enabled;
  }
  return normalized;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return (await file.json()) as T;
  } catch {
    // A corrupt file shouldn't be fatal — callers fall back to env vars.
    return null;
  }
}

function writeJson(path: string, value: unknown, mode?: number): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", mode === undefined ? {} : { mode });
  // writeFileSync only applies `mode` when it creates the file, so an existing
  // file keeps whatever permissions it had. Re-assert them every write.
  if (mode !== undefined) chmodSync(path, mode);
}

export async function readConfig(): Promise<StoredConfig> {
  return (await readJson<StoredConfig>(configPath())) ?? {};
}

let configWriteQueue: Promise<void> = Promise.resolve();

/**
 * Merge `updates` into the stored config and write it back.
 * Creates the config directory if it doesn't exist. Writes are serialized so
 * overlapping updates cannot both read the same stale snapshot.
 */
export function writeConfig(updates: Partial<StoredConfig>): Promise<void> {
  const write = configWriteQueue.then(async () => {
    const existing = await readConfig();
    writeJson(configPath(), { ...existing, ...updates });
  });
  configWriteQueue = write.catch(() => {});
  return write;
}

/** Wait until every config write scheduled so far has settled. */
export function flushConfigWrites(): Promise<void> {
  return configWriteQueue;
}

export async function readCredentials(): Promise<StoredCredentials | null> {
  const stored = await readJson<StoredCredentials>(credentialsPath());
  return stored?.accessToken ? stored : null;
}

/** Write the credential file, owner-readable only. */
export async function writeCredentials(credentials: StoredCredentials): Promise<void> {
  writeJson(credentialsPath(), credentials, 0o600);
}

export async function clearCredentials(): Promise<boolean> {
  const file = Bun.file(credentialsPath());
  if (!(await file.exists())) return false;
  rmSync(credentialsPath());
  return true;
}

/**
 * Move a token left in `config.json` by an older version into the credential
 * file. Returns true when something moved, so the caller can say so.
 */
export async function migrateLegacyToken(): Promise<boolean> {
  const config = await readConfig();
  const token = config.token?.trim();
  if (!token) return false;

  // An existing credential file wins; the legacy copy is just stripped.
  if (!(await readCredentials())) {
    await writeCredentials({ accessToken: token });
  }

  const { token: _dropped, ...rest } = config;
  writeJson(configPath(), rest);
  return true;
}

installConfigService({
  readConfig,
  writeConfig,
  flushConfigWrites,
  readCredentials,
  writeCredentials,
  clearCredentials,
});
