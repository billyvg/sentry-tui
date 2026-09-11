import type { SentryClient } from "~/api/client";

export interface ProfileFrameSummary {
  id: number;
  name: string;
  location?: string;
  weight: number;
}

/** Leaf-frame weights across all threads; time is summed thread time, not wall time. */
export interface ProfileSummary {
  transaction?: string;
  unit: "ms" | "samples";
  frames: ProfileFrameSummary[];
}

/** Narrow unstable profile payloads without introducing a second schema system. */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Keep optional strings out of frame labels when the service omits them. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Read a finite weight or timestamp without coercing null into a zero. */
function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Fetch one profile, independent of the current Explore time and project filters. */
export async function fetchProfileSummary(
  client: SentryClient,
  {
    org,
    projectSlug,
    profileId,
    signal,
  }: { org: string; projectSlug: string; profileId: string; signal?: AbortSignal },
): Promise<ProfileSummary> {
  const page = await client.request<unknown>(
    `/projects/${encodeURIComponent(org)}/${encodeURIComponent(projectSlug)}/profiling/profiles/${encodeURIComponent(profileId)}/`,
    { signal },
  );
  return summarizeProfile(page.data);
}

/**
 * Reduce Sentry sampled profiles and legacy sampled/evented profiles to leaf weights.
 * Sentry stacks are leaf first; legacy schema stacks are root first. Sampled
 * time uses the interval to the next sample on the same thread (last sample: 0).
 */
export function summarizeProfile(value: unknown): ProfileSummary {
  const input = record(value);
  const profile = record(input["profile"]);
  const legacy = Array.isArray(input["profiles"]) ? input["profiles"] : undefined;
  const rawFrames = Array.isArray(profile["frames"])
    ? profile["frames"]
    : record(input["shared"])["frames"];
  if (!Array.isArray(rawFrames)) throw new TypeError("Invalid profile response");
  const frames: unknown[] = rawFrames;
  const weights = new Map<number, number>();
  let unit: ProfileSummary["unit"] = "ms";
  /** Accumulate only valid leaf references and positive measurements. */
  function add(id: unknown, weight: number) {
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      !frames[id] ||
      !Number.isFinite(weight) ||
      weight <= 0
    )
      return;
    weights.set(id, (weights.get(id) ?? 0) + weight);
  }
  if (Array.isArray(profile["samples"]) && Array.isArray(profile["stacks"])) {
    const stacks = profile["stacks"];
    const threads = new Map<string, Array<{ at: number; stack: unknown }>>();
    for (const raw of profile["samples"]) {
      const sample = record(raw);
      const at = number(sample["elapsed_since_start_ns"]);
      const stackId = number(sample["stack_id"]);
      if (at === undefined || stackId === undefined || !Number.isInteger(stackId)) continue;
      const key = String(sample["thread_id"] ?? "");
      const samples = threads.get(key) ?? [];
      samples.push({ at, stack: stacks[stackId] });
      threads.set(key, samples);
    }
    for (const samples of threads.values()) {
      samples.sort((a, b) => a.at - b.at);
      for (let i = 0; i < samples.length - 1; i++) {
        const sample = samples[i]!;
        if (Array.isArray(sample.stack))
          add(sample.stack[0], (samples[i + 1]!.at - sample.at) / 1e6);
      }
    }
  } else if (legacy) {
    const countOnly = legacy.every((raw) => record(raw)["unit"] === "count");
    unit = countOnly ? "samples" : "ms";
    for (const raw of legacy) {
      const thread = record(raw);
      const scale = countOnly
        ? 1
        : (
            { nanoseconds: 1e-6, microseconds: 1e-3, milliseconds: 1, seconds: 1000 } as Record<
              string,
              number
            >
          )[String(thread["unit"])];
      if (scale === undefined) throw new TypeError("Unsupported profile weight unit");
      if (
        thread["type"] === "sampled" &&
        Array.isArray(thread["samples"]) &&
        Array.isArray(thread["weights"])
      ) {
        const sampleWeights = thread["weights"];
        thread["samples"].forEach((stack, i) => {
          if (Array.isArray(stack)) add(stack.at(-1), (number(sampleWeights[i]) ?? 0) * scale);
        });
      } else if (thread["type"] === "evented" && Array.isArray(thread["events"])) {
        const stack: unknown[] = [];
        let previous = number(thread["startValue"]) ?? 0;
        for (const rawEvent of thread["events"]) {
          const event = record(rawEvent);
          const at = number(event["at"]);
          if (at === undefined || at < previous) continue;
          add(stack.at(-1), (at - previous) * scale);
          if (event["type"] === "O") stack.push(event["frame"]);
          else if (event["type"] === "C") stack.pop();
          previous = at;
        }
        add(stack.at(-1), ((number(thread["endValue"]) ?? previous) - previous) * scale);
      } else throw new TypeError("Unsupported profile format");
    }
  } else throw new TypeError("Unsupported profile format");
  return {
    transaction:
      text(record(input["transaction"])["name"]) ??
      text(record(input["metadata"])["transactionName"]),
    unit,
    frames: [...weights]
      .map(([id, weight]) => {
        const frame = record(frames[id]);
        const file =
          text(frame["file"]) ??
          text(frame["filename"]) ??
          text(frame["module"]) ??
          text(frame["package"]);
        const line = number(frame["lineno"]) ?? number(frame["line"]);
        return {
          id,
          weight,
          name:
            text(frame["function"]) ??
            text(frame["name"]) ??
            text(frame["symbol"]) ??
            "(anonymous)",
          location: file ? `${file}${line === undefined ? "" : `:${line}`}` : undefined,
        };
      })
      .sort((a, b) => b.weight - a.weight || a.id - b.id),
  };
}
