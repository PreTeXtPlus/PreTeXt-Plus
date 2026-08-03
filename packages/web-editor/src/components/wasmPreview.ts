/**
 * In-browser PreTeXt → HTML rendering for the full preview.
 *
 * `@pretextbook/pretext-html` runs the official PreTeXt XSLT stylesheets
 * through a WebAssembly build of libxslt, so a preview no longer needs a round
 * trip to a build server: a render costs ~400ms cold (stylesheet compile plus
 * a CDN fetch of the stylesheet bundle, once per session) and ~90ms warm.
 *
 * Two things about the dependency shape are load-bearing:
 *
 *  - **The import is dynamic.** `@pretextbook/libxslt-wasm` instantiates its
 *    1.3MB WASM module with a *top-level await*, so a static import would pay
 *    that cost on page load for every consumer, whether or not they ever open
 *    a preview. Loading it on first render keeps it off the critical path.
 *  - **Both packages are external to this library's bundle** (see
 *    vite.config.ts). The WASM binary is located with
 *    `new URL("libxslt.wasm", import.meta.url)`; leaving the packages external
 *    lets the consuming app's bundler emit and serve that asset, which is what
 *    Vite and webpack already know how to do.
 *
 * Rendering requires WebAssembly JSPI (stack switching), which not every
 * engine ships. Callers must check {@link isLocalPreviewAvailable} first and
 * fall back to a server build when it is false.
 */

// Type-only, so this is erased at compile time and does not drag the WASM
// entry (and its top-level await) onto the load path. The matching runtime
// helper is reached through loadRenderer() instead — see findEntryForLine.
import type { PtxSourceMap, SourceMapEntry } from "@pretextbook/pretext-html";

/**
 * Virtual path we render under. Nothing reads it from disk, but every
 * source-map entry is stamped with it, so sync lookups filter on this value.
 */
export const PREVIEW_SOURCE_PATH = "/source/main.ptx";

/** Options accepted by a local render. Mirrors the subset we actually use. */
interface LocalRenderOptions {
  /** Light/dark theme for the rendered page; omit for its native behaviour. */
  theme?: "light" | "dark" | "system";
}

/** A rendered page plus the map that ties its elements back to the source. */
export interface PreviewRender {
  /** Complete standalone HTML page. */
  html: string;
  /**
   * One entry per element, in document order. Empty rather than absent when
   * the renderer produced none, so callers never branch on undefined.
   */
  sourceMap: PtxSourceMap;
}

type PretextHtmlModule = typeof import("@pretextbook/pretext-html");

let modulePromise: Promise<PretextHtmlModule> | undefined;

/**
 * Whether this engine can render locally. JSPI is the hard requirement: the
 * WASM build suspends mid-transform to fetch stylesheets, which is impossible
 * without it.
 *
 * Deliberately does not import the renderer — this is called during layout to
 * decide whether to offer the preview at all, and must stay synchronous and
 * free.
 */
export function isLocalPreviewAvailable(): boolean {
  return (
    typeof WebAssembly !== "undefined" &&
    typeof globalThis.fetch === "function" &&
    "Suspending" in WebAssembly
  );
}

function loadRenderer(): Promise<PretextHtmlModule> {
  if (!modulePromise) {
    modulePromise = import("@pretextbook/pretext-html");
    // Let a failed load (offline, blocked CDN) be retried rather than cached
    // as a permanent failure.
    modulePromise.catch(() => {
      modulePromise = undefined;
    });
  }
  return modulePromise;
}

/**
 * Render a complete PreTeXt document to a standalone HTML page.
 *
 * `source` must be a whole `<pretext>` document — which is what
 * `wrapDivisionForPreview` produces — so fragment mode is not needed. The
 * paths are virtual: nothing is read from a filesystem, and `sourceContent`
 * carries the actual text.
 *
 * `renderHtml` is not reentrant — it drives one cached compiled stylesheet
 * through shared mount tables, and suspends mid-transform — but it queues
 * concurrent calls itself as of pretext-html 0.3.0, so callers may fire freely.
 *
 * Throws on malformed XML or a failed transform; the caller decides what to do
 * with that (LivePreview keeps the last good render and shows a banner).
 */
