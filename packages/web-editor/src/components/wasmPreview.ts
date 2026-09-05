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
import type {
  PtxSourceMap,
  RenderTarget,
  SourceMapEntry,
} from "@pretextbook/pretext-html";
// `./reveal` and `./theme` are dependency-free leaf modules of the same
// package — no libxslt-wasm, no top-level await — so unlike the renderer entry
// these are imported statically. They only rewrite/describe HTML the renderer
// already produced, which is what lets the slideshow view and the preview
// theme change without paying for a re-render.
import { injectRevealBridge, type RevealView } from "@pretextbook/pretext-html/reveal";
import {
  previewThemeMessage,
  type PreviewTheme,
} from "@pretextbook/pretext-html/theme";
import {
  injectPrintPreview,
  type PrintoutInfo,
} from "@pretextbook/pretext-html/printout";

export type { PreviewTheme, RevealView, PrintoutInfo };
export { previewThemeMessage };

/**
 * Virtual path the *editor's own buffer* is rendered under. Nothing reads it
 * from disk; it exists so error messages and source-map entries have a name.
 */
export const PREVIEW_SOURCE_PATH = "/source/division.ptx";

/**
 * Virtual path the surrounding document is rendered under in context mode
 * (see {@link LocalRenderOptions.contextSource}).
 */
export const PREVIEW_CONTEXT_PATH = "/source/main.ptx";

/** Options accepted by a local render. Mirrors the subset we actually use. */
export interface LocalRenderOptions {
  /** Light/dark theme for the rendered page; omit for its native behaviour. */
  theme?: PreviewTheme;
  /**
   * Text for the dismissible "this is a preview, not a build" banner the
   * renderer injects across the top of the page. Omitted leaves the page
   * without one.
   */
  bannerMessage?: string;
  /**
   * The complete project document to render `source` *inside of*, rather than
   * standalone.
   *
   * This is what makes a single division's preview show the numbering the
   * built book will have ("Theorem 3.2.1", not "Theorem 1.1") and resolve the
   * `<xref>`s that leave it. `source` supplies the division's own — possibly
   * unsaved — text; this supplies only the structure around it. The two are
   * matched by `@xml:id`, so {@link LocalRenderOptions.divisionId} must name
   * the fragment's root element; when that id is not in this document the
   * renderer silently falls back to a standalone wrapper, which is the right
   * answer for a division the author has only just created.
   *
   * Costs roughly 5-7x a standalone render, since the whole document is
   * assembled to compute the numbering (measured: ~75ms standalone vs ~530ms
   * in context, on a 160-section book).
   */
  contextSource?: string;
  /**
   * `@xml:id` of `source`'s root element. Required for
   * {@link LocalRenderOptions.contextSource} to take effect, and used either
   * way to trim the source map to the previewed division (see
   * {@link subtreeSourceMap}).
   */
  divisionId?: string;
  /** `<docinfo>` to give a standalone fragment: LaTeX macros, custom settings. */
  docinfo?: string;
  /**
   * Render `source` as a fragment (a lone `<section>`, `<chapter>`, ...) that
   * the renderer wraps in a minimal document, rather than as a complete
   * `<pretext>` document. Required for context mode.
   */
  fragment?: boolean;
}

/*
 * Deliberately no `revealView`/`revealZoom` here, though the renderer accepts
 * both. A deck's presentation is applied by {@link applyRevealView} instead,
 * and only there: `injectRevealBridge` does not stack, so bridging a page that
 * was already bridged at render time strips the bridge rather than replacing
 * it. One injector, on a freshly rendered page, is the only arrangement that
 * cannot get that wrong — and it is the faster one anyway, since changing the
 * view then costs a re-injection rather than a re-render.
 */

