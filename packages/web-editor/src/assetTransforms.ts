/**
 * Per-kind transforms from a resolved project {@link Asset} into the real
 * PreTeXt markup that replaces its `<plus:KIND ref="..."/>` placeholder.
 *
 * Adding a new `AssetKind` means adding one function here and one entry in
 * {@link ASSET_TRANSFORMS} — nothing else in the resolution pipeline
 * (`resolveAssetRef` in sectionUtils.ts) needs to change.
 */
import { escapeAttribute } from "./xmlUtils";
import type { Asset, AssetKind } from "./types/editor";

/** Produces the PreTeXt markup for one resolved asset. */
type AssetTransform = (asset: Asset, ref: string, width?: string) => string;

/**
 * `<image>` markup for an image asset.
 *
 * File-based assets (`isFile`) get a `source` attribute set to the asset's
 * own `fileRef` -- the server-computed "ref.ext" filename (the placeholder's
 * `ref` plus an extension inferred from the file's content type; see
 * `Asset#external_filename` server-side). The server is the single source of
 * truth for this filename everywhere it's used -- this document, the
 * download archive's `external/` directory, and EPUB cover selection all
 * derive it the same way, so there's nothing left to guess or reconstruct
 * here. Non-file assets carry no `source` attribute at all; they're defined
 * entirely by their authored `source` content (e.g. a hand-written
 * `<asymptote>`/`<latex-image>` body).
 *
 * `asset.source` is the user-authored inner XML (`<shortdescription>`,
 * `<description>`, etc.) and is inserted verbatim as the element's children.
 *
 * `width` comes from the placeholder's own `width="..."` attribute (e.g.
 * `<plus:image ref="..." width="50%"/>`) rather than from the asset itself,
 * since the same asset can be embedded at different widths in different
 * places.
 */
function transformImageAsset(asset: Asset, ref: string, width?: string): string {
  if (asset.isFile && !asset.fileRef && !asset.url) {
    return `<!-- image asset "${ref}" is marked as file-based but has no fileRef or url -->`;
  }
  const sourceAttr = asset.isFile
    ? ` source="${escapeAttribute(asset.fileRef || ref)}"`
    : "";
  const widthAttr = width ? ` width="${escapeAttribute(width)}"` : "";
  const inner = asset.source?.trim();
  return inner
    ? `<image${sourceAttr}${widthAttr}>\n${inner}\n</image>`
    : `<image${sourceAttr}${widthAttr}/>`;
}

/**
 * `<interactive>` markup for a Doenet activity asset.
 *
 * The outer element is left as a placeholder until the real Doenet
 * embedding markup is settled — fill that in directly when decided.
 * `asset.source` (the activity body) is already threaded through so only
 * the wrapper need change.
 */
function transformDoenetAsset(asset: Asset, ref: string): string {
  const inner = asset.source?.trim();
  return inner
    ? `<interactive xml:id="${escapeAttribute(ref)}">\n${inner}\n</interactive>`
    : `<interactive xml:id="${escapeAttribute(ref)}"></interactive>`;
}

/**
 * Registry of asset-kind -> markup transform. {@link resolveAssetRef} in
 * sectionUtils.ts is the only caller; it looks up the asset by `(kind, ref)`
 * and dispatches here.
 */
const ASSET_TRANSFORMS: Record<AssetKind, AssetTransform> = {
  image: transformImageAsset,
  doenet: transformDoenetAsset,
};

/** Tag names recognised as asset placeholders, derived from the registry above. */
export const ASSET_KINDS: ReadonlySet<AssetKind> = new Set(
  Object.keys(ASSET_TRANSFORMS) as AssetKind[],
);

/**
 * Resolve a single `<plus:KIND ref="..."/>` asset placeholder to its final
 * PreTeXt markup by looking up the matching {@link Asset} in `assets` and
 * dispatching to its kind's transform. Falls back to an XML comment if no
 * matching asset is found, so a stale/typo'd ref fails loudly in the
 * assembled source rather than silently vanishing.
 */
export function resolveAssetRef(
  kind: AssetKind,
  ref: string,
  assets: Asset[],
  width?: string,
): string {
  const asset = assets.find((a) => a.kind === kind && a.ref === ref);
  if (!asset) return `<!-- missing asset: ${kind} ${ref} -->`;
  return ASSET_TRANSFORMS[kind](asset, ref, width);
}
