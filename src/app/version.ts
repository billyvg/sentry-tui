// The payload has its own release line. Keeping this import static lets
// `build:app` and the compiled host embed the exact app version they contain.
import { app } from "../../release.json";

/** The application payload version, independent of the runtime host version. */
export const APP_VERSION: string = app;

/** User-facing app payload version. */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
