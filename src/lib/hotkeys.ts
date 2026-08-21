/**
 * Assigning a press-once key to each label in a list.
 *
 * The point of the exercise is that the key is *read off the label* rather than
 * memorised: `Issues` answers to `i`, so the hint can be printed in place —
 * `(i)ssues` — instead of in a legend the user has to look away to consult. A
 * label only falls back to an unrelated key when every character it owns is
 * already spoken for.
 */

export interface Hotkey {
  /** The character to press. Always lower case, even when the label isn't. */
  key: string;
  /**
   * Index of the key's character in `[...label]`, or -1 when the key isn't in
   * the label at all and has to be printed beside it.
   */
  index: number;
}

/** Keys handed out when a label has no free character of its own. */
const FALLBACK_KEYS = "abcdefghijklmnopqrstuvwxyz0123456789";

const ASSIGNABLE = /[a-z0-9]/i;

/**
 * Indexes of the characters a label can offer, best first.
 *
 * Word starts come before the rest, so `All Views` prefers `a` then `v` over
 * the `l`s in the middle of the first word — the initial of a word is what a
 * reader's eye lands on, so it is the letter they will reach for.
 */
function candidateIndexes(label: string): number[] {
  const chars = [...label];
  const wordStarts: number[] = [];
  const rest: number[] = [];

  chars.forEach((char, index) => {
    if (!ASSIGNABLE.test(char)) return;
    const previous = chars[index - 1];
    if (previous === undefined || !ASSIGNABLE.test(previous)) wordStarts.push(index);
    else rest.push(index);
  });

  return [...wordStarts, ...rest];
}

/**
 * Give each label a key no other label in the list claims.
 *
 * Returned positionally rather than keyed by label: two entries can legitimately
 * carry the same text, and they still need their own key.
 *
 * @param labels Labels to assign, in priority order — earlier labels get first
 *   pick of their own initials.
 * @param reserved Keys that are spoken for elsewhere and must not be handed out.
 * @returns One entry per label, `undefined` where no key was left to give.
 */
export function assignHotkeys(
  labels: readonly string[],
  reserved: Iterable<string> = [],
): Array<Hotkey | undefined> {
  const taken = new Set<string>();
  for (const key of reserved) taken.add(key.toLowerCase());

  return labels.map((label) => {
    const chars = [...label];

    for (const index of candidateIndexes(label)) {
      const key = chars[index]!.toLowerCase();
      if (taken.has(key)) continue;
      taken.add(key);
      return { key, index };
    }

    const fallback = [...FALLBACK_KEYS].find((key) => !taken.has(key));
    if (!fallback) return undefined;
    taken.add(fallback);
    return { key: fallback, index: -1 };
  });
}
