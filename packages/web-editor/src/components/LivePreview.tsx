import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import "./LivePreview.css";
import { postToIframe } from "./postToIframe";
import {
  applyRevealView,
  describePreviewError,
  findEntryById,
  findEntryForLine,
  findWellformednessErrorLine,
  isLocalPreviewAvailable,
  previewThemeMessage,
  renderPreviewHtml,
  type PreviewTheme,
  type RevealView,
} from "./wasmPreview";
import {
  frameSrc,
  injectFrameBootstrap,
  isFrameReadyMessage,
  printoutIdFromSearch,
  FRAME_WRITE_MESSAGE,
} from "./previewFrame";
import type { PreviewLineMap } from "./previewSync";
import type { PtxSourceMap, SourceMapEntry } from "@pretextbook/pretext-html";

interface LivePreviewProps {
  /**
   * What the local renderer is given: a complete `<pretext>` document, or —
   * with {@link LivePreviewProps.fragment} — one division on its own.
   */
  content: string;
  /**
   * What the *server* build is given instead, when one is used: always a
   * complete standalone document, since a build server has no notion of
   * rendering a fragment inside a context it was never sent. Defaults to
   * `content`, which is correct whenever that is already a whole document.
   */
  serverContent?: string;
  title?: string;
  /**
   * Server-side rebuild handler. Optional: when the browser can render
   * locally (WebAssembly JSPI), the preview builds in-page and this is never
   * called. It remains the fallback for engines without JSPI, so hosts that
   * must support them should keep providing it.
   */
  onRebuild?: (
    content: string,
    title: string,
    postToIframe: (url: string, data: any) => void,
  ) => void;
  /**
   * Called when the author clicks somewhere in the preview, for preview →
   * source sync.
   *
   * `line` refers to the rendered (assembled) document, which is not the
   * editor buffer, and `elementId` is the clicked element's rendered id —
   * which encodes the division that authored it. The caller needs both to
   * translate the click (see previewSync.ts).
   *
   * Only fires on the local render: a server-built preview is cross-origin and
   * cannot be inspected.
   */
  onSyncToSource?: (click: {
    assembledLine: number;
    elementId: string;
  }) => void;
  /**
   * Identity of the division being previewed. Changing it rebuilds, because
   * the preview must show the division the editor is showing: sync maps
   * between the buffer and the rendered page, and those have to be the same
   * document or every lookup is nonsense.
   *
   * This is deliberately an identity rather than the content — content changes
   * on every keystroke and must *not* rebuild.
   *
   * It doubles as the `@xml:id` matched against {@link contextSource}, which
   * is how the renderer knows which division of the surrounding document
   * `content` stands in for.
   */
  divisionId?: string;
  /**
   * Translates lines between the editor buffer and the assembled document
   * that is actually rendered. Used to report a well-formedness error's line
   * number in terms of what the author sees in Monaco, rather than the
   * assembled document's own line count.
   */
  previewLineMap?: PreviewLineMap | null;
  /**
   * Whether `content` is a bare division (a lone `<section>`, `<chapter>`, …)
   * that the renderer should wrap, rather than a complete `<pretext>`
   * document. Required for {@link contextSource} to apply.
   */
  fragment?: boolean;
  /**
   * The complete project document to render `content` *inside of*, so the
   * division is numbered as the built book numbers it and its outgoing
   * `<xref>`s resolve. Omit to render the division standalone — which
   * restarts numbering at 1 and leaves those references as PreTeXt's
   * "missing target" placeholder.
   */
  contextSource?: string;
  /** `<docinfo>` for a standalone fragment: LaTeX macros, custom settings. */
  docinfo?: string;
  /**
   * URL of the host's preview frame shim, which gives the preview a real
   * same-origin URL instead of `srcdoc` (see previewFrame.ts). Without it the
   * preview still works, but PreTeXt's print preview — which is driven by a
   * `?printpreview=` query string — cannot be offered.
   */
  frameUrl?: string;
  /**
   * Drive the preview's light/dark mode from the host's own theme.
   *
   * Omit — the default — and the page keeps its native behaviour, deciding
   * from `localStorage` and `prefers-color-scheme`. That is deliberately the
   * default: setting this re-applies the host's theme on *every* rebuild, so
   * a choice the author makes in the preview's own readability menu would be
   * undone a second later. Only pass it if the host has a theme worth
   * mirroring.
   */
  theme?: PreviewTheme;
  /**
   * Text for the dismissible banner across the top of the preview, warning
   * that it is not a real build. Pass an empty string for no banner.
   */
  bannerMessage?: string;
}

