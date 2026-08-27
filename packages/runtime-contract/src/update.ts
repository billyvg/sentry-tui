/** A newer release already on disk and ready to apply. */
export interface ReadyUpdate {
  version: string;
  kind: "payload" | "host";
  path: string;
}

/** Host-owned update watcher available to a replaceable app payload. */
export interface UpdateService {
  watchForUpdate(onUpdate: (update: ReadyUpdate | undefined) => void): () => void;
}

let service: UpdateService = { watchForUpdate: () => () => {} };

/** Bind the host implementation before the app payload is rendered. */
export function installUpdateService(implementation: UpdateService): void {
  service = implementation;
}

/** Watch for a newer cached release for as long as the app is mounted. */
export function watchForUpdate(onUpdate: (update: ReadyUpdate | undefined) => void): () => void {
  return service.watchForUpdate(onUpdate);
}
