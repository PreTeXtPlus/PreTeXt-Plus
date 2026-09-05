import { DEFAULT_SPELL_CHECK_SCOPES, type SpellCheckScope } from "./scopes";
import type { DictionarySource } from "./dictionary";
import type { UserWordStore } from "./userWords";

export interface SpellCheckSettings {
  /** Turns spell checking off entirely. Defaults to on. */
  enabled: boolean;
  scopes: SpellCheckScope;
  /** `undefined` uses {@link DEFAULT_DICTIONARY_SOURCE}. */
  dictionarySource?: DictionarySource;
  /** Where "Add to dictionary" writes. Without one, additions last the session. */
  userWordStore?: UserWordStore;
}

/**
 * Process-wide spell check settings.
 *
 * The per-format `FormatEditorConfig` entries are static objects built at module
 * load, so there is nowhere to thread host options through them. Rather than
 * reshape that registry for one feature, hosts call
 * {@link configureSpellCheck} once at startup and every editor mounted
 * afterwards picks the settings up.
 */
let settings: SpellCheckSettings = {
  enabled: true,
  scopes: DEFAULT_SPELL_CHECK_SCOPES,
};

/**
 * Configures spell checking for every editor on the page.
 *
 * Call before mounting the editor. Editors already mounted keep the settings
 * they registered with until their source format changes, since that is what
 * re-runs `registerMonacoExtensions`.
 */
export const configureSpellCheck = (
  next: Partial<SpellCheckSettings>,
): void => {
  settings = {
    ...settings,
    ...next,
    scopes: { ...settings.scopes, ...next.scopes },
  };
};

export const getSpellCheckSettings = (): SpellCheckSettings => settings;

/** Restores the defaults. Exists for tests. */
export const resetSpellCheckSettings = (): void => {
  settings = { enabled: true, scopes: DEFAULT_SPELL_CHECK_SCOPES };
};
