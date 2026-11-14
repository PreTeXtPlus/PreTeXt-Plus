/**
 * Doenet activities: an exercise record whose `sourceFormat` is `"doenetml"`
 * and whose `source` is DoenetML, placed in the document as an `<exercise>`, a
 * project-like block or a bare `<interactive platform="doenetml">`. See
 * `docs/doenet-plan.md`.
 *
 * This module is the one place the package names Doenet's package and version;
 * `sectionUtils` (assembly) and the editor pane both read from here.
 */

/**
 * The `@doenet/standalone` version a document is built with when its docinfo
 * names none, and the one the editor frame loads in that case. PreTeXt would
 * otherwise load `@latest`, under which a book's activities could change
 * without an edit. Bump deliberately; the spike in the plan was against this
 * version.
 */
export const DEFAULT_DOENETML_VERSION = "0.7.29";

/** Where PreTeXt's HTML, and the editor page, load the package from. */
export const doenetStandaloneUrl = (version: string, file: "style.css" | "doenet-standalone.js"): string =>
  `https://cdn.jsdelivr.net/npm/@doenet/standalone@${encodeURIComponent(version)}/${file}`;

/** What a new Doenet activity opens with. */
export const DOENET_STARTER = `<p>Drag the point to change <m>x</m>.</p>

<graph size="small" xmin="-5" xmax="5" ymin="-5" ymax="5">
  <point name="P">(1, 2)</point>
</graph>

<p>The point is at <m>x = $P.x</m>.</p>

<p>What is <m>2 + 2</m>? <answer name="sum">4</answer></p>
`;

/** The `<interactive>` attributes a new activity starts with (see the plan, Decision 2). */
export const DOENET_DEFAULT_ATTRS: Readonly<Record<string, string>> = { width: "100%", aspect: "4:3" };

/**
 * DoenetML as the text of a `<slate surface="doenetml">`: exactly `&`, `<` and
 * `>` escaped, as TikZ's `wrapSource` does for TeX. The buffer is DoenetML;
 * only the document's copy is XML, and PreTeXt writes it back raw into the
 * page's `<script type="text/doenetml">`.
 */
export const escapeDoenetml = (source: string): string =>
  source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const DOCINFO_DOENETML_VERSION_RE = /<doenetml\b[^>]*\bversion\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/** The version the docinfo's `<doenetml version="…"/>` names, or undefined. */
export function docinfoDoenetmlVersion(docinfo: string): string | undefined {
  const m = DOCINFO_DOENETML_VERSION_RE.exec(docinfo);
  const version = (m?.[1] ?? m?.[2] ?? "").trim();
  return version || undefined;
}

/** Whether the docinfo has a `<doenetml>` element at all, whatever it says. */
export const docinfoHasDoenetml = (docinfo: string): boolean => /<doenetml\b/.test(docinfo);

/**
 * The version a document built from `docinfo` runs: the docinfo's, else the
 * default assembly writes in (`withDefaultDoenetmlVersion` in sectionUtils).
 */
export const effectiveDoenetmlVersion = (docinfo: string): string =>
  docinfoDoenetmlVersion(docinfo) ?? DEFAULT_DOENETML_VERSION;
