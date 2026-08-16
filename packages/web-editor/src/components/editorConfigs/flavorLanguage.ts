import type { PretextFlavorLanguage } from "@pretextbook/latex-style-pretext";
import { isRangeWithin, type LineRange } from "../lockedRegion";
import type {
  CleanSupport,
  LspCodeAction,
  LspDiagnostic,
  LspRange,
} from "./types";

/**
 * Adapter that plugs a `PretextFlavorLanguage` core — currently
 * `@pretextbook/latex-style-pretext` and `@pretextbook/markdown-style-pretext` —
 * into Monaco.  Both packages implement the *same* interface, so this module is
 * pure LSP→Monaco translation with **zero language logic**: the vocabulary, the
 * completion contexts, the lint rules and the cleanup rules all live in those
 * packages, and a new flavor is wired up by adding one `FormatEditorConfig`
 * entry.
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

/**
 * Marker owner for cleanup findings.
 *
 * Deliberately not `flavor.languageId`, which owns the lint markers: lint
 * answers "will this convert?" and cleanup answers "should this still be
 * here?".  Separate owners mean either set can be replaced or cleared without
 * touching the other — and a future "hide cleanup suggestions" preference is
 * then one `setModelMarkers(model, owner, [])` call.
 */
export const cleanMarkerOwner = (languageId: string) => `${languageId}-clean`;

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
  /**
   * Source-cleanup engine, when the format has one.  Drives a second set of
   * markers and the quick fixes on them.  Omit and none of that is registered.
   */
  clean?: CleanSupport;
  /**
   * The span of the model the user may edit, when the format locks a
   * structural region (see `lockedRegion.ts`).  A quick fix whose edit falls
   * outside it is not offered: the constrained-editor plugin would revert it
   * and the collab guard would drop it, so a lightbulb there is a promise the
   * editor can't keep.
   */
  getEditableRange?: (model: any) => LineRange | null;
  /**
   * Whole-buffer cleanup, exposed as an editor action (command palette,
   * right-click menu).  Supplied by the format's config rather than run from
   * here, because applying fixes needs the model's locked geometry — see
   * `latexClean.ts`.
   */
  cleanAll?: { label: string; run: () => void };
}

/**
 * Registers completions, diagnostics and — for a format with a legacy dialect
 * behind it — cleanup squiggles, quick fixes and the bulk cleanup command.
 * Returns a disposable that tears them all down; `CodeEditor` calls it whenever
 * the source format changes or the editor unmounts, so providers never
 * accumulate and a flavor's markers never outlive the format they describe.
 */
