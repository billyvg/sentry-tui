import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

/** Preferences. Never holds secrets — see {@link StoredCredentials}. */
export interface StoredConfig {
  org?: string;
  /**
   * Pre-0.2 installs kept the token here. Read for one last time by
   * {@link migrateLegacyToken}, then removed.
   */
  token?: string;
}

/** Whatever proves we may talk to Sentry, however it was obtained. */
export interface StoredCredentials {
  accessToken: string;
  /** Present for OAuth tokens; personal tokens cannot be refreshed. */
  refreshToken?: string;
  /** ISO 8601 instant the access token stops working, when the server said so. */
  expiresAt?: string;
  scopes?: string[];
  /** The OAuth application the token belongs to, so refresh can find it again. */
  clientId?: string;
  /** Sentry install the token is valid for, e.g. `https://sentry.io`. */
  siteUrl?: string;
  /** Shown by `sentry-tui status`; not used for any decision. */
  user?: { id?: string; name?: string; email?: string };
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

/**
 * Merge `updates` into the stored config and write it back.
 * Creates the config directory if it doesn't exist.
 */
export async function writeConfig(updates: Partial<StoredConfig>): Promise<void> {
  const existing = await readConfig();
  writeJson(configPath(), { ...existing, ...updates });
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
