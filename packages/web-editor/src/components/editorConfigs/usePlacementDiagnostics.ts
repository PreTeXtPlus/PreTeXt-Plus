/**
 * Keeps the open buffer's placement markers (see `placementDiagnostics.ts`) in
 * step with its text, and offers the quick fix that names a placement.
 *
 * Unlike the schema linter this reads the model's live text, not the
 * assembled document: the check is a scan of placeholders, cheap enough to run
 * as the author types, and the fix edits the very text it reads.
 */

import { useEffect, useRef, type RefObject } from "react";
import {
  findPlacementProblems,
  PLACEMENT_MARKER_OWNER,
  PLACEMENT_MARKER_SOURCE,
  placementFix,
  placementMarkers,
  type PlacementCheckInput,
} from "./placementDiagnostics";

/** How long typing must settle before the placeholders are re-scanned. */
const DEBOUNCE_MS = 250;

export function usePlacementDiagnostics(
  monacoRef: RefObject<any>,
  editorRef: RefObject<any>,
  /** The project's placements around the open buffer, or undefined to check nothing. */
  input: PlacementCheckInput | undefined,
  /** Flips true once `handleEditorMount` has populated the refs. */
  isMounted: boolean,
  /** Every Monaco language a buffer may be in, for the quick fix. */
  languageIds: readonly string[],
): void {
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel?.();
    if (!isMounted || !monaco || !model) return;

    const publish = () => {
      if (model.isDisposed?.()) return;
      const problems = input ? findPlacementProblems(model.getValue(), input) : [];
      monaco.editor.setModelMarkers(model, PLACEMENT_MARKER_OWNER, placementMarkers(monaco, model, problems));
    };
    publish();
    if (!input) return;

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
  }, [isMounted, input]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!isMounted || !monaco) return;
    const providers = [...new Set(languageIds)].map((languageId) =>
      monaco.languages.registerCodeActionProvider(languageId, {
        provideCodeActions: (model: any, _range: any, context: any) => {
          const actions: any[] = [];
          const input = inputRef.current;
          // Only the editor's own buffer is checked; another model in the
          // same language (a diff, say) has no placements context.
          if (input && model === editorRef.current?.getModel?.()) {
            for (const marker of context?.markers ?? []) {
              if (marker.source !== PLACEMENT_MARKER_SOURCE) continue;
              const fix = placementFix(model, input, marker);
              if (!fix) continue;
              const start = model.getPositionAt(fix.index);
              const end = model.getPositionAt(fix.index + fix.length);
              actions.push({
                title: `Name this placement "${fix.instance}"`,
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
      }),
    );
    return () => providers.forEach((provider) => provider.dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, languageIds.join("\u0000")]);
}
