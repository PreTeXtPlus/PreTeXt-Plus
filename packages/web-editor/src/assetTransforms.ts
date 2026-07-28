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

/** Maps image MIME types to a file extension, used when neither `fileRef` nor `url` carries one. */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

/** Pulls a bare extension (no dot) off the path portion of a filename or URL. */
function extensionOf(value: string): string | undefined {
  const path = value.split(/[?#]/)[0];
  return /\.([a-zA-Z0-9]+)$/.exec(path)?.[1];
}

/**
 * The file extension for a file-backed image asset, preferring whatever
 * extension is already present on `fileRef`/`url` and falling back to a
 * guess from `contentType`.
 */
function assetExtension(asset: Asset): string | undefined {
  return (
    (asset.fileRef && extensionOf(asset.fileRef)) ||
    (asset.url && extensionOf(asset.url)) ||
    (asset.contentType && EXTENSION_BY_CONTENT_TYPE[asset.contentType])
  );
}

/**
 * `<image>` markup for an image asset.
 *
 * File-based assets (`isFile`) get a `source` attribute built from the
 * placeholder's own `ref` plus a file extension — e.g. `<plus:image
 * ref="euler-painting"/>` with a PNG upload emits `source="euler-painting.png"`.
 * The extension is read off `asset.fileRef`/`asset.url` when one is present
 * there, or guessed from `asset.contentType` otherwise; the asset's
 * server-assigned `fileRef`/`url` value itself (e.g. a UUID-based storage
 * key) is never written into the document. Non-file assets carry no
 * `source` attribute at all; they're defined entirely by their authored
 * `source` content (e.g. a hand-written `<asymptote>`/`<latex-image>` body).
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
  const ext = asset.isFile ? assetExtension(asset) : undefined;
  const sourceAttr = asset.isFile
    ? ` source="${escapeAttribute(ext ? `${ref}.${ext}` : ref)}"`
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
