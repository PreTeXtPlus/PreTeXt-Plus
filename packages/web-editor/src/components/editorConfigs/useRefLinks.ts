/**
 * Makes the open buffer's `<plus:* ref/>` placeholders Ctrl/Cmd+clickable,
 * opening what each names (see `refLinks.ts`).
 */

import { useEffect, useRef, type RefObject } from "react";
import { isSourceFormat, type EditorLanguage } from "../../types/editor";
import { findRefLinks, refLinkProviderLinks, type RefTargetKind } from "./refLinks";

const KINDS: ReadonlySet<string> = new Set<RefTargetKind>(["division", "snippet", "exercise", "asset"]);

export function useRefLinks(
  monacoRef: RefObject<any>,
  editorRef: RefObject<any>,
  /** Flips true once `handleEditorMount` has populated the refs. */
  isMounted: boolean,
  /** The open buffer's language; only a prose format has placeholders. */
  language: EditorLanguage,
  /** Every Monaco language a buffer may be in. */
  languageIds: readonly string[],
  /** Open what a placeholder names; no links without it. */
  onOpen: ((kind: RefTargetKind, ref: string) => void) | undefined,
): void {
  const languageRef = useRef(language);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    languageRef.current = language;
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!isMounted || !monaco || !editor) return;

    // A keybinding of 0 gives a command id a link can name without binding a
    // key. Monaco passes a services accessor first, then the URI's arguments.
    const openCommandId: string = editor.addCommand(0, (...args: unknown[]) => {
      const [kind, ref] = args.slice(1).flat() as [unknown, unknown];
      if (typeof kind !== "string" || !KINDS.has(kind) || typeof ref !== "string") return;
      onOpenRef.current?.(kind as RefTargetKind, ref);
    });

    const providers = [...new Set(languageIds)].map((languageId) =>
      monaco.languages.registerLinkProvider(languageId, {
        provideLinks: (model: any) => {
          const language = languageRef.current;
          // Providers are per language, so every mounted editor's is asked
          // about every model; each answers only for its own.
          if (
            !onOpenRef.current ||
            !isSourceFormat(language) ||
            model !== editorRef.current?.getModel?.()
          ) {
            return { links: [] };
          }
          const links = findRefLinks(model.getValue(), language);
          return { links: refLinkProviderLinks(model, links, openCommandId) };
        },
      }),
    );
    return () => providers.forEach((provider) => provider.dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, languageIds.join("\u0000")]);
}
