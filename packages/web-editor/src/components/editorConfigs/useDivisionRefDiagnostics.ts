/**
 * Keeps the open buffer's missing-division markers (see
 * `divisionRefDiagnostics.ts`) in step with its text, and offers the quick fix
 * that creates the division a placeholder names.
 *
 * Like the placement check, this reads the model's live text: it is a scan of
 * placeholders, cheap enough to run as the author types.
 */

import { useEffect, useRef, type RefObject } from "react";
import type { DivisionType } from "../../types/sections";
import {
  DIVISION_REF_MARKER_OWNER,
  DIVISION_REF_MARKER_SOURCE,
  divisionRefFix,
  divisionRefMarkers,
  findDivisionRefProblems,
  type DivisionRefCheckInput,
} from "./divisionRefDiagnostics";

/** How long typing must settle before the placeholders are re-scanned. */
const DEBOUNCE_MS = 400;

export function useDivisionRefDiagnostics(
  monacoRef: RefObject<any>,
  editorRef: RefObject<any>,
  /** The project's refs, or undefined to check nothing. */
  input: DivisionRefCheckInput | undefined,
  /** Flips true once `handleEditorMount` has populated the refs. */
  isMounted: boolean,
  /** Every Monaco language a buffer may be in, for the quick fix. */
  languageIds: readonly string[],
  /** Create the division a placeholder names; no quick fix without it. */
  onCreate: ((xmlId: string, type: DivisionType) => void) | undefined,
): void {
  const inputRef = useRef(input);
  const onCreateRef = useRef(onCreate);
  useEffect(() => {
    inputRef.current = input;
    onCreateRef.current = onCreate;
  });

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel?.();
    if (!isMounted || !monaco || !model) return;

    const publish = () => {
      if (model.isDisposed?.()) return;
      const problems = input ? findDivisionRefProblems(model.getValue(), input) : [];
      monaco.editor.setModelMarkers(model, DIVISION_REF_MARKER_OWNER, divisionRefMarkers(monaco, model, problems));
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
    const editor = editorRef.current;
    if (!isMounted || !monaco || !editor) return;

    // A keybinding of 0 gives a command id a code action can name without
    // binding a key. Monaco passes a services accessor first, then the action's
    // `arguments` (spread or as one array, depending on the build).
    const createCommandId: string = editor.addCommand(0, (...args: unknown[]) => {
      const [xmlId, type] = args.slice(1).flat() as [unknown, unknown];
      if (typeof xmlId !== "string" || typeof type !== "string") return;
      onCreateRef.current?.(xmlId, type as DivisionType);
    });

    const providers = [...new Set(languageIds)].map((languageId) =>
      monaco.languages.registerCodeActionProvider(languageId, {
        provideCodeActions: (model: any, _range: any, context: any) => {
          const actions: any[] = [];
          const input = inputRef.current;
          if (input && onCreateRef.current && model === editorRef.current?.getModel?.()) {
            for (const marker of context?.markers ?? []) {
              if (marker.source !== DIVISION_REF_MARKER_SOURCE) continue;
              const fix = divisionRefFix(model, input, marker);
              if (!fix) continue;
              actions.push({
                title: `Create division "${fix.xmlId}"`,
                kind: "quickfix",
                isPreferred: true,
                diagnostics: [marker],
                command: { id: createCommandId, title: "Create division", arguments: [fix.xmlId, fix.type] },
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
