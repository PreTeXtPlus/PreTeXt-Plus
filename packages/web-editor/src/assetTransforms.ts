/**
 * Transform a resolved project {@link Asset} into the real PreTeXt markup
 * that replaces its `<plus:image ref="..."/>` placeholder.
 */
import { escapeAttribute, escapeText } from "./xmlUtils";
import type { Asset } from "./types/editor";
import { generatorFor } from "./generators";

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
 * A *generated* asset (`asset.generator`) is always emitted in its source
 * form: its source wrapped by the generator's element (`<prefigure label="ref">`),
 * inside a plain `<image>`. That is true PreTeXt a build can regenerate from;
 * the stored output ships beside the archive under the same name and is never
 * referenced from the document, so no target-dependent branch is needed here.
 *
 * Per-embedding attributes such as `width="50%"` are NOT handled here: they
 * are written on the placeholder (`<plus:image ref="..." width="50%"/>`) and
 * copied onto the `<image>` element this returns by `applyPlaceholderAttrs`
 * during assembly, so the same asset can be embedded with different
 * attributes in different places.
 */
function transformImageAsset(asset: Asset, ref: string): string {
  if (asset.isFile && !asset.fileRef && !asset.url) {
    return `<!-- image asset "${ref}" is marked as file-based but has no fileRef or url -->`;
  }
  const sourceAttr = imageSourceAttr(asset, ref);
  const inner = [ shortDescriptionTag(asset), generatedOrAuthoredSource(asset, ref) ]
    .filter(Boolean)
    .join("\n");
  return inner
    ? `<image${sourceAttr}>\n${inner}\n</image>`
    : `<image${sourceAttr}/>`;
}

/** The `<image>` element's ` source="..."` attribute, or `""` for a non-file asset. */
function imageSourceAttr(asset: Asset, ref: string): string {
  return asset.isFile && !asset.generator
    ? ` source="${escapeAttribute(asset.fileRef || ref)}"`
    : "";
}

/**
 * The asset's source as the `<image>` carries it: wrapped by its generator's
 * element for a generated asset, verbatim otherwise. A generated asset with an
 * unknown generator falls back to verbatim, which a schema check then reports
 * rather than this silently dropping the diagram.
 */
function generatedOrAuthoredSource(asset: Asset, ref: string): string | undefined {
  const source = asset.source?.trim();
  const generator = generatorFor(asset.generator);
  return generator ? generator.wrapSource(source ?? "", ref) : source;
}

/**
 * The lines of a generated asset's wrapper element, as the code editor shows
 * them locked around the source: the opening tag before, the closing after.
 */
function generatorWrapperLines(asset: Asset, ref: string): { before: string[]; after: string[] } {
  const generator = generatorFor(asset.generator);
  if (!generator) return { before: [], after: [] };
  // Wrap a marker and split around it, so this stays true to `wrapSource`
  // whatever shape a generator gives its element.
  const marker = "\u0000";
  const [before, after] = generator.wrapSource(marker, ref).split(marker);
  return {
    before: before.replace(/\n$/, "").split("\n"),
    after: after.replace(/^\n/, "").split("\n"),
  };
}

/** The auto-generated `<shortdescription>` child, or `""` when there's no alt text. */
function shortDescriptionTag(asset: Asset): string {
  const shortDescription = asset.shortDescription?.trim();
  return shortDescription
    ? `<shortdescription>${escapeText(shortDescription)}</shortdescription>`
    : "";
}

/**
 * The generated markup that surrounds an asset's authored `source` — the
 * `<image>` opening tag (plus its `<shortdescription>` child, when there's alt
 * text) and the closing `</image>` — as the lines the code editor shows, locked,
 * around the source while the asset is open. Built from the same pieces as
 * {@link transformImageAsset}, so what the author sees is what gets assembled.
 */
export function assetWrapperLines(asset: Asset): {
  before: string[];
  after: string[];
} {
  const ref = asset.ref ?? "";
  const opening = `<image${imageSourceAttr(asset, ref)}>`;
  const shortDescription = shortDescriptionTag(asset);
  const wrapper = generatorWrapperLines(asset, ref);
  return {
    before: [opening, ...(shortDescription ? [shortDescription] : []), ...wrapper.before],
    after: [...wrapper.after, "</image>"],
  };
}

/**
 * Resolve a single `<plus:image ref="..."/>` asset placeholder to its final
 * PreTeXt markup by looking up the matching {@link Asset} in `assets`. Falls
 * back to an XML comment if no matching asset is found, so a stale/typo'd
 * ref fails loudly in the assembled source rather than silently vanishing.
 */
export function resolveAssetRef(ref: string, assets: Asset[]): string {
  const asset = assets.find((a) => a.ref === ref);
  if (!asset) return `<!-- missing asset: ${ref} -->`;
  return transformImageAsset(asset, ref);
}
