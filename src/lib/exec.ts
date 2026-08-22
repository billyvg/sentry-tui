/**
 * Replacing this process with another program.
 *
 * Bun has no `process.execve` (checked on 1.3.1), and spawning a child instead
 * leaves the parent blocked in `spawnSync`, holding its own address space
 * until the whole chain unwinds — do it a few times in one session and the
 * suspended parents stack up. `execve(2)` is the call that avoids that, so
 * this reaches it through `bun:ffi`, the same FFI the renderer already needs.
 *
 * Delete this file the day Bun ships `process.execve`; they are the same call.
 */
import { dlopen, FFIType, ptr } from "bun:ffi";

/**
 * Where `execve` lives, per platform.
 *
 * Releases target macOS and glibc Linux only (`scripts/release-targets.ts`),
 * which is one name each; the spares cost nothing and save a mystery on a
 * distro that names things differently.
 */
const LIBC_CANDIDATES: Record<string, string[]> = {
  darwin: ["libSystem.B.dylib", "libc.dylib"],
  linux: ["libc.so.6", "libc.so"],
};

/** Open the platform's libc for `execve`, or null when none of them load. */
function openLibc() {
  for (const name of LIBC_CANDIDATES[process.platform] ?? []) {
    try {
      return dlopen(name, {
        execve: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      }).symbols;
    } catch {
      // Try the next name. Exhausting them is reported once, as null.
    }
  }
  return null;
}

/**
 * Resolved once and remembered, failure included: a machine that cannot dlopen
 * its own libc will not start being able to mid-session.
 */
let libc: ReturnType<typeof openLibc> | undefined;

/** The bytes of `value` as a NUL-terminated C string. */
function cString(value: string): Uint8Array {
  return new TextEncoder().encode(`${value}\0`);
}

/**
 * A NULL-terminated `char *const[]`, and the buffers it points into.
 *
 * Both halves are returned because both have to outlive the call: the array
 * holds addresses, not the strings themselves.
 */
function cStringArray(values: readonly string[]): { array: BigUint64Array; buffers: Uint8Array[] } {
  const buffers = values.map(cString);
  const array = new BigUint64Array(buffers.length + 1); // the trailing 0n is the NULL
  for (const [index, buffer] of buffers.entries()) {
    array[index] = BigInt(ptr(buffer));
  }
  return { array, buffers };
}

/**
 * Replace this process with `path`: same pid, same terminal, same parent still
 * waiting on it.
 *
 * Returns only on failure — on success there is no caller left to return to.
 * The terminal must already be restored, because the new image inherits it
 * exactly as it is left here.
 *
 * `argv` is what the program sees after its own name; `argv[0]` is set to
 * `path`, the way a shell would.
 *
 * @returns false, always — a value the caller can fall back on
 */
export function replaceProcess(
  path: string,
  argv: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): false {
  if (libc === undefined) libc = openLibc();
  if (!libc) return false;

  const file = cString(path);
  const args = cStringArray([path, ...argv]);
  const environment = cStringArray(
    Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`),
  );

  // `ptr()` hands libc a raw address the GC knows nothing about, so a JS
  // reference is the only thing keeping those bytes alive.
  const alive: unknown[] = [file, args.array, args.buffers, environment.array, environment.buffers];

  try {
    libc.execve(ptr(file), ptr(args.array), ptr(environment.array));
  } catch {
    // A rejected call through FFI throws instead of returning -1. Either way
    // the image is still ours, which is all the caller needs to know.
  }

  // Reached only when execve failed. Touching `alive` here is not bookkeeping:
  // it is what holds every buffer above reachable across the call itself.
  alive.length = 0;

  // ENOENT, EACCES, a binary built for another architecture. errno is not
  // worth marshalling — the caller's answer to all of them is the same.
  return false;
}