export async function renderPreviewHtml(
  source: string,
  options: LocalRenderOptions = {},
): Promise<PreviewRender> {
  const { renderHtml } = await loadRenderer();
  const { html, sourceMap } = await renderHtml({
    cssTheme: "default-modern",
    sourcePath: PREVIEW_SOURCE_PATH,
    projectDir: "/source",
    sourceContent: source,
    sourceMap: true,
    ...(options.theme ? { theme: options.theme } : {}),
  });
  return { html, sourceMap: sourceMap ?? [] };
}

/**
 * The element to sync to for a cursor sitting on `assembledLine`: the nearest
 * element starting at or above it.
 *
 * Async only because the helper lives in the renderer entry, which is loaded
 * dynamically to keep its top-level await off the page-load path. By the time
 * anything can sync there is a rendered preview on screen, so the module is
 * already cached and this resolves immediately.
 */
export async function findEntryForLine(
  sourceMap: PtxSourceMap,
  assembledLine: number,
): Promise<SourceMapEntry | undefined> {
  if (sourceMap.length === 0) return undefined;
  const { findSourceMapEntry } = await loadRenderer();
  return findSourceMapEntry(sourceMap, assembledLine);
}

/**
 * The source location an element id was rendered from.
 *
 * Ids come off the clicked element in the preview, so an unknown one is
 * routine — plenty of markup in the page (MathJax output, chrome the
 * stylesheets add) was never stamped from source.
 */
export function findEntryById(
  sourceMap: PtxSourceMap,
  id: string,
): SourceMapEntry | undefined {
  return sourceMap.find((entry) => entry.id === id);
}

/**
 * Best-effort line number for a well-formedness failure.
 *
 * libxslt discards libxml2's own parse errors (which do carry a line number)
 * to the console rather than the thrown error — see {@link describePreviewError}
 * — so this recovers one independently via the browser's own XML parser,
 * which reports exactly the same well-formedness violations (unclosed or
 * mismatched tags, stray `&`, etc.) with a line number in its native
 * `parsererror` output. Neither parser resolves undefined named entities
 * without a DTD, so the two should never disagree about what counts as
 * malformed.
 *
 * Returns `undefined` when `source` parses cleanly — meaning the actual
 * failure was something else, e.g. a well-formed document that failed the
 * XSLT transform — or when a `parsererror` was found but no line number could
 * be parsed out of it.
 */
export function findWellformednessErrorLine(source: string): number | undefined {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const parserError = doc.querySelector("parsererror");
  const text = parserError?.textContent;
  if (!text) return undefined;
  // Chromium: "error on line 7 at column 12: ...". Firefox: "... Line Number
  // 7, Column 12:". jsdom (used under test): "7:12: unexpected close tag.".
  const labeled = text.match(/line\s*(?:number)?\D{0,3}(\d+)/i);
  if (labeled) return Number(labeled[1]);
  const bare = text.match(/^(\d+):\d+:/);
  return bare ? Number(bare[1]) : undefined;
}

/**
 * Turn a render failure into something worth showing an author.
 *
 * libxslt reports parse errors on the console rather than in the thrown
 * error, so the message is often generic; the common authoring case (a
 * malformed document mid-edit) is worth naming explicitly rather than
 * surfacing "PreTeXt XSLT transform failed".
 *
 * `line`, when given, comes from {@link findWellformednessErrorLine} and is
 * already known to be a well-formedness failure — the friendly message is
 * shown regardless of what `error`'s own text says.
 */
export function describePreviewError(error: unknown, line?: number): string {
  if (line !== undefined) {
    return (
      `Could not build the preview: the document is not well-formed XML ` +
      `(near line ${line}) — check for an unclosed or mismatched tag.`
    );
  }
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  if (/transform failed/i.test(message)) {
    return (
      "Could not build the preview. This usually means the PreTeXt is not " +
      "yet well-formed — check for an unclosed tag."
    );
  }
  return message;
}
