import type { PretextFlavorLanguage } from "@pretextbook/latex-style-pretext";
import type { CleanFix } from "../../cleanFindings";

export type { CleanFix };

/**
 * The LSP-shaped values the language cores return, derived from the flavor
 * interface so these modules need no direct dependency on
 * `vscode-languageserver-types` — the same trick `flavorLanguage.ts` uses for
 * completions.
 */
type GetCleanCodeActions = NonNullable<
  PretextFlavorLanguage["getCleanCodeActions"]
>;
export type LspCodeAction = ReturnType<GetCleanCodeActions>[number];
export type LspRange = Parameters<GetCleanCodeActions>[1];
export type LspDiagnostic = Awaited<
  ReturnType<PretextFlavorLanguage["getDiagnostics"]>
>[number];

/**
 * Source-cleanup support for a format with a legacy dialect behind it.
 *
 * Only LaTeX has one: PreTeXt is the target, and Markdown was written for this
 * editor, so neither has markup that "should not still be here". The language
 * cores say the same thing by making `getCleanFixes`/`getCleanCodeActions`
 * optional on `PretextFlavorLanguage`, and every consumer here treats an absent
 * `clean` as "this format has nothing to clean" rather than as an error.
 *
 * The three query methods are kept separate rather than derived from one
 * another because each host surface needs the findings in a different shape:
 * squiggles want LSP diagnostics (ranges, severities, codes), the review dialog
 * and the apply loop want positioned fixes, and the lightbulb wants code
 * actions. They all come off one engine, so the three always agree.
 */
export interface CleanSupport {
  /** Diagnostics for the findings — published as Monaco markers. */
  getDiagnostics: (text: string) => LspDiagnostic[];
  /** The same findings as positioned fixes — the review list and apply loop. */
  getFixes: (text: string) => CleanFix[];
  /** Quick fixes for the findings intersecting `range`. */
  getCodeActions: (
    text: string,
    range: LspRange,
    uri: string,
  ) => LspCodeAction[];
  /** One-sentence description of a finding, for markers and the review list. */
  describeFix: (fix: CleanFix) => string;
}

/** Per-format Monaco editor configuration. */
export interface FormatEditorConfig {
  /** Monaco language identifier for syntax highlighting. */
  language: string;
  /**
   * Source-cleanup engine, for formats that have one. Read by `CodeEditor` to
   * decide whether to offer the "Clean up LaTeX" toolbar action, and by
   * `registerFlavorLanguage` to publish cleanup squiggles and quick fixes.
   */
  clean?: CleanSupport;
  /**
   * Called once when the Monaco instance is ready (and again when the format
   * changes).  Register language extensions — completions, diagnostics, hover
   * providers, syntax tokens, etc. — and return a disposable so they can be
   * torn down when the format changes or the editor unmounts.
   *
   * `editor` is supplied because diagnostics attach to the editor's *model*
   * (they listen for its content changes and publish markers against it),
   * unlike completions which are registered globally per language id.
   */
  registerMonacoExtensions?: (
    monaco: any,
    editor: any,
  ) => { dispose: () => void } | null;
}
