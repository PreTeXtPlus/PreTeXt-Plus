/**
 * The unified project-asset view: a single join of the two things the editor
 * tracks for assets, which can otherwise drift apart —
 *
 *   1. `<plus:KIND ref="..."/>` placeholders parsed out of division content
 *      (what the document *references*), and
 *   2. the DB-backed project-asset pool (what actually *exists*).
 *
 * Both the TOC sidebar and the asset manager render from this view so the two
 * surfaces always agree, and so every reference carries an explicit status the
 * UI can act on (link an unresolved ref, copy the embed code for an unused
 * asset, etc.).
 */
import type { Asset, AssetKind } from "./types/editor";
import type { Division } from "./types/sections";
import { parseAssetRefs } from "./sectionUtils";

/**
 * The reconciliation state of one asset reference:
 *   - `linked`   — referenced in the document *and* backed by a project asset.
 *   - `unlinked` — referenced in the document but with no backing asset (a
 *                  hand-typed or renamed ref that needs an asset chosen for it).
 *   - `unused`   — a project asset not referenced anywhere in the document yet
 *                  (just added; its embed code is waiting to be pasted).
 */
export type AssetStatus = "linked" | "unlinked" | "unused";

/** One row of the joined project-asset view, keyed by `kind` + `ref`. */
export interface AssetRow {
  kind: AssetKind;
  ref: string;
  /** The backing project asset, when one exists (`linked` / `unused`). */
  asset?: Asset;
  /** Whether a `<plus:KIND ref/>` placeholder for this row exists in source. */
  inDocument: boolean;
  status: AssetStatus;
}

/**
 * Build the joined asset view for a project: the union of every placeholder
 * referenced across all divisions and every asset in the project pool, keyed by
 * `kind:ref`, in a stable order (document references first in document order,
 * then any remaining unused assets).
 */
export function buildProjectAssetView(
  divisions: Division[] | undefined,
  projectAssets: Asset[] | undefined,
): AssetRow[] {
  const assets = projectAssets ?? [];
  const findAsset = (kind: AssetKind, ref: string) =>
    assets.find((a) => a.kind === kind && a.ref === ref);

  const rows: AssetRow[] = [];
  const seen = new Set<string>();

  // 1. Document references, in document order, deduplicated across divisions.
  for (const division of divisions ?? []) {
    for (const { kind, ref } of parseAssetRefs(division.source, division.sourceFormat)) {
      const key = `${kind}:${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const asset = findAsset(kind, ref);
      rows.push({
        kind,
        ref,
        asset,
        inDocument: true,
        status: asset ? "linked" : "unlinked",
      });
    }
  }

  // 2. Project assets not referenced anywhere yet — "unused".
  for (const asset of assets) {
    if (!asset.ref) continue;
    const key = `${asset.kind}:${asset.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      kind: asset.kind,
      ref: asset.ref,
      asset,
      inDocument: false,
      status: "unused",
    });
  }

  return rows;
}

/**
 * Produce a ref derived from `base` that doesn't collide with anything already
 * in use — used when duplicating an asset. Tries `base-copy`, then
 * `base-copy-2`, `base-copy-3`, … against the supplied set of taken refs.
 */
export function makeUniqueAssetRef(base: string, taken: ReadonlySet<string>): string {
  const candidate = `${base}-copy`;
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; ; n++) {
    const next = `${candidate}-${n}`;
    if (!taken.has(next)) return next;
  }
}
