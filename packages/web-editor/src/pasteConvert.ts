/**
 * Paste LaTeX or Markdown into a PreTeXt division and have it arrive converted.
 *
 * Copying an exercise out of a LaTeX file and converting it afterwards is two
 * moves; this makes it one. The pure half — deciding whether a snippet is
 * convertible, and fitting the converted markup to where it lands — lives in
 * `@pretextbook/import` (`detectSnippetFormat`, `placeConvertedMarkup`) and is
 * shared with the VS Code extension, so both hosts place a paste identically.
 * What is here is the Monaco half: reading the placement context out of a text
 * model, and running the conversion.
 *
 * `detectSnippetFormat`, not this package's own `detectSourceFormat`: the
 * latter asks "is this *file* a LaTeX document?" and keys on document furniture
 * (`\documentclass`, `\begin{document}`, `\section`) that a fragment copied out
 * of the middle of one never carries. It answers "pretext" for
 * `Let $G$ be a \emph{group}`, and the paste goes through unconverted. The
 * snippet detector scores the grain of the markup instead — math delimiters,
 * backslash commands, bullets — and declines unless the winner clears a floor.
 * Declining is free: the caller just pastes plainly. Guessing wrong mangles
 * text the author meant to keep verbatim.
 *
 * Everything here is synchronous, which the caller depends on: both converters
 * (`markdownToPretext`, `latexToPretext`) return strings rather than promises,
 * so a paste can be converted and inserted inside the DOM event handler as a
 * single edit. See `CodeEditor`'s paste listener for why that matters.
 */
import {
  detectSnippetFormat,
  isInlineContext,
  placeConvertedMarkup,
  type PlacedMarkup,
  type PlacementContext,
} from "@pretextbook/import";
import { derivePretextContent } from "./contentConversion";

/** The slice of Monaco's text model this module needs (kept tiny so it's testable). */
export interface PasteContextModel {
  getValueInRange(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): string;
  getLineContent(lineNumber: number): string;
}

/** A Monaco cursor position. Both coordinates are 1-based. */
export interface PastePosition {
  lineNumber: number;
  column: number;
}

/**
 * Read the placement context out of `model` at `position`.
 *
 * The prefix walked for `inline` is this division's source only, since that is
 * all the model holds — which is more accurate than the whole-file walk the
 * VS Code host does, not less: a division's own paragraphs are the only ones
 * that can enclose its cursor.
 */
export function placementContextAt(
  model: PasteContextModel,
  position: PastePosition,
): PlacementContext {
  const prefix = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  return {
    inline: isInlineContext(prefix),
    baseIndent:
      model.getLineContent(position.lineNumber).match(/^(\s*)/)?.[1] ?? "",
    // Monaco columns are 1-based, so column 1 is the start of the line. The
    // VS Code host spells the same test `character > 0`.
    midLine: position.column > 1,
  };
}

/**
 * The PreTeXt to insert in place of `text`, or `undefined` to paste it plainly.
 *
 * `undefined` is the common answer and never an error: ordinary prose scores as
 * neither language, and a conversion that throws leaves the author's text
 * untouched rather than half-rewritten.
 *
 * A returned `warning` means the markup was inserted somewhere it is not valid
 * — a division landing inside a `<p>`. It is not repaired here, because it
 * cannot be: the honest move is to insert what was asked for and let the
 * author move it. PreTeXt divisions are schema-validated as you type
 * (`usePretextDiagnostics`), so the misplacement is already marked in the
 * gutter; the string is returned for callers that want to say more.
 */
export function convertPastedSnippet(
  text: string,
  model: PasteContextModel,
  position: PastePosition,
): PlacedMarkup | undefined {
  const format = detectSnippetFormat(text);
  if (!format) return undefined;

  const { pretextSource, pretextError } = derivePretextContent(text, format);
  if (pretextError || !pretextSource?.trim()) return undefined;

  return placeConvertedMarkup(
    pretextSource,
    placementContextAt(model, position),
  );
}

/** The start of the range a paste replaces. */
export interface PasteSelection {
  startLineNumber: number;
  startColumn: number;
}

interface PasteEditorModel extends PasteContextModel {
  /** Closes the undo group, so one paste costs one Ctrl+Z. */
  pushStackElement(): void;
}

/** The slice of a Monaco editor this listener drives. */
export interface PasteEditor {
  hasTextFocus(): boolean;
  getModel(): PasteEditorModel | null;
  getSelection(): PasteSelection | null;
  executeEdits(
    source: string,
    edits: { range: PasteSelection; text: string; forceMoveMarkers?: boolean }[],
  ): void;
}

export interface InstallPasteConvertOptions {
  /** The editor to act on, or `null` before it has mounted. */
  getEditor: () => PasteEditor | null;
  /**
   * False when this buffer should not convert — not a PreTeXt division, read
   * only, or the author has turned the feature off. Read per paste rather than
   * captured, since all three can change while the listener is installed.
   */
  isEnabled: () => boolean;
  /** Where to listen. Defaults to `document`; injectable for tests. */
  target?: EventTarget;
}

/**
 * Convert LaTeX/Markdown pastes into `getEditor()`'s buffer. Returns a disposer.
 *
 * Listens in the **capture** phase, and on `document` rather than on the
 * editor's own element. Both choices are load-bearing:
 *
 * - *Capture*, because the conversion has to happen before the text reaches the
 *   model. Monaco's `onDidPaste` fires afterwards, which in a collaborative
 *   division would broadcast the raw LaTeX to every peer and replace it a tick
 *   later, and would cost the author two undo steps for one paste.
 * - *`document`*, because Monaco 0.56 takes keyboard input through a
 *   `native-edit-context` element it does **not** render inside
 *   `editor.getDomNode()`. A listener on the editor's own node never sees the
 *   paste — while `document.activeElement` still reports inside the editor,
 *   which is what makes that easy to miss. Listening at the document catches
 *   both that arrangement and the older hidden-textarea one, and
 *   `hasTextFocus()` scopes the handler back to the editor that has focus, so
 *   several editors on one page do not fight over a paste.
 */
export function installPasteConvertListener({
  getEditor,
  isEnabled,
  target = document,
}: InstallPasteConvertOptions): () => void {
  const onPaste = (event: ClipboardEvent) => {
    const editor = getEditor();
    if (!editor?.hasTextFocus?.() || !isEnabled()) return;

    const text = event.clipboardData?.getData("text/plain");
    if (!text?.trim()) return;

    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) return;

    let converted: PlacedMarkup | undefined;
    try {
      converted = convertPastedSnippet(text, model, {
        lineNumber: selection.startLineNumber,
        column: selection.startColumn,
      });
    } catch {
      // A converter that throws must not cost the author their paste: fall
      // through and let Monaco insert the text exactly as it stands.
      return;
    }
    // The detector declines anything it is not confident about, which is the
    // common case and not an error — leave the paste alone.
    if (!converted) return;

    event.preventDefault();
    event.stopPropagation();
    // Deliberately not flagged as a programmatic edit: this is the author's,
    // and must reach the host as a content change like any other. Going
    // through `executeEdits` also routes it via `pushEditOperations`, so a
    // paste aimed at a locked structural line is dropped by the same guard
    // that stops an ordinary one (see `collab/editGuard.ts`).
    editor.executeEdits("paste-convert", [
      { range: selection, text: converted.markup, forceMoveMarkers: true },
    ]);
    model.pushStackElement();
  };

  const listener = onPaste as EventListener;
  target.addEventListener("paste", listener, true);
  return () => target.removeEventListener("paste", listener, true);
}
