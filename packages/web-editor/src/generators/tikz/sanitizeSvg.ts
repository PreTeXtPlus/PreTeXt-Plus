/**
 * Making a TikZ picture safe to show and store.
 *
 * PGF's SVG driver writes through `\special{dvisvgm:raw …}`, so TeX can put any
 * markup at all in the SVG, and a collaborator's source compiles in my browser:
 * `<script>`, event handlers and `javascript:` links are all a line of TeX away.
 * An `<img>` would not run them, but the stored file outlives the `<img>`.
 */
import DOMPurify from "dompurify";

/** The picture itself may be referred to; nothing else may be reached. */
const staysInPicture = (element: Element, target: string) =>
  target.startsWith("#") || (element.localName === "image" && target.startsWith("data:image/"));

/**
 * A `url(…)` in CSS or a presentation attribute — `fill`, `filter`, `mask`,
 * `style="fill:url(…)"` — which DOMPurify leaves alone, and a browser showing
 * the file on its own (not in an `<img>`) will fetch.
 */
const URL_REFERENCE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

const reachesOutside = (value: string) =>
  Array.from(value.matchAll(URL_REFERENCE)).some(([, , target]) => !target.trim().startsWith("#"));

/**
 * `svg` with everything but the drawing taken out, as standalone XML. DOMPurify
 * parses and reserializes as HTML, which is not what an `image/svg+xml` file is
 * read as, so the DOM it leaves is written out here instead: that keeps the
 * namespaces, which an `<img>` will not draw the file without.
 */
export function sanitizeSvg(svg: string): string {
  if (!DOMPurify.isSupported) throw new Error("This browser can't check the picture is safe to show");
  const fragment = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
    // Only `woff2` output has one; `paths`, which the worker asks for, does not.
    FORBID_TAGS: ["style"],
    RETURN_DOM_FRAGMENT: true,
  });
  const root = fragment.querySelector("svg");
  if (!root) throw new Error("The engine produced no picture");
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const name of ["href", "xlink:href"]) {
      const target = element.getAttribute(name);
      if (target === null || staysInPicture(element, target)) continue;
      // A link is only a wrapper: its drawing stays, without somewhere to go.
      if (element.localName === "a") element.removeAttribute(name);
      else element.remove();
    }
    // A paint or filter from elsewhere: the element stays, drawn without it.
    for (const attribute of Array.from(element.attributes)) {
      if (reachesOutside(attribute.value)) element.removeAttributeNode(attribute);
    }
  }
  return new XMLSerializer().serializeToString(root);
}
