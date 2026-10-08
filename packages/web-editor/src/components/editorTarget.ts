import type { Asset, Snippet } from "../types/editor";
import type { Division } from "../types/sections";
import type { OpenItem } from "../store/editorStore";

/** The record the code editor is showing — {@link OpenItem}, resolved. */
export type EditorTarget =
  | { kind: "division"; division: Division }
  | { kind: "snippet"; snippet: Snippet }
  | { kind: "asset"; asset: Asset };

/**
 * Resolve the open item against the project's pools. An item that no longer
 * resolves — a peer just removed it, or its ref is mid-rename — reads as the
 * root division, so the editor always has something to show. `null` only when
 * the project has no divisions at all.
 */
export function resolveEditorTarget(
  openItem: OpenItem,
  divisions: Division[],
  snippets: Snippet[] | undefined,
  assets: Asset[] | undefined,
  rootDivision: Division | null,
): EditorTarget | null {
  if (openItem.kind === "snippet") {
    const snippet = snippets?.find((s) => s.ref === openItem.ref);
    if (snippet) return { kind: "snippet", snippet };
  } else if (openItem.kind === "asset") {
    const asset = assets?.find((a) => a.ref === openItem.ref);
    if (asset) return { kind: "asset", asset };
  } else {
    const division = divisions.find((d) => d.xmlId === openItem.ref);
    if (division) return { kind: "division", division };
  }
  const fallback = rootDivision ?? divisions[0];
  return fallback ? { kind: "division", division: fallback } : null;
}

/**
 * A stable identity for the target's buffer: collab cursor scoping, error
 * boundary resets, and the per-buffer autosave all key on it.
 */
export const editorTargetKey = (target: EditorTarget | null): string =>
  !target
    ? ""
    : target.kind === "division"
      ? target.division.xmlId
      : target.kind === "snippet"
        ? `snippet:${target.snippet.id ?? target.snippet.ref}`
        : `asset:${target.asset.id ?? target.asset.ref ?? ""}`;
