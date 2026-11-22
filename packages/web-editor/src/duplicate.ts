/**
 * Duplicating a record: a new division, snippet, exercise or asset that starts
 * as a copy of an existing one, under a ref and title the author chooses (see
 * `create/DuplicateForm.tsx`). The pure parts live here; the host requests and
 * pool writes are `handleDuplicate` in `Editors.tsx`.
 */
import { dedupeXmlIds, type XmlIdRename } from "@pretextbook/import";
import type { Asset } from "./types/editor";
import type { Division } from "./types/sections";
import { generatorFor } from "./generators";
import { parseDivisionRefEntries } from "./sectionUtils";

/**
 * Which kinds of record the host can duplicate — each needs the host's
 * creation hook for its kind, and most an update hook to give the new record
 * its source. An asset counts three ways because each is created differently:
 * a file asset re-uploads the original's bytes, an authored one is created
 * empty, a generated one is created in its generator's format.
 */
export interface DuplicateSupport {
  division: boolean;
  snippet: boolean;
  exercise: boolean;
  fileAsset: boolean;
  authoredAsset: boolean;
  generatedAsset: boolean;
}

export const NO_DUPLICATE_SUPPORT: DuplicateSupport = {
  division: false,
  snippet: false,
  exercise: false,
  fileAsset: false,
  authoredAsset: false,
  generatedAsset: false,
};

/** Whether `asset` can be duplicated, by how an asset of its kind is created. */
export function canDuplicateAsset(asset: Asset, support: DuplicateSupport): boolean {
  if (!asset.ref) return false;
  if (generatorFor(asset.sourceFormat)) return support.generatedAsset;
  // A file asset's copy is made from its bytes, fetched from its URL.
  if (asset.isFile) return support.fileAsset && !!asset.url;
  return support.authoredAsset;
}

/**
 * Whether `division` can be duplicated: not the root, and holding no child
 * divisions. A child is placed by a `<plus:* ref/>` in its parent's body, so
 * a copied body would place every child a second time, under the same ids —
 * copying a whole subtree is a different operation. A commented-out child
 * counts too: uncommenting it in the copy would do the same.
 */
export function canDuplicateDivision(division: Division, isRoot: boolean): boolean {
  if (isRoot) return false;
  return parseDivisionRefEntries(division.source, division.sourceFormat).length === 0;
}

/** The title a copy is offered: the original's, marked as a copy. */
export function copyTitle(title: string | undefined): string {
  const trimmed = (title ?? "").trim();
  return trimmed ? `${trimmed} (copy)` : "";
}

export interface CopiedSource {
  source: string;
  /** The `xml:id`s inside the source renamed to keep them unique. */
  renamed: XmlIdRename[];
}

/**
 * The source a copy starts with. A PreTeXt source may name things inside it
 * (`<task xml:id>`, a labelled equation) and a copy would repeat every one of
 * those names, which PreTeXt reports once both are in the document — so those
 * the project already uses are renamed, with the cross-references inside the
 * copy that point at them (the same pass the Import dialog makes). Other
 * formats are copied as they are: a generator's source is its own vocabulary,
 * and LaTeX and Markdown name things in syntax this pass doesn't read.
 *
 * `format` is the record's source format; `undefined` is PreTeXt, as it is for
 * an asset or exercise that predates the field.
 */
export function copySource(
  source: string,
  format: string | undefined,
  takenIds: ReadonlySet<string>,
  newRef: string,
): CopiedSource {
  if ((format ?? "pretext") !== "pretext" || !source.includes("xml:id")) {
    return { source, renamed: [] };
  }
  const result = dedupeXmlIds(source, {
    takenIds: new Set([...takenIds, newRef]),
    fragmentRef: newRef,
  });
  return { source: result.source, renamed: result.renamed };
}

const XML_ID = /\bxml:id\s*=\s*(["'])([^"']+)\1/g;

/**
 * Every name a new `xml:id` must avoid: every record's ref, and every
 * `xml:id` written inside any record's source.
 */
export function projectXmlIds(pools: {
  divisions?: readonly Division[] | null;
  projectAssets?: readonly Asset[] | null;
  projectSnippets?: readonly { ref: string; source: string }[] | null;
  projectExercises?: readonly { ref: string; source: string }[] | null;
}): Set<string> {
  const ids = new Set<string>();
  const add = (ref: string | undefined, source: string | undefined) => {
    if (ref) ids.add(ref);
    for (const match of (source ?? "").matchAll(XML_ID)) ids.add(match[2]);
  };
  for (const d of pools.divisions ?? []) add(d.xmlId, d.source);
  for (const a of pools.projectAssets ?? []) add(a.ref, a.source);
  for (const s of pools.projectSnippets ?? []) add(s.ref, s.source);
  for (const e of pools.projectExercises ?? []) add(e.ref, e.source);
  return ids;
}
