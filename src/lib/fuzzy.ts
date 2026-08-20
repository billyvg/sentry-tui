/**
 * Fuzzy matching for the command palette.
 *
 * A port of the fzf v1 algorithm, trimmed to the one shape this app needs:
 * score a candidate against a lowercase query and report which characters
 * matched. The constants are lifted verbatim from
 * `sentry/static/app/utils/search/fzf.tsx`, which the web command palette
 * scores with, so the same query ranks the same way in both clients.
 *
 * Upstream: https://github.com/junegunn/fzf (MIT).
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the candidate that matched a query character, ascending. */
  positions: readonly number[];
}

const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;
const BONUS_BOUNDARY = SCORE_MATCH / 2;
const BONUS_NON_WORD = SCORE_MATCH / 2;
const BONUS_CAMEL_123 = BONUS_BOUNDARY + SCORE_GAP_EXTENSION;
const BONUS_CONSECUTIVE = -(SCORE_GAP_START + SCORE_GAP_EXTENSION);
/** The first matched character says the most about intent, so its bonus doubles. */
const BONUS_FIRST_CHAR_MULTIPLIER = 2;

const enum CharClass {
  Lower = 0,
  Upper = 1,
  Number = 2,
  NonWord = 3,
}

const LOWER_A = 97;
const LOWER_Z = 122;
const UPPER_A = 65;
const UPPER_Z = 90;
const ZERO = 48;
const NINE = 57;

function charClassOf(code: number): CharClass {
  if (code >= LOWER_A && code <= LOWER_Z) return CharClass.Lower;
  if (code >= UPPER_A && code <= UPPER_Z) return CharClass.Upper;
  if (code >= ZERO && code <= NINE) return CharClass.Number;
  return CharClass.NonWord;
}

/** Lowercase a single ASCII character — cheaper than lowercasing whole strings. */
function lower(char: string): string {
  const code = char.charCodeAt(0);
  return code >= UPPER_A && code <= UPPER_Z ? String.fromCharCode(code + 32) : char;
}

/**
 * Score `text` against `query`.
 *
 * @param query must already be lowercase — matching is case-insensitive, and
 *   lowercasing it once per search rather than once per candidate is the whole
 *   point of the contract.
 * @returns `null` when `query` is not a subsequence of `text`. An empty query
 *   scores 0 and matches everything, so an unfiltered palette is the same code
 *   path as a filtered one.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, positions: [] };

  // Forward pass: the earliest end index at which the whole query fits.
  let pidx = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    if (lower(text[i]!) !== query[pidx]) continue;
    if (start < 0) start = i;
    pidx++;
    if (pidx === query.length) {
      end = i + 1;
      break;
    }
  }
  if (end === -1) return null;

  // Backward pass: slide the start forward to the tightest window that still
  // holds the whole query, so "ee" in "feed" scores the adjacent pair.
  pidx = query.length - 1;
  for (let i = end - 1; i >= start; i--) {
    if (lower(text[i]!) !== query[pidx]) continue;
    pidx--;
    if (pidx < 0) {
      start = i;
      break;
    }
  }

  const { score, positions } = scoreWindow(text, query, start, end);

  // An exact match outranks every partial one that happens to score well.
  const exact = start === 0 && end === text.length && text.length === query.length;
  return { score: exact ? score + SCORE_MATCH : score, positions };
}

function bonusFor(previous: CharClass, current: CharClass): number {
  if (previous === CharClass.NonWord && current !== CharClass.NonWord) return BONUS_BOUNDARY;
  if (
    (previous === CharClass.Lower && current === CharClass.Upper) ||
    (previous !== CharClass.Number && current === CharClass.Number)
  ) {
    return BONUS_CAMEL_123;
  }
  if (current === CharClass.NonWord) return BONUS_NON_WORD;
  return 0;
}

/** Walk the matched window and award per-character bonuses and gap penalties. */
function scoreWindow(
  text: string,
  query: string,
  start: number,
  end: number,
): { score: number; positions: number[] } {
  let pidx = 0;
  let score = 0;
  let inGap = false;
  let firstBonus = 0;
  let consecutive = 0;
  let previousClass = start > 0 ? charClassOf(text.charCodeAt(start - 1)) : CharClass.NonWord;
  const positions: number[] = [];

  for (let i = start; i < end; i++) {
    const char = lower(text[i]!);
    const currentClass = charClassOf(char.charCodeAt(0));

    if (char === query[pidx]) {
      positions.push(i);
      score += SCORE_MATCH;
      let bonus = bonusFor(previousClass, currentClass);
      if (consecutive === 0) {
        firstBonus = bonus;
      } else {
        // A word boundary restarts the run's bonus; otherwise the run keeps
        // whichever bonus is worth most.
        if (bonus === BONUS_BOUNDARY) firstBonus = bonus;
        bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
      }
      score += pidx === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus;
      inGap = false;
      consecutive++;
      pidx++;
    } else {
      score += inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START;
      inGap = true;
      consecutive = 0;
      firstBonus = 0;
    }
    previousClass = currentClass;
  }

  return { score, positions };
}
