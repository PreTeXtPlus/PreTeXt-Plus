/**
 * Runs PreTeXt schema diagnostics for the active buffer and keeps Monaco's
 * markers in step with them.
 *
 * Driven by a prop rather than by the model's own change events, unlike the
 * flavor linters: what gets validated is the *assembled* document (see
 * `pretextDiagnostics.ts`), and only `Editors` can build that. It therefore
 * lags the buffer by the editor's own 500ms content debounce, which is the
 * same staleness the live preview has always had and is invisible next to the
 * debounce below.
 */

import { useEffect, type RefObject } from "react";
import {
  computePretextMarkers,
  PRETEXT_MARKER_OWNER,
  type PretextValidationInput,
} from "./pretextDiagnostics";

/** How long to wait after the assembled document settles before re-linting. */
const DEBOUNCE_MS = 400;

export function usePretextDiagnostics(
  monacoRef: RefObject<any>,
  editorRef: RefObject<any>,
  /** The texts to validate, or undefined to publish nothing (non-PreTeXt). */
  input: PretextValidationInput | undefined,
  /** Flips true once `handleEditorMount` has populated the refs. */
  isMounted: boolean,
): void {
  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel?.();
    if (!isMounted || !monaco || !model) return;

    const clear = () => {
      if (!model.isDisposed?.()) {
        monaco.editor.setModelMarkers(model, PRETEXT_MARKER_OWNER, []);
      }
    };

    if (!input) {
      clear();
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      let markers: any[];
      try {
        markers = await computePretextMarkers(monaco, input);
      } catch {
        // A linter failure must never take the editor down with it. Leave the
        // previous markers alone and try again on the next edit.
        return;
      }
      // The buffer may have switched divisions (or unmounted) while the
      // validator was working; publishing now would strand markers describing
      // source that is no longer on screen.
      if (cancelled || model.isDisposed?.()) return;
      monaco.editor.setModelMarkers(model, PRETEXT_MARKER_OWNER, markers);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, input]);

  // No unmount cleanup: markers belong to the model, and Monaco disposes the
  // model with the editor. Switching *away* from PreTeXt keeps the editor
  // alive, but that arrives here as `input === undefined`, which the effect
  // above clears.
}
