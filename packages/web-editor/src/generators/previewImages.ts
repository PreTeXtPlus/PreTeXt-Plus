/**
 * Pointing the live document preview at generated assets' stored pictures.
 *
 * PreTeXt's HTML refers to a generated image as `generated/<element>/<label>.svg`,
 * a file a real build writes and the browser preview never has. The preview
 * page would resolve that against the host page (the Rails host routes the plain
 * `<label>` to the stored picture), but a placement named by an `instance`
 * carries a qualified label (`graph-ch3`, see `qualifyIdentifiers`) nothing
 * serves, and a URL that never changes is one a browser may keep showing after
 * the picture has. So the preview's HTML is rewritten to the asset's own URL,
 * versioned by the digest the picture was rendered from.
 */
import type { Asset } from "../types/editor";
import { generatorFor } from "./index";

/** Resolves a generated image's element and label to a URL, or undefined to leave it. */
export type GeneratedImageResolver = (element: string, label: string) => string | undefined;

const GENERATED_IMAGE_PATH = /(=\s*["'])generated\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.svg(["'])/g;

/**
 * An Asymptote figure as pretext-html writes it: not an `<img>` but an iframe
 * onto the `.html` page `asy` makes, in a box whose padding keeps the aspect
 * ratio read off that page (`image[asymptote]` in pretext-html.xsl). The
 * preview has no such page — the stored picture is the SVG lifted out of it —
 * so the whole box becomes the `<img>` a sageplot gets. Tolerant of the
 * serializer's whitespace and of a self-closed iframe.
 */
const ASYMPTOTE_BOX =
  /<div class="asymptote-box"[^>]*>\s*<iframe\b([^>]*?)\s*\/?>(?:\s*<\/iframe>)?\s*<\/div>/g;
const ASYMPTOTE_SRC = /\bsrc=["']generated\/asymptote\/([A-Za-z0-9_-]+)\.html["']/;
const IFRAME_TITLE = /\btitle=("[^"]*"|'[^']*')/;

/** `html` with every generated-image reference `resolve` knows replaced by its URL. */
export function rewriteGeneratedImages(html: string, resolve: GeneratedImageResolver): string {
  return html
    .replace(ASYMPTOTE_BOX, (whole, attributes: string) => {
      const label = ASYMPTOTE_SRC.exec(attributes)?.[1];
      const url = label && resolve("asymptote", label);
      if (!url) return whole;
      const title = IFRAME_TITLE.exec(attributes)?.[1];
      return `<img src="${url}" role="img" class="contained"${title ? ` alt=${title}` : ""}>`;
    })
    .replace(GENERATED_IMAGE_PATH, (whole, open: string, element: string, label: string, close: string) => {
      const url = resolve(element, label);
      return url ? `${open}${url}${close}` : whole;
    });
}

/**
 * The resolver for `assets`: the generated asset, wrapped in `element`, whose
 * ref the label is — or which the label extends with `-<instance>`. Refs and
 * instance names may both contain `-`, so the longest such ref wins; the
 * placement check keeps a qualified label from equalling another record's ref,
 * which is what makes that the placement's own record. Only an asset with a
 * stored picture resolves.
 */
export function generatedImageResolver(assets: readonly Asset[]): GeneratedImageResolver {
  return (element, label) => {
    let match: Asset | undefined;
    for (const asset of assets) {
      const ref = asset.ref;
      if (!ref || !asset.url || generatorFor(asset.sourceFormat)?.element !== element) continue;
      if (label !== ref && !label.startsWith(`${ref}-`)) continue;
      if (!match || ref.length > (match.ref ?? "").length) match = asset;
    }
    if (!match?.url) return undefined;
    const digest = match.previewInputDigest;
    if (!digest) return match.url;
    return `${match.url}${match.url.includes("?") ? "&" : "?"}v=${digest.slice(0, 16)}`;
  };
}
