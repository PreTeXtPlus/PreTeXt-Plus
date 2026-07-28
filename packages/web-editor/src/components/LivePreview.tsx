import {
  useEffect,
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import "./LivePreview.css";
import { postToIframe } from "./postToIframe";
import {
  describePreviewError,
  findEntryById,
  findEntryForLine,
  isLocalPreviewAvailable,
  renderPreviewHtml,
} from "./wasmPreview";
import type { PtxSourceMap, SourceMapEntry } from "@pretextbook/pretext-html";

interface LivePreviewProps {
  content: string;
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
   */
  divisionId?: string;
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
 * The key pretext-core.js reads to decide light/dark. Because the preview is a
 * `srcdoc` iframe it shares this origin — and so this exact `localStorage` —
 * with the editor, which is what makes an author's choice in the preview's own
 * readability menu survive every rebuild without any help from us.
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

/** localStorage key backing {@link isBrowserTipDismissed}. */
const BROWSER_TIP_DISMISSED_KEY = "pretext-plus-editor:browser-tip-dismissed";

/**
 * Has the author already dismissed the "use Chrome for a faster
 * preview" tip?
 *
 * This banner only shows up for authors on a browser without WebAssembly JSPI
 * (see isLocalPreviewAvailable above) — Firefox and Safari, as of this
 * writing — who are therefore paying for a server round-trip on every
 * rebuild. It's worth suggesting Chromium, but only once per author per session,
 * not once per page load.
 *
 * We don't persist this across sessions in case the author forgets and comes back to
 * a non-Chromium browser later, but we do persist it across page reloads so the
 * tip doesn't reappear every time the author hits Ctrl+Enter.
 */
function isBrowserTipDismissed(): boolean {
  // Check if the tip is dismissed in the current session.
  try {
    const dismissed = sessionStorage.getItem(BROWSER_TIP_DISMISSED_KEY);
    if (dismissed === "true") {
      return true;
    }
  } catch {
    // Storage unavailable (private mode, blocked cookies). The tip will
    // reappear on every page load, which is fine.
  }
  return false;
}

/** TODO(you): record that the author dismissed the tip, per the same call. */
function dismissBrowserTip(): void {
  // TODO(you): persist (or record in-session) that the tip was dismissed.
}

const LivePreview = forwardRef<LivePreviewHandle, LivePreviewProps>(
  ({ content, title, onRebuild, onSyncToSource, divisionId }, ref) => {
    const [isRebuilding, setIsRebuilding] = useState(false);
    const [browserTipDismissed, setBrowserTipDismissed] = useState(
      isBrowserTipDismissed,
    );
    // The last render that succeeded. Kept across failures so a transient
    // typo does not blank the panel and lose the author's place.
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
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
    const showBrowserTip = !renderLocally && !browserTipDismissed;

    const preview = useCallback(() => {
      const source = content;
      const previewTitle = title || "Document Title";

      // Save scroll position before rebuilding so the author keeps their place.
      // Readable for a local render (srcdoc inherits this origin); a
      // cross-origin server preview will throw, which is fine.
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
        renderPreviewHtml(source)
          .then(({ html, sourceMap }) => {
            if (token !== renderToken.current) {
              return;
            }
            sourceMapRef.current = sourceMap;
            setPreviewHtml(html);
            setError(null);
          })
          .catch((err) => {
            if (token !== renderToken.current) {
              return;
            }
            // Keep whatever is already on screen; only report the failure.
            setError(describePreviewError(err));
          })
          .finally(() => {
            if (token === renderToken.current) {
              setIsRebuilding(false);
            }
          });
        return;
      }

      // Server path: the host posts the source into our named iframe.
      const postHelper = (url: string, data: any) => {
        postToIframe(url, data, "livePreview");
      };
      onRebuild?.(source, previewTitle, postHelper);
    }, [content, title, onRebuild, renderLocally]);

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
      // Before the first render, so the very first page already knows its theme.
      defaultPreviewToLight();
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
      }

      // Preview → source. Attached per loaded document; each render replaces
      // the document wholesale, so there is nothing to clean up. Passive and
      // non-capturing: the page's own links and knowls behave normally.
      if (renderLocally) {
        const doc = iframeRef.current?.contentDocument;
        doc?.addEventListener("click", (event) => {
          const entry = entryForClick(event.target, sourceMapRef.current);
          if (entry) {
            onSyncToSourceRef.current?.({
              assembledLine: entry.line,
              elementId: entry.id,
            });
          }
        });
      }
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
    };

    return (
      <div className="pretext-plus-editor__full-preview">
        <div className="pretext-plus-editor__preview-header">
          <p className="pretext-plus-editor__preview-title">Live Preview</p>
          <button
            className="pretext-plus-editor__rebuild-button"
            onClick={() => preview()}
          >
            Refresh
          </button>
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
            // srcdoc drives the local path; the server path posts a form into
            // this iframe by name instead and must not have srcdoc set.
            {...(renderLocally && previewHtml !== null
              ? { srcDoc: previewHtml }
              : {})}
          />
          {showBrowserTip && (
            <div
              className="pretext-plus-editor__browser-tip"
              role="status"
              aria-live="polite"
            >
              <span className="pretext-plus-editor__browser-tip-text">
                Previews refresh much faster and have two-way sync in
                Chrome-based browsers.
              </span>
              <button
                className="pretext-plus-editor__browser-tip-dismiss"
                onClick={() => {
                  setBrowserTipDismissed(true);
                  dismissBrowserTip();
                }}
                aria-label="Dismiss browser suggestion"
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    );
  },
);

LivePreview.displayName = "LivePreview";

export default LivePreview;
