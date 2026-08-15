import type { TextRegion } from "./xmlRegions";

/** A candidate word and where it sits in the source. */
export interface FoundWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Letters, optionally joined by straight or typographic apostrophes so
 * `don't` and `author’s` stay whole.  Hyphens deliberately split: Hunspell
 * dictionaries list the parts, not the compounds, so `well-known` checks
 * better as two words than as one that is always missing.
 */
const WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/**
 * Characters that, when they touch a word, mean it isn't prose: identifiers
 * (`foo_bar`), paths (`images/fig`), macros (`\alpha`), emails and handles
 * (`@name`), and anything with a digit welded on (`h2`).
 */
const CODE_ADJACENT = /[\\/_@#$%0-9]/;

/** Shortest word worth flagging. Two-letter noise ("th", "st") outweighs the misses. */
const MIN_LENGTH = 3;

/**
 * Pulls spell-checkable words out of the given regions.
 *
 * Filtering happens here rather than in the dictionary so the cheap rejections
 * (too short, an acronym, part of a URL) never reach it — on a large division
 * most candidate words are skipped, and each surviving one costs a lookup.
 */
export const extractWords = (
  source: string,
  regions: readonly TextRegion[],
): FoundWord[] => {
  const found: FoundWord[] = [];

  for (const region of regions) {
    const text = source.slice(region.start, region.end);
    WORD_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WORD_PATTERN.exec(text)) !== null) {
      const word = match[0];
      const start = region.start + match.index;
      const end = start + word.length;
      if (isCheckable(word, source, start, end)) {
        found.push({ word, start, end });
      }
    }
  }

  return found;
};

const isCheckable = (
  word: string,
  source: string,
  start: number,
  end: number,
): boolean => {
  // Apostrophes don't count toward length: "I'd" is still too short to judge.
  const letters = word.replace(/['’]/g, "");
  if (letters.length < MIN_LENGTH) return false;
  // Acronyms and initialisms (PDF, HTML, PTX) are never in a word list.
  if (letters === letters.toUpperCase()) return false;

  const before = source[start - 1] ?? "";
  const after = source[end] ?? "";
  if (CODE_ADJACENT.test(before) || CODE_ADJACENT.test(after)) return false;
  // `&amp;` and friends: the word is the entity name, not something the author
  // spelled. `.slice` keeps the lookahead short so a stray `&` earlier in a
  // paragraph can't swallow real prose.
  if (before === "&" && source.slice(end, end + 2).includes(";")) return false;
  // `word(` reads as a call or a macro invocation.
  if (after === "(") return false;

  return true;
};

/**
 * True when a word looks like deliberate CamelCase or a lowerCamel identifier,
 * which a dictionary will always reject but an author never wants flagged as
 * one unit.
 *
 * Exported for the checker, which splits such words and checks the parts.
 */
export const isCompoundIdentifier = (word: string): boolean =>
  /^[A-Za-z][a-z]*(?:[A-Z][a-z]*){1,}$/.test(word) && word !== word.toLowerCase();

/** Splits `CamelCase` into its parts; returns `[word]` for anything else. */
export const splitCompound = (word: string): string[] =>
  isCompoundIdentifier(word) ? (word.match(/[A-Z]?[a-z]+/g) ?? [word]) : [word];
