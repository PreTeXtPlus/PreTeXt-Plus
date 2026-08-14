/**
 * Delivering a rendered preview into an iframe that has a *real URL*.
 *
 * The obvious way to show an in-memory render is `iframe.srcdoc`, and that is
 * what this component did (and still does when no frame URL is available).
 * It has one limitation that matters: a `srcdoc` document's URL is
 * `about:srcdoc`, and it has no query string.
 *
 * PreTeXt's print preview — the printer icon on every `<worksheet>`,
 * `<handout>` and standalone project — is driven entirely by one:
 * pretext-core.js reads `?printpreview=<id>` from `location.search` inside its
 * `DOMContentLoaded` handler and, if present, swaps the theme stylesheet for
 * `print-worksheet.css`, moves that printout into `.ptx-content`, and paginates
 * it to the chosen paper size. All of that is ordinary DOM work on the page
 * that is already loaded — nothing is fetched — so the *only* thing standing
 * between us and a working print preview is the query string.
 *
 * Neither shortcut works. `history.replaceState` from inside a `srcdoc`
 * document throws `SecurityError` (its URL is `about:srcdoc`, which cannot be
 * replaced with an http one), and a `blob:` URL with `?query` appended simply
 * fails to load. So the preview is delivered into a real, same-origin page
 * instead: the host serves a tiny shim (see `public/preview-frame.html`) at a
 * URL we control, and we navigate the iframe to that URL — with or without
 * `?printpreview=` — and hand it the rendered HTML to write into itself.
 *
 * ## Why the frame writes itself
 *
 * The parent *could* call `iframe.contentDocument.write(...)` directly; it is
 * same-origin. It must not. `document.open()` sets the document's URL to the
 * **entry** document's — the parent's — so a parent-driven write silently
 * discards the very query string this whole arrangement exists to preserve.
 * Every write therefore originates inside the frame, from a `message` handler.
 *
 * ## Why the bootstrap re-injects itself
 *
 * `document.open()` also drops the frame's event listeners, so the handler
 * that performed a write is gone by the time the next render arrives. The
 * bootstrap is injected into every page we write ({@link injectFrameBootstrap})
 * so each rewritten document re-registers it. Properties on `window` do
 * survive, which is what carries the write token across — and also why the
 * handler is re-attached unconditionally rather than guarded by a "already
 * wired" flag, which would survive the listener it was guarding and wedge the
 * frame permanently.
 */

/** Frame → host: "a document just finished loading in me". */
export const FRAME_READY_MESSAGE = "pretext-plus:frame-ready";
/** Host → frame: "write this HTML into yourself". */
export const FRAME_WRITE_MESSAGE = "pretext-plus:frame-write";

/** What the frame reports about itself each time a document loads in it. */
export interface FrameReadyMessage {
  type: typeof FRAME_READY_MESSAGE;
  /**
   * The write token of the page reporting in, or `undefined` when this
   * document came from the network rather than from a write — a fresh shim,
   * or the result of the reader clicking a print-preview link. Undefined is
   * the host's cue that the frame is empty and needs content.
   */
  token?: number;
  /** The frame's `location.search`, so the host can read `?printpreview`. */
  search: string;
}

/** True when `data` is a {@link FrameReadyMessage}. */
export function isFrameReadyMessage(data: unknown): data is FrameReadyMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Partial<FrameReadyMessage>;
  return (
    message.type === FRAME_READY_MESSAGE && typeof message.search === "string"
  );
}

/**
 * The query parameter pretext-core.js reads to enter print-preview mode. Its
 * value is the printout's HTML id.
 */
export const PRINT_PREVIEW_PARAM = "printpreview";

/** The frame URL to show `printoutId` — or the plain preview, for `null`. */
export function frameSrc(
  frameUrl: string,
  printoutId: string | null,
): string {
  if (!printoutId) return frameUrl;
  const separator = frameUrl.includes("?") ? "&" : "?";
  return `${frameUrl}${separator}${PRINT_PREVIEW_PARAM}=${encodeURIComponent(
    printoutId,
  )}`;
}

/** The printout id in a frame's `location.search`, if it is in print mode. */
export function printoutIdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(PRINT_PREVIEW_PARAM);
}

/**
 * The bootstrap injected into every page written into the frame.
 *
 * Written in ES5-ish, self-contained JS: it is embedded verbatim into rendered
 * HTML that no bundler ever sees, and it re-executes on every rewrite. It does
 * three things — re-registers the write handler, re-enables the print-preview
 * links, and reports in — and each is idempotent.
 *
 * `token` is baked in so the page can identify *itself* to the host when it
 * reports in; see {@link FrameReadyMessage.token} for why that matters.
 */
export function frameBootstrapScript(token: number): string {
  return `<script>(function () {
  if (window.parent === window) return;
  // Remembered on window, which survives document.open(), so the handler
  // identity is stable across rewrites and remove/add cannot leak duplicates.
  if (!window.__ptxFrameWrite) {
    window.__ptxFrameWrite = function (event) {
      var data = event.data;
      if (!data || data.type !== ${JSON.stringify(FRAME_WRITE_MESSAGE)}) return;
      if (typeof data.html !== "string") return;
      // Stashed before the write so the incoming page — whose own copy of this
      // script runs during document.write — can report which write it is.
      window.__ptxFrameToken = data.token;
      document.open();
      document.write(data.html);
      document.close();
    };
  }
  window.removeEventListener("message", window.__ptxFrameWrite);
  window.addEventListener("message", window.__ptxFrameWrite);

  function ready() {
    // Re-enable PreTeXt's print-preview buttons. The preview stylesheet
    // renders them inert (assets/preview-html.xsl strips the @href, because in
    // an in-memory render "?printpreview=..." would resolve against a page
    // that does not exist) and, in doing so, drops the printout id with it.
    // The id is recoverable from the DOM: the printout element itself carries
    // both an @id and the @data-margins that pretext-core.js paginates from.
    var links = document.querySelectorAll("a.print-link:not([href])");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var printout = link.closest ? link.closest("[data-margins]") : null;
      if (!printout || !printout.id) continue;
      link.setAttribute(
        "href",
        "?${PRINT_PREVIEW_PARAM}=" + encodeURIComponent(printout.id)
      );
      link.removeAttribute("aria-disabled");
      link.removeAttribute("style");
      link.setAttribute("title", "Print preview");
    }

    parent.postMessage(
      {
        type: ${JSON.stringify(FRAME_READY_MESSAGE)},
        token: ${JSON.stringify(token)},
        search: location.search
      },
      "*"
    );
  }

  // This script sits at the top of <head>, so the body it needs to repair —
  // and the document the host is told about — does not exist yet. Both wait
  // for the parse to finish. (A written document fires DOMContentLoaded again
  // when document.close() completes it, so this is reached on every rewrite,
  // not just the first load.)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();</script>`;
}

/**
 * Put the bootstrap at the very top of a rendered page's `<head>`, so the
 * write handler is re-registered before the page's own (CDN) scripts run.
 *
 * Returns the page unchanged when it has no recognisable `<head>` — the render
 * is then simply not rewritable in place, which the host recovers from by
 * reloading the frame.
 */
export function injectFrameBootstrap(html: string, token: number): string {
  const headMatch = html.match(/<head\b[^>]*>/i);
  if (!headMatch || headMatch.index === undefined) return html;
  const insertAt = headMatch.index + headMatch[0].length;
  return (
    html.slice(0, insertAt) + frameBootstrapScript(token) + html.slice(insertAt)
  );
}