export const registerFlavorLanguage = (
  monaco: any,
  editor: any,
  options: FlavorRegistrationOptions,
): { dispose: () => void } => {
  const completions = registerFlavorCompletions(monaco, options);
  const codeActions = registerCleanCodeActions(monaco, options);
  const cleanAction = registerCleanAction(editor, options);
  const diagnostics = wireFlavorDiagnostics(monaco, editor, options);

  return {
    dispose: () => {
      diagnostics?.dispose();
      cleanAction?.dispose?.();
      codeActions?.dispose?.();
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
 * replaces or clears its own.  Cleanup findings ride the same debounce but go
 * out under their own owner — see {@link cleanMarkerOwner}.
 */
const wireFlavorDiagnostics = (
  monaco: any,
  editor: any,
  { flavor, clean, diagnosticsDebounceMs = 400 }: FlavorRegistrationOptions,
): { dispose: () => void } | null => {
  const model = editor?.getModel?.();
  if (!model) return null;

  const cleanOwner = cleanMarkerOwner(flavor.languageId);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const run = async () => {
    // One read for both passes, so the two marker sets always describe the
    // same text even though only the linter is async.
    const text = model.getValue();

    if (clean) {
      try {
        const markers = clean
          .getDiagnostics(text)
          .map((d) => toCleanMarker(monaco, d));
        if (!disposed && !model.isDisposed?.()) {
          monaco.editor.setModelMarkers(model, cleanOwner, markers);
        }
      } catch {
        // Cleanup is advisory; a failure here must not cost the author their
        // conversion errors below.
      }
    }

    try {
      const diagnostics = await flavor.getDiagnostics(text);
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
        monaco.editor.setModelMarkers(model, cleanOwner, []);
      }
    },
  };
};

/**
 * Quick fixes for the cleanup findings under the cursor.
 *
 * The core also returns a whole-file "Clean up LaTeX" source action, which is
 * dropped here: it is one edit spanning the entire document, which the locked
 * structural line rejects and which a collab binding would replay as
 * delete-everything-then-reinsert.  The `cleanAll` action below applies the
 * same fixes incrementally instead.
 */
const registerCleanCodeActions = (
  monaco: any,
  { clean, monacoLanguageId, getEditableRange }: FlavorRegistrationOptions,
) => {
  if (!clean) return null;

  return monaco.languages.registerCodeActionProvider(monacoLanguageId, {
    provideCodeActions: (model: any, range: any) => {
      // Monaco requires the result to be disposable, even when it holds
      // nothing that needs disposing.
      const empty = { actions: [], dispose: () => {} };
      if (!model || model.isDisposed?.()) return empty;

      const uri = model.uri.toString();
      let lspActions: LspCodeAction[];
      try {
        lspActions = clean.getCodeActions(
          model.getValue(),
          toLspRange(range),
          uri,
        );
      } catch {
        return empty;
      }

      const editable = getEditableRange?.(model) ?? null;
      const actions = lspActions
        .map((action) =>
          toMonacoCodeAction(monaco, model, uri, action, editable),
        )
        .filter((action) => action !== null);

      return { actions, dispose: () => {} };
    },
  });
};

/**
 * The bulk "Clean up LaTeX" command, in the command palette and the editor's
 * right-click menu.  Disabled on a read-only buffer, where every edit it would
 * make is refused anyway.
 */
const registerCleanAction = (
  editor: any,
  { cleanAll, monacoLanguageId }: FlavorRegistrationOptions,
) => {
  if (!cleanAll || typeof editor?.addAction !== "function") return null;

  return editor.addAction({
    id: `${monacoLanguageId}.clean-all`,
    label: cleanAll.label,
    precondition: "!editorReadonly",
    contextMenuGroupId: "1_modification",
    contextMenuOrder: 2,
    run: () => {
      cleanAll.run();
    },
  });
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
  // The rule id, which Monaco shows in the Problems view and which lets a
  // reader tie a squiggle back to the row it came from in the review dialog.
  // Monaco's `code` is a string; LSP allows a number too.
  code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
  severity: mapSeverity(monaco, diagnostic.severity),
});

/**
 * A cleanup marker: an ordinary marker, plus the "unnecessary" tag when the fix
 * is to delete the matched text.  Monaco renders a tagged range faded instead
 * of underlined, which reads better for markup on its way out of the document
 * than a squiggle does — the same treatment an unused import gets.
 */
const toCleanMarker = (monaco: any, diagnostic: LspDiagnostic) => {
  const data = diagnostic.data as { replacement?: string } | undefined;
  const marker = toMonacoMarker(monaco, diagnostic);
  return data?.replacement === ""
    ? { ...marker, tags: [monaco.MarkerTag.Unnecessary] }
    : marker;
};

const toMonacoRange = (monaco: any, range: LspRange) =>
  new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );

const toLspRange = (range: any): LspRange => ({
  start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
  end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
});

/**
 * Translates one LSP code action.  Returns null for an action this editor
 * cannot honour: a source-wide action (see `registerCleanCodeActions`), one
 * whose edits don't apply to this model, or one that would write outside the
 * editable region.
 */
const toMonacoCodeAction = (
  monaco: any,
  model: any,
  uri: string,
  action: LspCodeAction,
  editable: LineRange | null,
) => {
  if (action.kind?.startsWith("source")) return null;

  const changes = action.edit?.changes?.[uri];
  if (!changes?.length) return null;

  const edits = changes.map((change) => ({
    resource: model.uri,
    // Guards against the buffer moving on between the lightbulb being computed
    // and the user picking the fix — Monaco discards a stale edit rather than
    // applying it at the wrong offset.
    versionId: model.getVersionId(),
    textEdit: {
      range: toMonacoRange(monaco, change.range),
      text: change.newText,
    },
  }));

  if (editable && !edits.every((e) => isRangeWithin(editable, e.textEdit.range))) {
    return null;
  }

  return {
    title: action.title,
    kind: action.kind,
    diagnostics: action.diagnostics?.map((d) => toCleanMarker(monaco, d)),
    edit: { edits },
    isPreferred: true,
  };
};

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
