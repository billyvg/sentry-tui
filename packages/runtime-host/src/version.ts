// release.json is the source of truth for the host release line. Importing it
// statically also means `bun build --compile`
// inlines the value, so a compiled binary reports the version it was cut at
// rather than reading a file that isn't shipped beside it.
import { host } from "../../../release.json";

/** The compiled runtime host version, e.g. `0.2.0`. */
export const HOST_VERSION: string = host;

/**
 * The one rendering of the version: `sentry-tui --version`, `sentry-tui
 * status`, and login output all print this, so a host version in a bug report
 * is recognisable as the same string wherever it was copied from.
 */
export const VERSION_LABEL = `v${HOST_VERSION}`;
