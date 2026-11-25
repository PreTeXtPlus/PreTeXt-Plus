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

/**
 * What a new Doenet activity opens with. It passes Doenet's accessibility
 * checks, since it is the example authors copy from: a `<graph>` needs a
 * `<shortDescription>` (or `decorative`), and so does the input an `<answer>`
 * creates (or a `<label>`). A short description is words only — Doenet flags
 * math inside one. Checked with @doenet/standalone 0.7.29's editor: no
 * accessibility diagnostics, and 4 is still graded correct.
 */
export const DOENET_STARTER = `<p>Drag the point to change <m>x</m>.</p>

<graph size="small" xmin="-5" xmax="5" ymin="-5" ymax="5">
  <shortDescription>A coordinate grid with one point you can drag</shortDescription>
  <point name="P">(1, 2)</point>
</graph>

<p>The point is at <m>x = $P.x</m>.</p>

<p>What is <m>2 + 2</m>? <answer name="sum"><shortDescription>two plus two</shortDescription>4</answer></p>
`;

/**
 * The `<interactive>` attributes a new activity starts with (see the plan,
 * Decision 2). No `aspect`: the frame's height follows the activity (see
 * `doenetInteractiveAttrs` in sectionUtils).
 */
export const DOENET_DEFAULT_ATTRS: Readonly<Record<string, string>> = { width: "100%" };

/**
 * The `<static>` half of a placed activity: what a PDF, braille or a solutions
 * manual shows in its place. The same note for every activity until Doenet
 * can supply a static rendering of its own.
 */
export const DOENET_STATIC_FALLBACK =
  "<statement>\n<p>This exercise is interactive, and is available in the online version.</p>\n</statement>";

/**
 * DoenetML as the content of a `<slate surface="doenetml">`: one CDATA
 * section holding the source verbatim, so the assembled document an author
 * downloads shows the DoenetML they wrote rather than a wall of `&lt;`. To an
 * XML parser it is the same text node entity escapes would give, which
 * PreTeXt writes back raw into the page's `<script type="text/doenetml">`.
 *
 * The one sequence a CDATA section cannot hold is its own terminator; a
 * `]]>` in the source ends the section after `]]` and opens the next one
 * before `>`.
 */
export const doenetmlCdata = (source: string): string =>
  `<![CDATA[${source.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;

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