/** A rendered page plus the map that ties its elements back to the source. */
export interface PreviewRender {
  /** Complete standalone HTML page. */
  html: string;
  /**
   * One entry per element of the *previewed division*, in document order.
   * Empty rather than absent when the renderer produced none, so callers never
   * branch on undefined. Already trimmed by {@link subtreeSourceMap}, so its
   * lines are all in `source`'s own coordinates.
   */
  sourceMap: PtxSourceMap;
  /**
   * Which conversion actually ran. "slides" means the page is a reveal.js
   * deck, and the slideshow-only controls (view toggle, zoom) apply to it.
   */
  target: RenderTarget;
  /**
   * The printouts on the page — worksheets, handouts, projects — in document
   * order, each of which can be laid out on paper by {@link applyPrintPreview}.
   * Empty for a page with none, which is also when PreTeXt emits no paper-size
   * controls and there is therefore no print preview to offer.
   */
  printouts: PrintoutInfo[];
  /**
   * The printout to open on paper by default: set only when the previewed
   * document *is* a printout (editing `worksheet-3.ptx`) rather than merely
   * containing some (a chapter with three worksheets in it, which should open
   * as the chapter).
   */
  rootPrintout?: string;
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
  const { html, sourceMap, target, printouts, rootPrintout } = await renderHtml({
    cssTheme: "default-modern",
    sourcePath: PREVIEW_SOURCE_PATH,
    projectDir: "/source",
    sourceContent: source,
    sourceMap: true,
    ...(options.fragment ? { fragment: true } : {}),
    ...(options.docinfo ? { docinfo: options.docinfo } : {}),
    // Context mode needs both halves: the document to place the fragment in,
    // and (via `divisionId`, matched on `@xml:id`) which division it replaces.
    ...(options.contextSource && options.divisionId
      ? {
          contextSourcePath: PREVIEW_CONTEXT_PATH,
          contextSourceContent: options.contextSource,
        }
      : {}),
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.bannerMessage
      ? { previewBanner: { message: options.bannerMessage } }
      : {}),
  });
  return {
    html,
    sourceMap: subtreeSourceMap(sourceMap ?? [], options.divisionId),
    target,
    printouts,
    rootPrintout,
  };
}

/**
 * Trim a source map to the entries authored in the previewed division.
 *
 * Necessary because a context render's map describes two documents at once:
 * the surrounding book (lines in *its* coordinates) and the fragment spliced
 * into it (lines in the editor buffer's), all stamped with the same `file`.
 * Feeding that mixture to `findSourceMapEntry` — which assumes one file, with
 * non-decreasing start lines — makes an entry from a chapter elsewhere in the
 * book shadow the one the author's cursor is actually in.
 *
 * The division's own entries are exactly those reachable from it through
 * `parent`. Entries are in document order, so a parent always precedes its
 * children and one forward pass collects the whole subtree.
 *
 * Returns `sourceMap` untouched when `rootId` names nothing in it — the
 * renderer fell back to a standalone wrapper, or no division id was given —
 * since an empty map would silently disable sync altogether.
 */
export function subtreeSourceMap(
  sourceMap: PtxSourceMap,
  rootId: string | undefined,
): PtxSourceMap {
  if (!rootId || !sourceMap.some((entry) => entry.id === rootId)) {
    return sourceMap;
  }
  const kept = new Set<string>([rootId]);
  return sourceMap.filter((entry) => {
    if (entry.id === rootId) return true;
    if (entry.parent === undefined || !kept.has(entry.parent)) return false;
    kept.add(entry.id);
    return true;
  });
}

/**
 * Re-present an already-rendered deck in the other view.
 *
 * Reveal reads `view` once, when it initializes, so this returns a new page
 * rather than talking to the live one — but it is still far cheaper than a
 * re-render, since the transform does not run again.
 */
export function applyRevealView(
  html: string,
  view: RevealView,
  zoom: number,
): string {
  return injectRevealBridge(html, view, { zoom });
}

/**
 * Re-present an already-rendered page as one of its printouts laid out for
 * paper — or, with no id, as the ordinary page.
 *
 * pretext-core.js enters that layout by reading `?printpreview=<id>` from
 * `location.search`, which a preview has no way to set: it is delivered into an
 * iframe whose URL is not ours to write. `injectPrintPreview` supplies the
 * parameter without the navigation, by patching the one reader that looks for
 * it. See the printout module's own documentation for why rewriting the URL is
 * not an option.
 *
 * Must be applied on **every** delivery, "off" included, and never skipped as
 * a no-op: the injected bridge keeps its answer on a window property, so a page
 * delivered without one inherits whatever the previous delivery said.
 *
 * The transformation itself is one-way — pretext-core.js runs it once from a
 * DOMContentLoaded handler and rearranges the DOM destructively — which is why
 * leaving print preview means re-delivering the pristine render rather than
 * undoing anything.
 */
export function applyPrintPreview(
  html: string,
  printoutId: string | undefined,
): string {
  return injectPrintPreview(html, printoutId);
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
