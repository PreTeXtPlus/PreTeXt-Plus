/**
 * What Speech Rule Engine needs of its surroundings, set up before it loads —
 * so this module must be imported before SRE is (`./nemeth.ts` imports it first).
 *
 * Its locale files (its `mathmaps`) are handed to it from this bundle instead of
 * fetched: SRE reads a global `SREfeature` on every setup, including the one it
 * runs when its module is first evaluated, which would otherwise fetch `base`
 * and `en` from a CDN.
 *
 * And Node's `global`: SRE's XPath library (`wicked-good-xpath`) publishes only
 * a Node build, which installs itself with `.call(global)` — undefined in a Web
 * Worker, where this runs.
 */
import base from "speech-rule-engine/lib/mathmaps/base.json";
import en from "speech-rule-engine/lib/mathmaps/en.json";
import nemeth from "speech-rule-engine/lib/mathmaps/nemeth.json";

// `base` and `en` (the default locale) are loaded whatever the locale asked for.
const LOCALES: Record<string, unknown> = { base, en, nemeth };

const scope = globalThis as { SREfeature?: Record<string, unknown>; global?: unknown };
scope.global ??= globalThis;

scope.SREfeature = {
  custom: (locale: string) =>
    locale in LOCALES
      ? Promise.resolve(LOCALES[locale])
      : Promise.reject(new Error(`No braille rules for the locale “${locale}”`)),
};
