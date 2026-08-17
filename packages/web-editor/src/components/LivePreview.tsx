import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import clsx from "clsx";
import { postToIframe } from "./postToIframe";
import {
  applyPrintPreview,
  applyRevealView,
  describePreviewError,
  findEntryById,
  findEntryForLine,
  findWellformednessErrorLine,
  isLocalPreviewAvailable,
  previewThemeMessage,
  renderPreviewHtml,
  type PreviewTheme,
  type PrintoutInfo,
  type RevealView,
} from "./wasmPreview";
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
   * Which conversion this document needs — `"slides"` for a `<slideshow>`
   * root, `"html"` otherwise. Only consulted on the server path: a local
   * render reports its own target back from the renderer, which is more
   * reliable than anything a caller can assert.
   *
   * This is pretext-html's vocabulary. A build server that spells the deck
   * conversion differently (the PreTeXt CLI calls it `revealjs`) is the host's
   * business to translate in `onRebuild`.
   */
  documentTarget?: "html" | "slides";
  /**
   * Server-side rebuild handler. Optional: when the browser can render
   * locally (WebAssembly JSPI), the preview builds in-page and this is never
   * called. It remains the fallback for engines without JSPI, so hosts that
   * must support them should keep providing it.
   *
   * `target` is {@link LivePreviewProps.documentTarget}. Without it a build
   * server has to guess the conversion by scanning the source, which is how a
   * deck ends up built as a website.
   */
  onRebuild?: (
    content: string,
    title: string,
    postToIframe: (url: string, data: any) => void,
    target: "html" | "slides",
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

// Secondary controls: view toggles and zoom.
// `aria-pressed:` highlights the active half of a segmented control.
const PREVIEW_BUTTON_CLASSES =
  "rounded-sm py-[0.3125rem] px-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 cursor-pointer leading-none transition-colors duration-200 ease-in-out enabled:hover:bg-gray-100 disabled:opacity-[0.45] disabled:cursor-default aria-pressed:text-emerald-800 aria-pressed:bg-emerald-100 aria-pressed:border-emerald-300";
// Segmented pairs read as one control: shared border, square inner corners.
// Applied only to buttons rendered inside a two-button .preview-zoom /
// .preview-segmented group (never a lone button like "Exit print preview"),
// where `first:`/`last:` resolve against exactly that pair of siblings.
const PREVIEW_BUTTON_SEGMENTED_CLASSES =
  "first:rounded-r-none last:rounded-l-none last:-ml-px";

const LivePreview = forwardRef<LivePreviewHandle, LivePreviewProps>(
  (
    {
      content,
      serverContent,
      title,
      documentTarget = "html",
      onRebuild,
      onSyncToSource,
      divisionId,
      previewLineMap,
      fragment,
      contextSource,
      docinfo,
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
    // The page's printouts, and which of them (if any) is being shown laid out
    // for paper. Both are applied to the rendered page rather than baked into
    // it, so switching costs a re-delivery and not a re-render.
    const [printouts, setPrintouts] = useState<PrintoutInfo[]>([]);
    const [printoutId, setPrintoutId] = useState<string | null>(null);
    // Which division the print selection above belongs to. Re-rendering the
    // same division on every keystroke must not drag the author out of print
    // preview — or back into it — so the default is applied once per division
    // rather than once per render. The initial `null` is a sentinel no
    // `divisionId` can equal, including `undefined` in document mode.
    const printoutDivision = useRef<string | undefined | null>(null);
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
        renderPreviewHtml(source, {
          divisionId,
          fragment,
          contextSource,
          docinfo,
          theme,
          bannerMessage,
        })
          .then(({ html, sourceMap, target, printouts, rootPrintout }) => {
            if (token !== renderToken.current) {
              return;
            }
            sourceMapRef.current = sourceMap;
            setRenderTarget(target);
            setPrintouts(printouts);
            if (printoutDivision.current !== divisionId) {
              // A division the author has just switched to. Open it on paper
              // when the division *is* a printout — editing `worksheet-3.ptx`,
              // where the paper layout is the whole point — and on screen when
              // it merely contains some.
              printoutDivision.current = divisionId;
              setPrintoutId(rootPrintout ?? null);
            } else {
              // Same division, edited: the printout being shown may have just
              // been renamed or deleted out from under the selection.
              setPrintoutId((current) =>
                current && printouts.some((printout) => printout.id === current)
                  ? current
                  : null,
              );
            }
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
      onRebuild?.(serverContent ?? source, previewTitle, postHelper, documentTarget);
    }, [
      content,
      serverContent,
      title,
      documentTarget,
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

    // The page as it should currently appear. Switching a deck's view or zoom,
    // or entering and leaving print preview, only rewrites a small bridge in
    // HTML we already hold, so each costs a re-delivery rather than a
    // re-render — which for a slideshow is the difference between instant and
    // a second of waiting.
    const pageHtml = useMemo(() => {
      if (previewHtml === null) return null;
      const page =
        renderTarget === "slides"
          ? applyRevealView(previewHtml, revealView, revealZoom)
          : previewHtml;
      // Unconditionally, "off" included: the print bridge keeps its answer on
      // a window property, so a page delivered without one would inherit
      // whatever the previous delivery said.
      return applyPrintPreview(page, printoutId ?? undefined);
    }, [previewHtml, renderTarget, revealView, revealZoom, printoutId]);

    /**
     * Wire up a document that has just appeared in the iframe: preview → source
     * sync, and the scroll position saved before the rebuild.
     *
     * Called once per loaded document, so the listener is attached fresh each
     * time and there is nothing to clean up. Passive and non-capturing: the
     * page's own links and knowls behave normally.
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
      if (!renderLocally) return;
      const timer = setTimeout(() => {
        preview();
      }, 1000);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, renderLocally]);

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
      } else {
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
      <div className="flex flex-col w-full h-full">
        <div className="relative flex items-center justify-center pt-2 pb-2 bg-[#f3f3f3] border-b border-[#dde0e6]">
          <p className="text-base font-medium m-0 text-center">
            {printoutId ? "Print Preview" : "Live Preview"}
          </p>
          <div className="absolute right-2 flex items-center gap-1.5">
            {/*
              PreTeXt's own printer icon on each printout is deliberately inert
              in a preview render — the URL it would reload does not exist — so
              the paper layout is offered from here instead. Absent for a page
              with no printouts, where there is nothing to lay out.
            */}
            {!isSlideshow && printouts.length > 0 && (
              <select
                className={clsx(
                  "rounded-sm py-1 px-1.5 max-w-56 text-xs font-semibold border cursor-pointer leading-tight",
                  printoutId
                    ? "text-emerald-800 bg-emerald-100 border-emerald-300"
                    : "text-gray-700 bg-white border-gray-300 hover:bg-gray-100",
                )}
                // Mirrored onto the element to match the `aria-pressed:`
                // data-driven pattern the other preview controls below use.
                data-layout={printoutId ?? ""}
                aria-label="Preview layout"
                title="Lay a worksheet or handout out for print, with each workspace at the height the author asked for"
                value={printoutId ?? ""}
                onChange={(event) =>
                  setPrintoutId(event.target.value || null)
                }
              >
                <option value="">Web view</option>
                <optgroup label="Print preview">
                  {printouts.map((printout) => (
                    <option key={printout.id} value={printout.id}>
                      {printout.label || printout.id}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
            {isSlideshow && (
              <>
                <span
                  className="inline-flex items-center"
                  role="group"
                  aria-label="Slide zoom"
                >
                  <button
                    className={clsx(
                      PREVIEW_BUTTON_CLASSES,
                      PREVIEW_BUTTON_SEGMENTED_CLASSES,
                    )}
                    onClick={() => stepZoom(-REVEAL_ZOOM_STEP)}
                    disabled={revealZoom <= REVEAL_ZOOM_MIN}
                    title="Zoom out: smaller text, so more of each slide is visible"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <span className="min-w-12 px-1 text-center text-[0.6875rem] font-semibold [font-variant-numeric:tabular-nums] text-gray-600">
                    {zoomPercent}%
                  </span>
                  <button
                    className={clsx(
                      PREVIEW_BUTTON_CLASSES,
                      PREVIEW_BUTTON_SEGMENTED_CLASSES,
                    )}
                    onClick={() => stepZoom(REVEAL_ZOOM_STEP)}
                    disabled={revealZoom >= REVEAL_ZOOM_MAX}
                    title="Zoom in, up to the deck's true presented size"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                </span>
                <span
                  className="inline-flex items-center"
                  role="group"
                  aria-label="Slideshow view"
                >
                  <button
                    className={clsx(
                      PREVIEW_BUTTON_CLASSES,
                      PREVIEW_BUTTON_SEGMENTED_CLASSES,
                    )}
                    aria-pressed={revealView === "scroll"}
                    onClick={() => setRevealView("scroll")}
                    title="Show the whole deck as one scrolling page"
                  >
                    Deck
                  </button>
                  <button
                    className={clsx(
                      PREVIEW_BUTTON_CLASSES,
                      PREVIEW_BUTTON_SEGMENTED_CLASSES,
                    )}
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
              className="rounded-sm py-1.5 px-3 text-xs font-semibold text-white bg-emerald-500 border-none cursor-pointer shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] transition-colors duration-200 ease-in-out hover:bg-emerald-600 active:bg-emerald-700"
              onClick={() => preview()}
            >
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <div
            className="flex items-start gap-2 m-0 mb-2 py-2 px-3 border-l-[3px] border-amber-500 bg-amber-50 text-amber-900 text-[0.8125rem] leading-[1.4]"
            role="status"
            aria-live="polite"
          >
            <span className="flex-1 [overflow-wrap:anywhere]">
              <strong>Preview not updated:</strong> {error}
            </span>
            <button
              className="shrink-0 border-none bg-transparent cursor-pointer text-amber-900 text-base leading-none px-1 hover:text-amber-950"
              onClick={() => setError(null)}
              aria-label="Dismiss preview error"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/*
            A warm local render takes ~90ms — a full-screen modal would strobe.
            The blocking overlay is kept for the two cases that genuinely take
            a while: a server build, and the first local render of a session
            (which downloads and instantiates the WASM renderer). After that a
            subtle pill is enough.
          */}
          {isRebuilding &&
            (!renderLocally || previewHtml === null ? (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-[1000]">
                <div className="bg-white rounded-lg py-8 px-12 shadow-[0_10px_25px_rgba(0,0,0,0.3)] flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-4 border-gray-200 border-t-emerald-500 rounded-full animate-[spin_0.8s_linear_infinite]"></div>
                  <p className="m-0 text-lg font-medium text-gray-800">
                    {renderLocally ? "Preparing preview..." : "Rebuilding..."}
                  </p>
                </div>
              </div>
            ) : (
              <div
                className="absolute top-2 right-3 z-[1000] rounded-full py-0.5 px-2.5 text-[0.6875rem] font-semibold text-emerald-800 bg-emerald-100 shadow-[0_1px_2px_0_rgba(0,0,0,0.08)] pointer-events-none"
                role="status"
                aria-live="polite"
              >
                Updating…
              </div>
            ))}
          <iframe
            ref={iframeRef}
            className="flex flex-col w-full h-full border-none"
            name="livePreview"
            title="PreTeXt preview"
            onLoad={handleIframeLoad}
            // Two transports, one element. A local render is delivered as
            // `srcdoc`; the server path posts a form into this iframe *by
            // name*, so it must have no `srcdoc` attribute set at all.
            {...(renderLocally && pageHtml !== null ? { srcDoc: pageHtml } : {})}
          />
          {showBrowserTip && (
            <div
              className="absolute left-3 right-3 bottom-3 z-[1000] flex items-center gap-2 py-2 px-3 rounded-md bg-gray-800 text-gray-50 text-[0.8125rem] leading-[1.4] shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
              role="status"
              aria-live="polite"
            >
              <span className="flex-1">
                Tip: Previews refresh much faster, handle assets better, and have two-way sync in
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
