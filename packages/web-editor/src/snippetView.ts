/**
 * The unified project-snippet view: a single join of the two things the
 * editor tracks for snippets, which can otherwise drift apart —
 *
 *   1. `<plus:snippet ref="..."/>` placeholders parsed out of division content
 *      (what the document *references*), and
 *   2. the DB-backed project-snippet pool (what actually *exists*).
 *
 * Mirrors `assetView.ts` exactly — see there for the reasoning behind the
 * joined-row shape.
 */
import type { Snippet } from "./types/editor";
import type { Division } from "./types/sections";
import { parseSnippetRefs } from "./sectionUtils";

/**
 * The reconciliation state of one snippet reference:
 *   - `linked`   — referenced in the document *and* backed by a project snippet.
 *   - `unlinked` — referenced in the document but with no backing snippet.
 *   - `unused`   — a project snippet not referenced anywhere in the document yet.
 */
export type SnippetStatus = "linked" | "unlinked" | "unused";

/** One row of the joined project-snippet view, keyed by `ref`. */
export interface SnippetRow {
  ref: string;
  /** The backing project snippet, when one exists (`linked` / `unused`). */
  snippet?: Snippet;
  /** Whether a `<plus:snippet ref/>` placeholder for this row exists in source. */
  inDocument: boolean;
  status: SnippetStatus;
}

/**
 * Build the joined snippet view for a project: the union of every placeholder
 * referenced across all divisions and every snippet in the project pool, keyed
 * by `ref`, in a stable order (document references first in document order,
 * then any remaining unused snippets).
 */
export function buildProjectSnippetView(
  divisions: Division[] | undefined,
  projectSnippets: Snippet[] | undefined,
): SnippetRow[] {
  const snippets = projectSnippets ?? [];
  const findSnippet = (ref: string) => snippets.find((s) => s.ref === ref);

  const rows: SnippetRow[] = [];
  const seen = new Set<string>();

  for (const division of divisions ?? []) {
    for (const { ref } of parseSnippetRefs(division.source, division.sourceFormat)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const snippet = findSnippet(ref);
      rows.push({
        ref,
        snippet,
        inDocument: true,
        status: snippet ? "linked" : "unlinked",
      });
    }
  }

  for (const snippet of snippets) {
    if (!snippet.ref) continue;
    if (seen.has(snippet.ref)) continue;
    seen.add(snippet.ref);
    rows.push({
      ref: snippet.ref,
      snippet,
      inDocument: false,
      status: "unused",
    });
  }

  return rows;
}

/**
 * Produce a ref derived from `base` that doesn't collide with anything already
 * in use — used when duplicating a snippet. Mirrors `makeUniqueAssetRef`.
 */
export function makeUniqueSnippetRef(base: string, taken: ReadonlySet<string>): string {
  const candidate = `${base}-copy`;
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; ; n++) {
    const next = `${candidate}-${n}`;
    if (!taken.has(next)) return next;
  }
}
