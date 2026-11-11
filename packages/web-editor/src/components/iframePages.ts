/**
 * Showing an interactive's iframe page in the live preview.
 *
 * PreTeXt draws an `<interactive platform="…">` (JSXGraph, GeoGebra, D3, Sage,
 * DoenetML, plain JavaScript) in a page of its own, framed from the document
 * as `<iframe src="<id>-if.html">`. The preview renderer has no file to write
 * that page to, so it returns the pages beside the HTML (`iframePages`), and
 * the iframes in the HTML name files that do not exist.
 *
 * Two steps put them on screen, split so that typing does not reload them:
 *
 * 1. {@link markIframePages}, on the HTML string before it is delivered: each
 *    such iframe loses its `src` — nothing must ever request it — and gains
 *    the page's name and a sandbox. The page's *text* is deliberately kept out
 *    of the HTML, so the live patcher sees an iframe that did not change when
 *    only something around it did, and leaves it running.
 * 2. {@link deliverIframePages}, on the live document after each delivery or
 *    patch: every marked iframe gets its page as `srcdoc`, but only when that
 *    differs from what the same element was last given.
 *
 * **The sandbox is the point.** An iframe page runs JavaScript the author
 * wrote, and in a shared project that is a collaborator's script. The preview
 * is same-origin with the editor, and an unsandboxed `srcdoc` frame inside it
 * would be too — with the session, the project's API and the editor's DOM in
 * reach. `allow-scripts` without `allow-same-origin` gives the page an opaque
 * origin: it runs, and can reach nothing of ours.
 *
 * **GeoGebra cannot run there.** Its loader (GWT) starts by writing into a
 * child frame's document, which an opaque origin may not do — measured, not
 * guessed: the applet stays on its loading picture. So an interactive that is
 * nothing but a GeoGebra material (`<interactive geogebra="ID"/>`, by far the
 * usual one) is framed from geogebra.org's own embed page instead, like a
 * Desmos graph: {@link geogebraMaterialUrl}. A GeoGebra interactive with more
 * to it (a local `.ggb`, a script of the author's) still gets its sandboxed
 * page, and will not load until pages can be served from an origin of their
 * own.
 */
import type { IframePages } from "@pretextbook/pretext-html/iframe-pages";
import { rewriteGeneratedImages, type GeneratedImageResolver } from "../generators/previewImages";

export type { IframePages };

/**
 * The sandbox every iframe page runs in. Never add `allow-same-origin`: with
 * `allow-scripts` beside it the page could remove its own sandbox. A platform
 * that cannot work from an opaque origin needs its pages served from another
 * origin, not a wider sandbox here.
 */
export const IFRAME_PAGE_SANDBOX = "allow-scripts";

/** The attribute a marked iframe carries: the name of the page it shows. */
export const IFRAME_PAGE_ATTRIBUTE = "data-ptx-iframe-page";

const IFRAME_TAG = /<iframe\b([^>]*)>/g;
const SRC_ATTRIBUTE = /\ssrc="([^"]*)"/;
const SANDBOX_ATTRIBUTE = /\ssandbox(?:="[^"]*")?/g;

/**
 * A GeoGebra applet's parameters as PreTeXt writes them when a material id is
 * all there is: no file, no base64, no `appletOnLoad` of the author's.
 */
const GEOGEBRA_MATERIAL_ONLY =
  /_params = \{\s*material_id:"([A-Za-z0-9]+)",\s*width:\d+,\s*height:\d+,?\s*\};/;

/**
 * geogebra.org's embed page for the material `page` shows, when showing that
 * one material is all the page does — else undefined. The embed fits itself
 * to whatever frame it is given, as the applet in PreTeXt's page does.
 */
