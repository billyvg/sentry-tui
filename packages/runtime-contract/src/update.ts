/** A newer release already on disk and ready to apply. */
export interface ReadyUpdate {
  version: string;
  kind: "payload" | "host";
  path: string;
}

/** Host-owned update watcher available to a replaceable app payload. */
export interface UpdateService {
  watchForUpdate(onUpdate: (update: ReadyUpdate | undefined) => void): () => void;
  checkForUpdate(): Promise<ReadyUpdate | undefined>;
}

const inertUpdateService: UpdateService = {
  watchForUpdate: () => () => {},
  checkForUpdate: async () => undefined,
};

let service = inertUpdateService;

/** Bind the host implementation before the app payload is rendered. */
export function installUpdateService(implementation: UpdateService): () => void {
  const previous = service;
  service = implementation;
  return () => {
    if (service === implementation) service = previous;
  };
}

/** Watch for a newer cached release for as long as the app is mounted. */
export function watchForUpdate(onUpdate: (update: ReadyUpdate | undefined) => void): () => void {
  return service.watchForUpdate(onUpdate);
}

/** Immediately ask the active runtime to download and report a newer release. */
export function checkForUpdate(): Promise<ReadyUpdate | undefined> {
  return service.checkForUpdate();
}
