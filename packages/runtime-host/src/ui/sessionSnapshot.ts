const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_SNAPSHOT_DEPTH = 32;

/**
 * Clone opaque payload state only when it is bounded JSON.
 *
 * The host never interprets the schema; it enforces the process boundary so a
 * payload cannot accidentally retain functions, promises, cyclic objects, or
 * an unbounded response body across replacement.
 */
export function cloneSessionSnapshot(value: unknown): unknown | undefined {
  try {
    if (!isJsonValue(value, new Set(), 0)) return undefined;
    const json = JSON.stringify(value);
    if (json.length > MAX_SNAPSHOT_BYTES) return undefined;
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

function isJsonValue(value: unknown, ancestors: Set<object>, depth: number): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > MAX_SNAPSHOT_DEPTH) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    return false;
  }

  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors, depth + 1))
    : Object.entries(value).every(
        ([, item]) => item !== undefined && isJsonValue(item, ancestors, depth + 1),
      );
  ancestors.delete(value);
  return valid;
}
