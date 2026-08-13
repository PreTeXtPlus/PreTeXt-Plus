import type { PretextFlavorLanguage } from "@pretextbook/latex-style-pretext";

/**
 * Adapter that plugs a `PretextFlavorLanguage` core — currently
 * `@pretextbook/latex-style-pretext` and `@pretextbook/markdown-style-pretext` —
 * into Monaco.  Both packages implement the *same* interface, so this module is
 * pure LSP→Monaco translation with **zero language logic**: the vocabulary, the
 * completion contexts and the lint rules all live in those packages, and a new
 * flavor is wired up by adding one `FormatEditorConfig` entry.
 *
 * Syntax highlighting is deliberately *not* handled here — Monaco's built-in
 * `latex` tokenizer and this repo's richer `pretext-markdown` Monarch grammar
 * (see `markdownSyntax.ts`) already cover it.
 */

/** The LSP-shaped values the cores return, derived so this module needs no
 * direct dependency on `vscode-languageserver-types`. */
type LspCompletionItem = ReturnType<
  PretextFlavorLanguage["getCompletions"]
>[number];
type LspDiagnostic = Awaited<
  ReturnType<PretextFlavorLanguage["getDiagnostics"]>
>[number];

export interface FlavorRegistrationOptions {
  /** The language core, e.g. `pretextLatexLanguage`. */
  flavor: PretextFlavorLanguage;
  /**
   * The Monaco language id the *model* uses, which is not necessarily
   * `flavor.languageId`: LaTeX content is highlighted by Monaco's built-in
   * `latex` grammar, while the core calls itself `pretext-latex`.  Completion
   * providers must be registered against the model's id to fire at all.
   */
  monacoLanguageId: string;
  /**
   * Characters that open a completion context (`\` for LaTeX macros, `:` for
   * Markdown directives, …).  The core re-checks the cursor context itself and
   * returns nothing when the character isn't in a meaningful position, so a
   * common character like `:` costs nothing but a discarded call.
   */
  triggerCharacters: string[];
  /** How long to wait after the last keystroke before re-linting. */
  diagnosticsDebounceMs?: number;
}

/**
 * Registers completions and diagnostics for one flavor.  Returns a disposable
 * that tears both down — `CodeEditor` calls it whenever the source format
 * changes or the editor unmounts, so providers never accumulate and a flavor's
 * markers never outlive the format they describe.
 */
export const registerFlavorLanguage = (
  monaco: any,
  editor: any,
  options: FlavorRegistrationOptions,
): { dispose: () => void } => {
  const completions = registerFlavorCompletions(monaco, options);
  const diagnostics = wireFlavorDiagnostics(monaco, editor, options);

  return {
    dispose: () => {
      diagnostics?.dispose();
      completions?.dispose?.();
    },
  };
};

const registerFlavorCompletions = (
  monaco: any,
  { flavor, monacoLanguageId, triggerCharacters }: FlavorRegistrationOptions,
) =>
  monaco.languages.registerCompletionItemProvider(monacoLanguageId, {
    triggerCharacters,
    provideCompletionItems: (model: any, position: any, context: any) => {
      const items = flavor.getCompletions({
        text: model.getValue(),
        offset: model.getOffsetAt(position),
        triggerCharacter: context?.triggerCharacter,
      });

      const suggestions = items
        .map((item) => toMonacoCompletion(monaco, item))
        .filter((suggestion) => suggestion !== null);
      return { suggestions };
    },
  });

/**
 * Re-lints the model on every (debounced) change and publishes the result as
 * Monaco markers, owned by `flavor.languageId` so each flavor only ever
 * replaces or clears its own.
 */
const wireFlavorDiagnostics = (
  monaco: any,
  editor: any,
  { flavor, diagnosticsDebounceMs = 400 }: FlavorRegistrationOptions,
): { dispose: () => void } | null => {
  const model = editor?.getModel?.();
  if (!model) return null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const run = async () => {
    try {
      const diagnostics = await flavor.getDiagnostics(model.getValue());
      // The format may have switched (or the editor unmounted) while the
      // linter was running; publishing now would strand markers this
      // disposable can no longer clear.
      if (disposed || model.isDisposed?.()) return;
      monaco.editor.setModelMarkers(
        model,
        flavor.languageId,
        diagnostics.map((d) => toMonacoMarker(monaco, d)),
      );
    } catch {
      // A linter failure must never take the editor down with it; leave the
      // previous markers in place and try again on the next edit.
    }
  };

  const subscription = model.onDidChangeContent(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, diagnosticsDebounceMs);
  });

  void run(); // initial pass, so problems are visible before the first edit

  return {
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      subscription?.dispose?.();
      if (!model.isDisposed?.()) {
        monaco.editor.setModelMarkers(model, flavor.languageId, []);
      }
    },
  };
};

// --- LSP → Monaco mapping --------------------------------------------------

/**
 * Both cores always attach a `textEdit` with an explicit replacement range —
 * that's what lets a completion swallow the prefix already typed (and an
 * auto-closed `}`).  An item without one would have no range for Monaco to
 * apply, so it is dropped rather than inserted at the wrong place.
 */
const toMonacoCompletion = (monaco: any, item: LspCompletionItem) => {
  const edit = item.textEdit;
  if (!edit || !("range" in edit)) return null;
  const { start, end } = edit.range;

  return {
    label: item.label,
    kind: mapCompletionKind(monaco, item.kind),
    insertText: edit.newText,
    insertTextRules:
      item.insertTextFormat === 2 // InsertTextFormat.Snippet
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range: new monaco.Range(
      start.line + 1,
      start.character + 1,
      end.line + 1,
      end.character + 1,
    ),
    detail: item.detail,
    documentation:
      typeof item.documentation === "object"
        ? { value: item.documentation.value }
        : item.documentation,
    sortText: item.sortText,
  };
};

const mapCompletionKind = (monaco: any, kind: number | undefined) => {
  const kinds = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 3: // LSP Function — macros
      return kinds.Function;
    case 7: // LSP Class — environments / directives
      return kinds.Class;
    case 14: // LSP Keyword
      return kinds.Keyword;
    case 18: // LSP Reference — \label / #id targets
      return kinds.Reference;
    default:
      return kinds.Text;
  }
};

const toMonacoMarker = (monaco: any, diagnostic: LspDiagnostic) => ({
  startLineNumber: diagnostic.range.start.line + 1,
  startColumn: diagnostic.range.start.character + 1,
  endLineNumber: diagnostic.range.end.line + 1,
  endColumn: diagnostic.range.end.character + 1,
  message: diagnostic.message,
  source: diagnostic.source,
  severity: mapSeverity(monaco, diagnostic.severity),
});

/** Exported for `pretextDiagnostics.ts`, which publishes markers of its own. */
export const mapSeverity = (monaco: any, severity: number | undefined) => {
  const severities = monaco.MarkerSeverity;
  switch (severity) {
    case 1: // LSP Error
      return severities.Error;
    case 2: // LSP Warning
      return severities.Warning;
    case 4: // LSP Hint
      return severities.Hint;
    default: // LSP Information
      return severities.Info;
  }
};
