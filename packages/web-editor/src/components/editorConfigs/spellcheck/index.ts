import { registerSpellCheck } from "./register";
import { getSpellCheckSettings } from "./settings";

/**
 * Wires spell checking into a format's `registerMonacoExtensions`, using the
 * host's {@link configureSpellCheck} settings.  Returns `null` when spell
 * checking is switched off, so callers can compose it with `?.dispose()` the
 * same way they do the other extensions.
 */
export const registerConfiguredSpellCheck = (
  monaco: any,
  editor: any,
  monacoLanguageId: string,
): { dispose: () => void } | null => {
  const settings = getSpellCheckSettings();
  if (!settings.enabled) return null;
  return registerSpellCheck(monaco, editor, {
    monacoLanguageId,
    scopes: settings.scopes,
    dictionarySource: settings.dictionarySource,
    userWordStore: settings.userWordStore,
  });
};

export {
  configureSpellCheck,
  getSpellCheckSettings,
  resetSpellCheckSettings,
  type SpellCheckSettings,
} from "./settings";
export {
  DEFAULT_SPELL_CHECK_SCOPES,
  SCOPE_ELEMENTS,
  type SpellCheckScope,
  type SpellCheckScopeSetting,
} from "./scopes";
export {
  DEFAULT_DICTIONARY_SOURCE,
  type DictionarySource,
} from "./dictionary";
export type { UserWordStore } from "./userWords";
export { registerSpellCheck, SPELLCHECK_MARKER_OWNER } from "./register";
