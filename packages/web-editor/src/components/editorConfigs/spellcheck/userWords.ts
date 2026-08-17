/**
 * Persistence for words the author has taught the checker.
 *
 * A textbook is full of correct words no general dictionary has — technical
 * vocabulary, author and place names, notation — so "Add to dictionary" is not
 * a nicety here, it's what stops the squiggles from being noise by chapter two.
 * Hosts implement this against their own storage (for PreTeXt-Plus, per
 * project and server-side); with no store the additions still work, they just
 * don't outlive the session.
 */
export interface UserWordStore {
  /** Words already added, loaded once when the checker starts. */
  load: () => readonly string[] | Promise<readonly string[]>;
  /** Called when the author adds a word. Failures are swallowed by the caller. */
  add?: (word: string) => void | Promise<void>;
}

/**
 * The author's own vocabulary: words added permanently, plus words ignored for
 * this session only.
 *
 * Matching is case-insensitive in one direction: adding `Cauchy` accepts
 * `cauchy` too. That is looser than Hunspell's own casing rules, and
 * deliberately so — an author who has declared a word correct does not want to
 * be asked about it again over a capital letter.
 */
export class UserWords {
  private readonly added = new Set<string>();
  private readonly ignored = new Set<string>();
  private readonly store?: UserWordStore;

  constructor(store?: UserWordStore) {
    this.store = store;
  }

  /** Pulls in previously stored words. Safe to call before any checking. */
  async hydrate(): Promise<void> {
    if (!this.store) return;
    try {
      for (const word of await this.store.load()) {
        this.added.add(word.toLowerCase());
      }
    } catch {
      // A store that can't be read costs the author their saved words for this
      // session; it must not stop the checker from running.
    }
  }

  has(word: string): boolean {
    const key = word.toLowerCase();
    return this.added.has(key) || this.ignored.has(key);
  }

  /** Accepts `word` permanently, writing through to the host's store. */
  add(word: string): void {
    this.added.add(word.toLowerCase());
    try {
      void this.store?.add?.(word);
    } catch {
      // Already accepted in memory; a failed write costs persistence only.
    }
  }

  /** Accepts `word` until the page is reloaded. */
  ignore(word: string): void {
    this.ignored.add(word.toLowerCase());
  }
}
