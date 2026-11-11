/**
 * Keeps the open buffer's interactive markers (see `interactiveDiagnostics.ts`)
 * in step with its text, and offers the quick fix for a CalcPlot3D interactive
 * with no variant. The same shape as `usePlacementDiagnostics`, for the same
 * reason: a scan of the live text, cheap enough to run as the author types.
 */

import { useEffect, type RefObject } from "react";
import {
  calcplot3dVariantFix,
  DEFAULT_CALCPLOT3D_VARIANT,
  findInteractiveProblems,
  INTERACTIVE_MARKER_OWNER,
  INTERACTIVE_MARKER_SOURCE,
  interactiveMarkers,
  type InteractiveCheckInput,
} from "./interactiveDiagnostics";

/** How long typing must settle before the interactives are re-scanned. */
const DEBOUNCE_MS = 250;

export function useInteractiveDiagnostics(
  monacoRef: RefObject<any>,
  editorRef: RefObject<any>,
  /** What to check against, or undefined to check nothing (not PreTeXt). */
  input: InteractiveCheckInput | undefined,
  /** Flips true once `handleEditorMount` has populated the refs. */
  isMounted: boolean,
  /** The Monaco language of a PreTeXt buffer, for the quick fix. */
  languageId: string,
): void {
  const hasStaticOutput = input?.hasStaticOutput;

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel?.();
    if (!isMounted || !monaco || !model) return;

    const publish = () => {
      if (model.isDisposed?.()) return;
      const problems =
        hasStaticOutput === undefined
          ? []
          : findInteractiveProblems(model.getValue(), { hasStaticOutput });
      monaco.editor.setModelMarkers(
        model,
        INTERACTIVE_MARKER_OWNER,
        interactiveMarkers(monaco, model, problems),
      );
    };
    publish();
    if (hasStaticOutput === undefined) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = model.onDidChangeContent(() => {
      clearTimeout(timer);
      timer = setTimeout(publish, DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      listener.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, hasStaticOutput]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!isMounted || !monaco) return;
    const provider = monaco.languages.registerCodeActionProvider(languageId, {
      provideCodeActions: (model: any, _range: any, context: any) => {
        const actions: any[] = [];
        // Only the editor's own buffer: another model in the same language
        // has markers of its own, if any.
        if (model === editorRef.current?.getModel?.()) {
          for (const marker of context?.markers ?? []) {
            if (marker.source !== INTERACTIVE_MARKER_SOURCE) continue;
            const fix = calcplot3dVariantFix(model, marker);
            if (!fix) continue;
            const start = model.getPositionAt(fix.index);
            const end = model.getPositionAt(fix.index + fix.length);
            actions.push({
              title: `Add variant="${DEFAULT_CALCPLOT3D_VARIANT}"`,
              kind: "quickfix",
              isPreferred: true,
              diagnostics: [marker],
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
                      text: fix.text,
                    },
                  },
                ],
              },
            });
          }
        }
        return { actions, dispose: () => {} };
      },
    });
    return () => provider.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, languageId]);
}
