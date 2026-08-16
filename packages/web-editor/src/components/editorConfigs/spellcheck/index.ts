import { findCheckableLatexRegions } from "./latexRegions";
import { findCheckableMarkdownRegions } from "./markdownRegions";
import type { RegionFinder } from "./regions";
import { registerSpellCheck } from "./register";
import { getSpellCheckSettings } from "./settings";
import { findCheckableRegions } from "./xmlRegions";

/**
 * Which source format an editor is showing, and with it the only part of spell
 * checking that varies: how the prose is told apart from the markup.
 */
export type SpellCheckFlavor = "pretext" | "latex" | "markdown";

const REGION_FINDERS: Record<SpellCheckFlavor, RegionFinder> = {
  pretext: findCheckableRegions,
  latex: findCheckableLatexRegions,
  markdown: findCheckableMarkdownRegions,
};

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
  flavor: SpellCheckFlavor,
): { dispose: () => void } | null => {
  const settings = getSpellCheckSettings();
  if (!settings.enabled) return null;
  return registerSpellCheck(monaco, editor, {
    monacoLanguageId,
    scopes: settings.scopes,
    findRegions: REGION_FINDERS[flavor],
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
export type { RegionFinder, TextRegion } from "./regions";
export { registerSpellCheck, SPELLCHECK_MARKER_OWNER } from "./register";
