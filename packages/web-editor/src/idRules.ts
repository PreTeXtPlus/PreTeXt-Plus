import type { Asset, Exercise, Snippet } from "./types/editor";
import type { Division } from "./types/sections";

/**
 * Every ref in the project. Refs are one namespace across divisions, assets,
 * snippets and exercises — the project's records all resolve `<plus:* ref/>`
 * placeholders against it — so a ref, new or renamed, must avoid all of these.
 */
export function projectRefs(pools: {
  divisions?: Division[] | null;
  projectAssets?: Asset[] | null;
  projectSnippets?: Snippet[] | null;
  projectExercises?: Exercise[] | null;
}): Set<string> {
  return new Set<string>([
    ...(pools.divisions ?? []).map((d) => d.xmlId),
    ...(pools.projectAssets ?? []).flatMap((a) => (a.ref ? [a.ref] : [])),
    ...(pools.projectSnippets ?? []).map((s) => s.ref),
    ...(pools.projectExercises ?? []).map((e) => e.ref),
  ]);
}

// What the author is told about an ID they typed, worded the same in every
// form and settings drawer.
export const ID_REQUIRED_MESSAGE = "ID can't be empty.";
export const idTakenMessage = (id: string) =>
  `"${id}" is already used in this project. Choose a different ID.`;