export function geogebraMaterialUrl(page: string): string | undefined {
  if (!page.includes("deployggb.js")) return undefined;
  if (page.split("new GGBApplet(").length !== 2) return undefined;
  // Anything of the author's beyond the applet: leave it to the sandboxed page.
  const body = page.slice(Math.max(page.indexOf("<body"), 0));
  if ((body.match(/<script\b/g) ?? []).length !== 1) return undefined;
  const id = GEOGEBRA_MATERIAL_ONLY.exec(page)?.[1];
  return id ? `https://www.geogebra.org/material/iframe/id/${id}` : undefined;
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * `html` with every iframe whose `src` names one of `pages` marked for
 * {@link deliverIframePages}: the `src` removed, the name moved to
 * {@link IFRAME_PAGE_ATTRIBUTE}, and the sandbox set (replacing any the
 * markup carried). Iframes onto a service — Desmos, YouTube — name no page
 * and are left exactly as they are.
 */
export function markIframePages(html: string, pages: IframePages): string {
  if (Object.keys(pages).length === 0) return html;
  return html.replace(IFRAME_TAG, (whole, attributes: string) => {
    const src = SRC_ATTRIBUTE.exec(attributes);
    if (!src) return whole;
    const name = decodeAttribute(src[1]);
    if (!Object.prototype.hasOwnProperty.call(pages, name)) return whole;
    const service = geogebraMaterialUrl(pages[name]);
    if (service) return whole.replace(SRC_ATTRIBUTE, ` src="${service}"`);
    const rest = (
      attributes.slice(0, src.index) + attributes.slice(src.index + src[0].length)
    ).replace(SANDBOX_ATTRIBUTE, "");
    return (
      `<iframe${rest} ${IFRAME_PAGE_ATTRIBUTE}="${encodeAttribute(name)}"` +
      ` sandbox="${IFRAME_PAGE_SANDBOX}">`
    );
  });
}

export interface PrepareIframePagesOptions {
  /**
   * What the pages' relative URLs (`external/…`) resolve against. A `srcdoc`
   * frame inherits its embedder's base URL, which here is already the right
   * one; stating it keeps that true wherever the page ends up framed.
   */
  baseUrl?: string;
  /** As for the main page: where a generated asset's stored picture is. */
  generatedImageUrl?: GeneratedImageResolver;
}

/**
 * The pages as they should be delivered: each with a `<base>` and with its
 * `generated/…` references pointed at the stored pictures, as the main page's
 * are. Returns `pages` itself when there is nothing to do, so an unchanged
 * render keeps its identity.
 */
export function prepareIframePages(
  pages: IframePages,
  { baseUrl, generatedImageUrl }: PrepareIframePagesOptions = {},
): IframePages {
  const names = Object.keys(pages);
  if (names.length === 0 || (!baseUrl && !generatedImageUrl)) return pages;
  const prepared: IframePages = {};
  for (const name of names) {
    let page = pages[name];
    if (generatedImageUrl) page = rewriteGeneratedImages(page, generatedImageUrl);
    if (baseUrl) {
      // First thing in the head, so it governs every URL after it. A page
      // with no head (never PreTeXt's) is left to inherit.
      page = page.replace(/<head\b[^>]*>/, (head) => `${head}<base href="${encodeAttribute(baseUrl)}">`);
    }
    prepared[name] = page;
  }
  return prepared;
}

/**
 * What each live iframe was last given, so an unchanged page is not reloaded.
 * Keyed by element: an iframe the patcher replaced is a new element with no
 * entry, and gets its page; one it left alone keeps running.
 */
export type DeliveredIframePages = WeakMap<Element, string>;

/**
 * Give every marked iframe in `doc` its page as `srcdoc`, skipping those that
 * already show exactly that text. An iframe naming a page the render no longer
 * has is left as it is. Returns how many were (re)loaded.
 *
 * The sandbox is reasserted before the page is set, in case anything dropped
 * it: an iframe without one would run the page with the editor's origin.
 */
export function deliverIframePages(
  doc: Document,
  pages: IframePages,
  delivered: DeliveredIframePages,
): number {
  let loaded = 0;
  for (const iframe of Array.from(doc.querySelectorAll(`iframe[${IFRAME_PAGE_ATTRIBUTE}]`))) {
    const name = iframe.getAttribute(IFRAME_PAGE_ATTRIBUTE) ?? "";
    if (!Object.prototype.hasOwnProperty.call(pages, name)) continue;
    const page = pages[name];
    if (delivered.get(iframe) === page) continue;
    if (iframe.getAttribute("sandbox") !== IFRAME_PAGE_SANDBOX) {
      iframe.setAttribute("sandbox", IFRAME_PAGE_SANDBOX);
    }
    iframe.removeAttribute("src");
    iframe.setAttribute("srcdoc", page);
    delivered.set(iframe, page);
    loaded += 1;
  }
  return loaded;
}
