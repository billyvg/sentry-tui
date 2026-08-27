import { readFileSync } from "node:fs";

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
 * dev) has already resolved and embedded them — a read failure here means the
 * build is broken, not that an icon is merely absent.
 */
export function imageBytes(path: string): Uint8Array {
  let bytes = cache.get(path);
  if (!bytes) {
    bytes = readFileSync(path);
    cache.set(path, bytes);
  }
  return bytes;
}
