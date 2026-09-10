import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Bytes per asset path, so a path read once is never read again. */
const cache = new Map<string, Uint8Array>();

/**
 * Read a bundled image asset's bytes, memoized by path.
 *
 * Two reasons call sites go through here rather than handing OpenTUI's
 * `<image source>` a path directly:
 *
 * 1. A `bun build --compile` binary serves embedded files from a virtual
 *    filesystem that implements `Bun.file` and `fs.readFileSync` but not
 *    `fs.promises.open` — which is the call OpenTUI makes for a string source.
 *    So a path renders fine from source and silently renders nothing from the
 *    distributed binary. Bytes take OpenTUI's decode branch, which works in
 *    both.
 * 2. OpenTUI reloads whenever the `source` prop changes identity, so the cache
 *    is what keeps a re-render from re-decoding the same icon.
 *
 * Assets reach here through static imports, so the bundler (or Bun's loader in
 * dev) has already resolved and embedded them. The path is resolved relative to
 * this module's directory (import.meta.dir) rather than the process CWD, so the
 * app works regardless of which directory the user launched it from.
 */
export function imageBytes(path: string): Uint8Array {
  let bytes = cache.get(path);
  if (!bytes) {
    bytes = readFileSync(join(import.meta.dir, path));
    cache.set(path, bytes);
  }
  return bytes;
}
