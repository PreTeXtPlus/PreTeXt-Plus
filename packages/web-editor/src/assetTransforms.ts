/**
 * Transform a resolved project {@link Asset} into the real PreTeXt markup
 * that replaces its `<plus:image ref="..."/>` placeholder.
 */
import { escapeAttribute, escapeText } from "./xmlUtils";
import type { Asset } from "./types/editor";

/**
 * `<image>` markup for an asset.
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
 * `asset.shortDescription` (plain text) is auto-rendered as a `<shortdescription>`
 * element and always placed first, per PreTeXt's accessibility convention.
 * `asset.source` is separate user-authored inner XML (e.g. `<description>`)
 * and is inserted verbatim after it as the element's remaining children.
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
  const shortDescription = asset.shortDescription?.trim();
  const shortDescriptionTag = shortDescription
    ? `<shortdescription>${escapeText(shortDescription)}</shortdescription>`
    : "";
  const inner = [ shortDescriptionTag, asset.source?.trim() ].filter(Boolean).join("\n");
  return inner
    ? `<image${sourceAttr}${widthAttr}>\n${inner}\n</image>`
    : `<image${sourceAttr}${widthAttr}/>`;
}

/**
 * Resolve a single `<plus:image ref="..."/>` asset placeholder to its final
 * PreTeXt markup by looking up the matching {@link Asset} in `assets`. Falls
 * back to an XML comment if no matching asset is found, so a stale/typo'd
 * ref fails loudly in the assembled source rather than silently vanishing.
 */
export function resolveAssetRef(
  ref: string,
  assets: Asset[],
  width?: string,
): string {
  const asset = assets.find((a) => a.ref === ref);
  if (!asset) return `<!-- missing asset: ${ref} -->`;
  return transformImageAsset(asset, ref, width);
}