export interface LivePreviewHandle {
  rebuild: () => void;
  /**
   * Scroll the preview to whatever was rendered from `assembledLine`, for
   * source → preview sync. A no-op when nothing maps to that line.
   */
  scrollToAssembledLine: (assembledLine: number) => void;
}

/**
 * The rendered element a source-map entry points at.
 *
 * Not every mapped element survives into the page with an id — the stylesheets
 * emit ids selectively — so walk the entry's ancestor chain outward until one
 * does. Scrolling to the enclosing division is a good answer; scrolling nowhere
 * is not.
 */
function elementForEntry(
  doc: Document,
  sourceMap: PtxSourceMap,
  entry: SourceMapEntry,
): Element | null {
  let current: SourceMapEntry | undefined = entry;
  while (current) {
    const element = doc.getElementById(current.id);
    if (element) return element;
    current = current.parent
      ? findEntryById(sourceMap, current.parent)
      : undefined;
  }
  return null;
}

/**
 * The source line a click in the preview corresponds to, or `undefined` when
 * the click landed on markup that came from no particular source element
 * (MathJax output, chrome the stylesheets add).
 *
 * Walks up from the clicked node rather than requiring a direct hit, since the
 * text under the pointer is usually a child of the element that carries the id.
 */
function entryForClick(
  target: EventTarget | null,
  sourceMap: PtxSourceMap,
): SourceMapEntry | undefined {
  // `target` belongs to the iframe's realm, so `instanceof Element` — which
  // tests *this* window's constructor — is always false for it, even though
  // the document is same-origin. Duck-type on nodeType instead. A click can
  // also land on a text node, so start from its parent element.
  const node = target as Node | null;
  let element: Element | null =
    node == null
      ? null
      : node.nodeType === 1
      ? (node as Element)
      : node.parentElement;

  while (element) {
    if (element.id) {
      const entry = findEntryById(sourceMap, element.id);
      if (entry) return entry;
    }
    element = element.parentElement;
  }
  return undefined;
}

/**
 * The key pretext-core.js reads to decide light/dark. Because the preview
 * shares this origin — and so this exact `localStorage` — with the editor, an
 * author's choice in the preview's own readability menu survives every rebuild
 * without any help from us.
 */
const PRETEXT_THEME_KEY = "theme";

/**
 * Start the preview in light mode, matching the editor, which ships no dark
 * mode of its own.
 *
 * Seeds the key only when it is unset. With no value pretext-core.js falls
 * back to `prefers-color-scheme`, so an author on a dark-mode OS would get a
 * dark preview beside light editor chrome. Writing the same key the readability
 * menu writes — rather than overriding the page after the fact — means a
 * deliberate choice there still wins, and still persists across rebuilds.
 *
 * Skipped entirely when the host drives the theme itself (the `theme` prop),
 * since the injected bridge then owns the decision.
 */
function defaultPreviewToLight(): void {
  try {
    if (localStorage.getItem(PRETEXT_THEME_KEY) === null) {
      localStorage.setItem(PRETEXT_THEME_KEY, "light");
    }
  } catch {
    // Storage unavailable (private mode, blocked cookies). The preview falls
    // back to prefers-color-scheme, exactly as it did before.
  }
}

/** Zoom steps for a slideshow, coarse enough that a click is visible. */
const REVEAL_ZOOM_STEP = 0.25;
const REVEAL_ZOOM_MIN = 0.25;
const REVEAL_ZOOM_MAX = 1;

/** A local build slower than this turns off auto-refresh on content change. */
const AUTO_REFRESH_DISABLE_THRESHOLD_MS = 3000;

