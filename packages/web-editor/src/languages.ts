/**
 * The document languages a project may declare, written as `@xml:lang` on
 * the generated PreTeXt root element (see `assembleFullProjectSource` /
 * `wrapDivisionForPreview` in `sectionUtils.ts`). Codes are BCP-47.
 *
 * Keep in sync with the `language` enum in `app/models/project.rb` — the two
 * lists can't share a single source of truth across Ruby/TypeScript, so any
 * code added or renamed here must be mirrored there too.
 */
export interface LanguageOption {
  code: string;
  label: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: "en-US", label: "English (United States)" },
  { code: "af-ZA", label: "Afrikaans (South Africa)" },
  { code: "bg-BG", label: "Bulgarian (Bulgaria)" },
  { code: "ca-ES", label: "Catalan (Spain)" },
  { code: "cs-CZ", label: "Czech (Czechia)" },
  { code: "de-DE", label: "German (Germany)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "fi-FI", label: "Finnish (Finland)" },
  { code: "fr-CA", label: "French (Canada)" },
  { code: "fr-FR", label: "French (France)" },
  { code: "hu-HU", label: "Hungarian (Hungary)" },
  { code: "it-IT", label: "Italian (Italy)" },
  { code: "pt-BR", label: "Portugese (Brazil)" },
  { code: "pt-PT", label: "Portugese (Portugal)" },
];

export const DEFAULT_LANGUAGE = "en-US";