const LivePreview = forwardRef<LivePreviewHandle, LivePreviewProps>(
  (
    {
      content,
      serverContent,
      title,
      onRebuild,
      onSyncToSource,
      divisionId,
      previewLineMap,
      fragment,
      contextSource,
      docinfo,
      frameUrl,
      theme,
      bannerMessage,
    },
    ref,
  ) => {
    const [isRebuilding, setIsRebuilding] = useState(false);
    // The last render that succeeded. Kept across failures so a transient
    // typo does not blank the panel and lose the author's place.
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    // Which conversion produced it: "slides" unlocks the deck controls.
    const [renderTarget, setRenderTarget] = useState<"html" | "slides">("html");
    const [error, setError] = useState<string | null>(null);
    // Slideshow presentation, applied without re-rendering (see pageHtml).
    const [revealView, setRevealView] = useState<RevealView>("scroll");
    const [revealZoom, setRevealZoom] = useState(REVEAL_ZOOM_MAX);
    // The printout the frame is currently previewing, mirrored from its URL
    // rather than set by us: the author enters print preview by clicking the
    // printer icon *inside* the page, which navigates the frame itself.
    const [printoutId, setPrintoutId] = useState<string | null>(null);
    // Flips on once a local build crosses AUTO_REFRESH_DISABLE_THRESHOLD_MS,
    // so a document that's gotten expensive to render stops re-rendering on
    // every pause in typing. Cleared by the "Re-enable auto-refresh" banner
    // action; any build (debounced, manual, or on division switch) counts.
    const [autoRefreshDisabled, setAutoRefreshDisabled] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const savedScrollPosition = useRef<{ x: number; y: number } | null>(null);
    // Only the newest render may commit: a fast second rebuild must not be
    // overwritten by a slower one that started earlier.
    const renderToken = useRef(0);
    // Source map for whatever is currently displayed. A ref, not state: it is
    // only ever read inside callbacks, and re-rendering on it would be waste.
    const sourceMapRef = useRef<PtxSourceMap>([]);
    // Kept current so the iframe's click listener — attached once per loaded
    // document — always calls the latest prop.
    const onSyncToSourceRef = useRef(onSyncToSource);
    useEffect(() => {
      onSyncToSourceRef.current = onSyncToSource;
    }, [onSyncToSource]);

    // Decided once: whether this engine can render in-page at all. A host that
    // provides no server handler gets the local path regardless, since there
    // is nothing to fall back to.
    const renderLocally = isLocalPreviewAvailable() || !onRebuild;
    // Only engines without JSPI ever reach the server path (see renderLocally
    // above), so this is exactly the "your browser is using the slower remote
    // build" case worth mentioning.

    const showBrowserTip = !renderLocally;

    // The served-frame transport, which is what makes print preview possible.
    // The server path posts a form into the iframe *by name* and must own the
    // frame's navigation, so the two are mutually exclusive.
    const useFrame = Boolean(frameUrl) && renderLocally;


    const preview = useCallback(() => {
      const source = content;
      const previewTitle = title || "Document Title";

      // Save scroll position before rebuilding so the author keeps their place.
      // Readable for a local render (same-origin); a cross-origin server
      // preview will throw, which is fine.
      try {
        const iframeWindow = iframeRef.current?.contentWindow;
        if (iframeWindow) {
          savedScrollPosition.current = {
            x: iframeWindow.scrollX,
            y: iframeWindow.scrollY,
          };
        }
      } catch {
        savedScrollPosition.current = null;
      }

      setIsRebuilding(true);

      if (renderLocally) {
        const token = ++renderToken.current;
        const buildStart = performance.now();
        renderPreviewHtml(source, {
          divisionId,
          fragment,
          contextSource,
          docinfo,
          theme,
          bannerMessage,
        })
          .then(({ html, sourceMap, target }) => {
            if (token !== renderToken.current) {
              return;
            }
            sourceMapRef.current = sourceMap;
            setRenderTarget(target);
            setPreviewHtml(html);
            setError(null);
          })
          .catch((err) => {
            if (token !== renderToken.current) {
              return;
            }
            // Keep whatever is already on screen; only report the failure.
            const assembledLine = findWellformednessErrorLine(source);
            const editorLine =
              assembledLine !== undefined
                ? previewLineMap?.toEditor(assembledLine)
                : undefined;
            setError(describePreviewError(err, editorLine));
          })
          .finally(() => {
            if (token === renderToken.current) {
              setIsRebuilding(false);
              if (
                performance.now() - buildStart >
                AUTO_REFRESH_DISABLE_THRESHOLD_MS
              ) {
                setAutoRefreshDisabled(true);
              }
            }
          });
        return;
      }

      // Server path: the host posts the source into our named iframe. It gets
      // the complete document, never the bare fragment the local renderer can
      // place in context — a build server would have nothing to place it in.
      const postHelper = (url: string, data: any) => {
        postToIframe(url, data, "livePreview");
      };
      onRebuild?.(serverContent ?? source, previewTitle, postHelper);
    }, [
      content,
      serverContent,
      title,
      onRebuild,
      renderLocally,
      previewLineMap,
      divisionId,
      fragment,
      contextSource,
      docinfo,
      theme,
      bannerMessage,
      // Note: not revealView/revealZoom. A deck's presentation is applied to
      // the rendered page (see pageHtml), never baked into the render, so
      // changing it must not invalidate this callback.
    ]);

    // The page as it should currently appear. Switching a deck's view or zoom
    // only rewrites reveal's config in HTML we already hold, so it costs a
    // re-delivery rather than a re-render — which for a slideshow is the
    // difference between instant and a second of waiting.
    const pageHtml = useMemo(() => {
      if (previewHtml === null) return null;
      if (renderTarget !== "slides") return previewHtml;
      return applyRevealView(previewHtml, revealView, revealZoom);
    }, [previewHtml, renderTarget, revealView, revealZoom]);

    // ── Delivery into the frame ───────────────────────────────────────────
    // Read by the sender, which must not itself be re-created on every render
    // (it is called from a message handler registered once).
    const pageHtmlRef = useRef<string | null>(null);
    pageHtmlRef.current = pageHtml;
    // Identifies the write in flight, so a page reporting in can be told apart
    // from a freshly navigated (empty) frame. See previewFrame.ts.
    const writeToken = useRef(0);
    const frameReady = useRef(false);

    const sendToFrame = useCallback(() => {
      const frameWindow = iframeRef.current?.contentWindow;
      const html = pageHtmlRef.current;
      if (!frameWindow || html === null) return;
      const token = ++writeToken.current;
      frameWindow.postMessage(
        {
          type: FRAME_WRITE_MESSAGE,
          html: injectFrameBootstrap(html, token),
          token,
        },
        // Not "*": this message carries the author's whole document. The frame
        // is required to be same-origin (the preview is read back through
        // `contentDocument` for click sync), so naming our own origin costs
        // nothing and keeps the source out of anything else that might end up
        // in the frame.
        window.location.origin,
      );
    }, []);

    /**
     * Wire up a document that has just appeared in the frame: preview → source
     * sync, and the scroll position saved before the rebuild.
     *
     * Called once per *document*, which is not once per iframe load — an
     * in-place rewrite replaces the document without any `load` event — so the
     * listener is attached fresh each time and there is nothing to clean up.
     * Passive and non-capturing: the page's own links and knowls behave
     * normally, including the print-preview link, whose navigation is how the
     * frame enters print mode at all.
     */
    const wireRenderedDocument = useCallback(() => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      doc.addEventListener("click", (event) => {
        const entry = entryForClick(event.target, sourceMapRef.current);
        if (entry) {
          onSyncToSourceRef.current?.({
            assembledLine: entry.line,
            elementId: entry.id,
          });
        }
      });
      if (savedScrollPosition.current) {
        try {
          iframeRef.current?.contentWindow?.scrollTo(
            savedScrollPosition.current.x,
            savedScrollPosition.current.y,
          );
        } catch {
          // Cross-origin iframe; scroll position cannot be restored.
        }
        savedScrollPosition.current = null;
      }
    }, []);

    // Point the frame at the shim once. Navigation after this is the frame's
    // own doing (the reader clicking a print-preview link) or an explicit exit
    // below — never React re-applying a prop, which is why `src` is set here
    // rather than in JSX.
    useEffect(() => {
      if (!useFrame || !frameUrl) return;
      const iframe = iframeRef.current;
      if (!iframe) return;
      frameReady.current = false;
      iframe.src = frameSrc(frameUrl, null);
    }, [useFrame, frameUrl]);

    // The frame reports in every time a document loads in it, whether from the
    // network or from one of our writes.
    useEffect(() => {
      if (!useFrame) return;
      const onMessage = (event: MessageEvent) => {
        if (event.source !== iframeRef.current?.contentWindow) return;
        if (!isFrameReadyMessage(event.data)) return;
        setPrintoutId(printoutIdFromSearch(event.data.search));
        if (event.data.token === undefined) {
          // A document that came from the network: the shim, empty and waiting
          // for content. Reached on first load and whenever the reader clicks a
          // print-preview link, which navigates the frame to the same shim with
          // `?printpreview=` set — so simply re-sending the page is all it
          // takes to enter (or leave) print preview.
          frameReady.current = true;
          sendToFrame();
        } else if (event.data.token === writeToken.current) {
          wireRenderedDocument();
        }
        // Any other token is a write that has since been superseded.
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }, [useFrame, sendToFrame, wireRenderedDocument]);

    // Deliver each new page. Skipped until the frame has reported in at least
    // once, since a window mid-navigation has nowhere to put it; the report
    // itself sends whatever is current.
    useEffect(() => {
      if (!useFrame || !frameReady.current) return;
      sendToFrame();
    }, [pageHtml, useFrame, sendToFrame]);

    /** Leave print preview: back to the plain frame URL. */
    const exitPrintPreview = useCallback(() => {
      if (!frameUrl) return;
      const iframe = iframeRef.current;
      if (!iframe) return;
      frameReady.current = false;
      savedScrollPosition.current = null;
      iframe.src = frameSrc(frameUrl, null);
    }, [frameUrl]);

    // Follow the host's theme without re-rendering. Only meaningful when the
    // host drives the theme at all — otherwise no bridge was injected and the
    // message goes nowhere.
    useEffect(() => {
      if (!theme) return;
      iframeRef.current?.contentWindow?.postMessage(
        previewThemeMessage(theme),
        window.location.origin,
      );
    }, [theme, pageHtml]);

    // Rebuild when the preview opens, and whenever the author switches to a
    // different division — otherwise the page on screen belongs to the
    // division they just left, and both sync directions would be translating
    // between two unrelated documents.
    //
    // Not on every content change: rebuilds are otherwise driven by save
    // (Ctrl+S), Ctrl+Enter, the Rebuild button, and — when rendering
    // locally — the debounced effect below, so a half-typed document is
    // never rendered through the (comparatively expensive) server path.
    useEffect(() => {
      // Before the first render, so the very first page already knows its
      // theme. Not needed when the host drives it: the injected bridge does.
      if (!theme) defaultPreviewToLight();
      preview();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [divisionId]);

    // Local renders are cheap enough (~90ms warm) to keep the preview live
    // while typing. Debounced 1s past the last keystroke rather than firing
    // on every change, so a fast typist doesn't queue up a render per
    // character. Server builds stay manual-only (see effect above) — a
    // network round trip on every pause would be both slow and wasteful.
    useEffect(() => {
      if (!renderLocally || autoRefreshDisabled) return;
      const timer = setTimeout(() => {
        preview();
      }, 1000);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, renderLocally, autoRefreshDisabled]);

    useImperativeHandle(
      ref,
      () => ({
        rebuild: preview,
        scrollToAssembledLine: (assembledLine: number) => {
          void (async () => {
            const sourceMap = sourceMapRef.current;
            const entry = await findEntryForLine(sourceMap, assembledLine);
            const doc = iframeRef.current?.contentDocument;
            if (!entry || !doc) return;
            const element = elementForEntry(doc, sourceMap, entry);
            element?.scrollIntoView({ block: "center", behavior: "smooth" });
          })();
        },
      }),
      [preview],
    );

    const handleIframeLoad = () => {
      // A local render settles its own rebuilding state once the promise
      // resolves; the server path has nothing else to tell it that the build
      // finished.
      if (!renderLocally) {
        setIsRebuilding(false);
      }
      // With the served frame, a `load` is the *shim* arriving, not a rendered
      // page — the page is written into it afterwards, and reports itself.
      if (renderLocally && !useFrame) {
        wireRenderedDocument();
      }
    };

    const isSlideshow = renderTarget === "slides";
    const zoomPercent = Math.round(revealZoom * 100);
    const stepZoom = (delta: number) =>
      setRevealZoom((current) =>
        Math.min(
          REVEAL_ZOOM_MAX,
          Math.max(
            REVEAL_ZOOM_MIN,
            // Rounded because repeated float steps drift off the step grid.
            Math.round((current + delta) * 100) / 100,
          ),
        ),
      );

    return (
      <div className="pretext-plus-editor__full-preview">
        <div className="pretext-plus-editor__preview-header">
          <p className="pretext-plus-editor__preview-title">
            {printoutId ? "Print Preview" : "Live Preview"}
          </p>
          <div className="pretext-plus-editor__preview-actions">
            {printoutId && (
              <button
                className="pretext-plus-editor__preview-button"
                onClick={exitPrintPreview}
                title="Return to the live preview"
              >
                Exit print preview
              </button>
            )}
            {isSlideshow && !printoutId && (
              <>
                <span
                  className="pretext-plus-editor__preview-zoom"
                  role="group"
                  aria-label="Slide zoom"
                >
                  <button
                    className="pretext-plus-editor__preview-button"
                    onClick={() => stepZoom(-REVEAL_ZOOM_STEP)}
                    disabled={revealZoom <= REVEAL_ZOOM_MIN}
                    title="Zoom out: smaller text, so more of each slide is visible"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <span className="pretext-plus-editor__preview-zoom-value">
                    {zoomPercent}%
                  </span>
                  <button
                    className="pretext-plus-editor__preview-button"
                    onClick={() => stepZoom(REVEAL_ZOOM_STEP)}
                    disabled={revealZoom >= REVEAL_ZOOM_MAX}
                    title="Zoom in, up to the deck's true presented size"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                </span>
                <span
                  className="pretext-plus-editor__preview-segmented"
                  role="group"
                  aria-label="Slideshow view"
                >
                  <button
                    className="pretext-plus-editor__preview-button"
                    aria-pressed={revealView === "scroll"}
                    onClick={() => setRevealView("scroll")}
                    title="Show the whole deck as one scrolling page"
                  >
                    Deck
                  </button>
                  <button
                    className="pretext-plus-editor__preview-button"
                    aria-pressed={revealView === "slides"}
                    onClick={() => setRevealView("slides")}
                    title="Show one slide at a time, with pauses, as it will be presented"
                  >
                    Present
                  </button>
                </span>
              </>
            )}
            <button
              className="pretext-plus-editor__rebuild-button"
              onClick={() => preview()}
            >
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <div
            className="pretext-plus-editor__preview-error"
            role="status"
            aria-live="polite"
          >
            <span className="pretext-plus-editor__preview-error-text">
              <strong>Preview not updated:</strong> {error}
            </span>
            <button
              className="pretext-plus-editor__preview-error-dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss preview error"
            >
              ×
            </button>
          </div>
        )}
        {autoRefreshDisabled && (
          <div
            className="pretext-plus-editor__preview-autopause"
            role="status"
            aria-live="polite"
          >
            <span className="pretext-plus-editor__preview-autopause-text">
              A recent preview took longer than expected.
              Use Refresh to manually preview.
            </span>
            <button
              className="pretext-plus-editor__preview-autopause-button"
              onClick={() => setAutoRefreshDisabled(false)}
            >
              Re-enable auto-refresh
            </button>
          </div>
        )}
        <div className="pretext-plus-editor__preview-container">
          {/*
            A warm local render takes ~90ms — a full-screen modal would strobe.
            The blocking overlay is kept for the two cases that genuinely take
            a while: a server build, and the first local render of a session
            (which downloads and instantiates the WASM renderer). After that a
            subtle pill is enough.
          */}
          {isRebuilding &&
            (!renderLocally || previewHtml === null ? (
              <div className="pretext-plus-editor__rebuilding-overlay">
                <div className="pretext-plus-editor__rebuilding-popup">
                  <div className="pretext-plus-editor__spinner"></div>
                  <p className="pretext-plus-editor__rebuilding-text">
                    {renderLocally ? "Preparing preview..." : "Rebuilding..."}
                  </p>
                </div>
              </div>
            ) : (
              <div
                className="pretext-plus-editor__rebuilding-pill"
                role="status"
                aria-live="polite"
              >
                Updating…
              </div>
            ))}
          <iframe
            ref={iframeRef}
            className="pretext-plus-editor__preview-iframe"
            name="livePreview"
            title="PreTeXt preview"
            onLoad={handleIframeLoad}
            // Three transports, one element. The served frame owns its own
            // `src` (set imperatively, so print-preview navigation sticks);
            // srcdoc drives the local path when no frame URL is available; and
            // the server path posts a form into this iframe by name, so it must
            // have neither attribute set.
            {...(!useFrame && renderLocally && pageHtml !== null
              ? { srcDoc: pageHtml }
              : {})}
          />
          {showBrowserTip && (
            <div
              className="pretext-plus-editor__browser-tip"
              role="status"
              aria-live="polite"
            >
              <span className="pretext-plus-editor__browser-tip-text">
                Tip: Previews refresh much faster and have two-way sync in
                Chromium-based browsers like Chrome or Edge.
              </span>
            </div>
          )}
        </div>
      </div>
    );
  },
);

LivePreview.displayName = "LivePreview";

export default LivePreview;
