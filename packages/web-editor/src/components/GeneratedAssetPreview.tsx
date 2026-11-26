import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import clsx from "clsx";
import type { Asset } from "../types/editor";
import { PREVIEW_IMAGE_CLASS } from "./AssetPreview";
import {
  docinfoInputsFor,
  GeneratorRenderError,
  generatorFor,
  renderInputFor,
  sha256Hex,
  type DocinfoInputs,
  type GeneratorRuntime,
  type GeneratorRuntimeStatus,
} from "../generators";

/** A finished browser render, handed to the host to store with the asset. */
export interface GeneratedAssetOutput {
  /** The picture, as SVG markup. */
  svg: string;
  /** sha256 of the render input the picture was built from. */
  previewInputDigest: string;
}

export interface GeneratedAssetPreviewProps {
  asset: Asset;
  /** The docinfo in force, parts of which are the render's input (`docinfoInputElements`). */
  docinfo: string;
  /** The generator's engine, or undefined when the host configured none. */
  runtime: GeneratorRuntime | undefined;
  /**
   * A render of the current source, for the host to store. Rejecting means it
   * was not stored: the pane says so and offers to try again.
   */
  onOutput?: (asset: Asset, output: GeneratedAssetOutput) => Promise<void> | void;
  /** Where the stored picture downloads from, when that isn't `asset.url` (see `Editors`). */
  downloadUrlFor?: (asset: Asset) => string | undefined;
  readOnly?: boolean;
  /** How long typing must settle before a render; tests shorten it. */
  debounceMs?: number;
}

/** What `Editors` can ask of the pane: a render, for a generator rendered on request. */
export interface GeneratedAssetPreviewHandle {
  /** Render the source as it is now. Nothing happens for a generator that renders live. */
  render(): void;
}

/** Typing settles for this long before the engine is asked to render. */
export const RENDER_DEBOUNCE_MS = 1000;

const useRuntimeStatus = (runtime: GeneratorRuntime | undefined) => {
  const [, bump] = useState(0);
  useEffect(() => runtime?.subscribe(() => bump((n) => n + 1)), [runtime]);
  return {
    status: (runtime?.status ?? "idle") as GeneratorRuntimeStatus,
    progress: runtime?.progress,
    error: runtime?.error,
  };
};

/** Whole seconds since `startedAt`, ticking while it is set; 0 when it is null. */
const useElapsedSeconds = (startedAt: number | null) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
};

/**
 * The preview panel while a generated asset is open. The engine is started as
 * soon as the pane mounts with one (it is a few megabytes, fetched once per
 * page); until it is up, the stored picture shows with a line saying whether it
 * matches the current source. Then the engine renders — a second after typing
 * stops for an engine in the browser (`renderTrigger: "live"`), or on the
 * author's Render for one on a build server (`"manual"`), where each render is
 * a job on a shared queue. The previous picture stays up and an engine error
 * shows beneath it (with its whole transcript folded away, for an engine that
 * keeps one), and each fresh picture goes to the host through `onOutput` with
 * the digest of exactly the source rendered — so a keystroke that lands
 * mid-render leaves the stored picture honestly stale rather than wrongly
 * current. A picture the host fails to store is reported beneath it, with a
 * retry. The picture on screen, fresh or stored, can be downloaded as
 * `<ref>.svg`.
 *
 * A generator with a tactile output (PreFigure) gets a Visual / Tactile switch.
 * Tactile renders live the same way, but are only shown and offered for
 * download (`<ref>-tactile.svg`), never stored: the asset's picture is visual.
 *
 * Holds the picture of one asset, so `Editors` gives each asset its own pane.
 */
const GeneratedAssetPreview = forwardRef<GeneratedAssetPreviewHandle, GeneratedAssetPreviewProps>(
  function GeneratedAssetPreview(
    { asset, docinfo, runtime, onOutput, downloadUrlFor, readOnly, debounceMs = RENDER_DEBOUNCE_MS },
    ref,
  ) {
    const generator = generatorFor(asset.sourceFormat);
    const manual = generator?.renderTrigger === "manual";
    const { status, progress, error: loadError } = useRuntimeStatus(runtime);
    const source = asset.source ?? "";

    // The digest of what the buffer holds now, for the "current / out of date" line.
    const [currentDigest, setCurrentDigest] = useState<string | null>(null);
    useEffect(() => {
      if (!generator) return;
      let live = true;
      void sha256Hex(renderInputFor(generator, source, docinfo)).then((hex) => {
        if (live) setCurrentDigest(hex);
      });
      return () => {
        live = false;
      };
    }, [generator, source, docinfo]);

    // Start the engine once there is something to render with it. A read-only
    // view has nothing to re-render: the stored picture is the picture.
    useEffect(() => {
      if (runtime && status === "idle" && generator && !readOnly) void runtime.load().catch(() => {});
    }, [runtime, status, generator, readOnly]);

    const [rendered, setRendered] = useState<{ url: string; digest: string } | null>(null);
    // Which output the pane shows, for a generator with a tactile one.
    const [view, setView] = useState<"visual" | "tactile">("visual");
    const tactileView = view === "tactile" && !!generator?.tactile;
    const [tactile, setTactile] = useState<{ url: string; digest: string } | null>(null);
    const [isRendering, setIsRendering] = useState(false);
    const [renderProgress, setRenderProgress] = useState<string | null>(null);
    // When the render under way began, for the seconds beside a server render's progress.
    const [renderStartedAt, setRenderStartedAt] = useState<number | null>(null);
    const elapsed = useElapsedSeconds(manual ? renderStartedAt : null);
    // Which output's render failed, so switching views shows only its own error.
    const [renderError, setRenderError] = useState<{ message: string; log?: string; tactile: boolean } | null>(null);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const [saveFailure, setSaveFailure] = useState<{ message: string; output: GeneratedAssetOutput } | null>(null);
    // What the host has been handed this session, so the same render is not sent twice.
    const sentDigests = useRef(new Set<string>());
    // The props as of the latest render. A render is awaited across keystrokes,
    // and its closure's `source` is by definition the one it rendered, so whether
    // typing has overtaken it — and which asset to hand the host — is read here.
    const latest = useRef({ asset, source, docinfo, onOutput });
    useEffect(() => {
      latest.current = { asset, source, docinfo, onOutput };
    });

    // Hand the host a render to store. A failure forgets the digest, so a retry —
    // or the same source rendered again — can send it anew.
    const store = async (output: GeneratedAssetOutput) => {
      const { asset: current, onOutput: send } = latest.current;
      if (!send) return;
      sentDigests.current.add(output.previewInputDigest);
      setSaveFailure(null);
      try {
        await send(current, output);
      } catch (cause) {
        sentDigests.current.delete(output.previewInputDigest);
        setSaveFailure({ message: cause instanceof Error ? cause.message : String(cause), output });
      }
    };

    useEffect(() => () => void (rendered && URL.revokeObjectURL(rendered.url)), [rendered]);
    useEffect(() => () => void (tactile && URL.revokeObjectURL(tactile.url)), [tactile]);

    // Render `source` against `docinfo`: show the picture, and hand the host
    // only a render of the source as it is *now* — one that typing has
    // overtaken is shown but not stored. A tactile render is only shown.
    const runRender = async (renderSource: string, renderDocinfo: string, asTactile = false) => {
      if (!runtime || !generator) return;
      const inputs: DocinfoInputs = docinfoInputsFor(generator, renderDocinfo);
      setIsRendering(true);
      setRenderProgress(null);
      setRenderStartedAt(Date.now());
      try {
        const result = await runtime.render(renderSource, {
          docinfo: inputs,
          ref: latest.current.asset.ref,
          onProgress: (message) => setRenderProgress(message),
          ...(asTactile ? { tactile: true } : {}),
        });
        const digest = await sha256Hex(renderInputFor(generator, result.source, renderDocinfo));
        setRenderError((previous) => (previous?.tactile === asTactile ? null : previous));
        if (asTactile) {
          setTactile({ url: URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" })), digest });
          return;
        }
        setRendered((previous) => {
          if (previous) URL.revokeObjectURL(previous.url);
          return { url: URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" })), digest };
        });
        const now = latest.current;
        const liveDigest = await sha256Hex(renderInputFor(generator, now.source, now.docinfo));
        if (digest === liveDigest && digest !== now.asset.previewInputDigest && !sentDigests.current.has(digest)) {
          void store({ svg: result.svg, previewInputDigest: digest });
        }
      } catch (cause) {
        setRenderError({
          message: cause instanceof Error ? cause.message : String(cause),
          log: cause instanceof GeneratorRenderError ? cause.log : undefined,
          tactile: asTactile,
        });
      } finally {
        setIsRendering(false);
        setRenderProgress(null);
        setRenderStartedAt(null);
      }
    };
    // Read by the debounce's timeout and the button, both after render, so the
    // ref is written where `latest` is.
    const runRenderRef = useRef(runRender);
    useEffect(() => {
      runRenderRef.current = runRender;
    });

    const canRender = !!runtime && status === "ready" && !!generator && !!asset.ref && !readOnly;

    // A live engine renders on a debounce whenever the source (or docinfo)
    // change; a manual one only when asked. Only the output on view renders,
    // at once when the author has just switched to it — unless its picture is
    // already of the source as it stands.
    const shownDigest = tactileView ? tactile?.digest : rendered?.digest;
    const upToDate = !!currentDigest && shownDigest === currentDigest;
    const lastView = useRef(tactileView);
    useEffect(() => {
      const switched = lastView.current !== tactileView;
      lastView.current = tactileView;
      if (manual || !canRender || upToDate) return;
      const timer = setTimeout(
        () => void runRenderRef.current(source, docinfo, tactileView),
        switched ? 0 : debounceMs,
      );
      return () => clearTimeout(timer);
    }, [manual, canRender, source, docinfo, debounceMs, tactileView, upToDate]);

    const renderNow = () => {
      if (!manual || !canRender || isRendering) return;
      void runRenderRef.current(latest.current.source, latest.current.docinfo);
    };
    useImperativeHandle(ref, () => ({ render: renderNow }));

    if (!generator) {
      return (
        <div data-testid="asset-preview" className="flex flex-1 h-full items-center justify-center p-6 bg-[#fafafa] text-[0.9rem] text-slate-500">
          Unknown generator “{asset.sourceFormat}”.
        </div>
      );
    }

    const storedIsCurrent = !!asset.url && !!currentDigest && asset.previewInputDigest === currentDigest;
    const showingFresh = rendered && rendered.digest === currentDigest;
    // A tactile picture is never stored, so the tactile view has only its renders.
    const imageUrl = tactileView ? tactile?.url : (rendered?.url ?? asset.url);
    const hasPicture = !!imageUrl;
    // A render is already here as a blob. The stored file may be a redirect to
    // another origin, where `download` is ignored, so the host says how to ask for
    // it as an attachment; a new tab keeps the editor if a host hasn't.
    const downloadUrl = tactileView ? tactile?.url : (rendered?.url ?? downloadUrlFor?.(asset) ?? asset.url);
    const viewError = renderError && renderError.tactile === tactileView ? renderError : null;

    const rendering = `${renderProgress ?? "Making preview…"}${manual && elapsed > 0 ? ` (${elapsed}s)` : ""}`;
    let statusLine: string;
    if (isRendering) statusLine = rendering;
    else if (tactileView) {
      if (tactile && tactile.digest === currentDigest) statusLine = "Tactile version, up to date.";
      else if (tactile) statusLine = "The source has changed since this preview.";
      else statusLine = "No tactile preview yet.";
    } else if (showingFresh || (!rendered && storedIsCurrent)) statusLine = "Up to date.";
    else if (rendered || asset.url) statusLine = "The source has changed since this preview.";
    else statusLine = manual && canRender ? "Click Preview to see the image." : "No preview yet.";

    return (
      <div
        data-testid="asset-preview"
        className="flex flex-1 h-full min-h-0 flex-col items-center justify-center gap-3 p-6 bg-[#fafafa]"
      >
        {generator.tactile && runtime && !readOnly && (
          <div
            role="group"
            aria-label="Diagram output"
            data-testid="generated-asset-view"
            className="flex flex-none overflow-hidden rounded border border-slate-300 text-[0.8rem]"
          >
            {(["visual", "tactile"] as const).map((option) => (
              <button
                key={option}
                type="button"
                data-testid={`generated-asset-view-${option}`}
                aria-pressed={view === option}
                title={
                  option === "visual"
                    ? "The diagram as it appears on the page"
                    : "The diagram for embossing or a tactile display, with braille labels"
                }
                className={clsx(
                  "px-3 py-1",
                  option === "tactile" && "border-l border-slate-300",
                  view === option ? "bg-slate-700 text-white" : "bg-white text-slate-800 hover:bg-slate-100",
                )}
                onClick={() => setView(option)}
              >
                {option === "visual" ? "Visual" : "Tactile"}
              </button>
            ))}
          </div>
        )}
        {imageUrl && failedUrl !== imageUrl ? (
          <img
            src={imageUrl}
            alt={asset.shortDescription || asset.title}
            className={PREVIEW_IMAGE_CLASS}
            onError={() => setFailedUrl(imageUrl)}
          />
        ) : imageUrl ? (
          <div className="text-[0.9rem] text-slate-500">The picture couldn't be loaded.</div>
        ) : (
          <div className="text-[0.9rem] text-slate-500">No picture yet.</div>
        )}
        <div data-testid="generated-asset-status" className="text-[0.8rem] text-slate-500 text-center">
          {statusLine}
        </div>
        {manual && runtime && (
          <button
            type="button"
            data-testid="render-generated-asset"
            disabled={!canRender || isRendering}
            title="Update the preview (Ctrl+Enter)"
            className="rounded border border-blue-700 bg-blue-600 px-3 py-1 text-[0.8rem] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-blue-200 disabled:bg-blue-300"
            onClick={renderNow}
          >
            {isRendering ? "Making preview…" : hasPicture ? "Refresh" : "Preview"}
          </button>
        )}
        {viewError && (
          <pre
            data-testid="generated-asset-error"
            className="max-w-full max-h-48 flex-none overflow-auto whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-[0.75rem] text-red-800"
          >
            {viewError.message}
          </pre>
        )}
        {viewError?.log && (
          <details data-testid="generated-asset-log" className="max-w-full flex-none text-[0.75rem] text-slate-600">
            <summary className="cursor-pointer text-center">Details</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white px-3 py-2 text-[0.7rem]">
              {viewError.log}
            </pre>
          </details>
        )}
        {saveFailure && (
          <div className="flex flex-col items-center gap-1">
            <div data-testid="generated-asset-save-error" className="text-[0.75rem] text-red-700 text-center">
              The picture couldn't be saved: {saveFailure.message}
            </div>
            <button
              type="button"
              data-testid="retry-generated-asset-save"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-[0.8rem] text-slate-800 hover:bg-slate-100"
              onClick={() => void store(saveFailure.output)}
            >
              Try again
            </button>
          </div>
        )}
        {!runtime ? (
          <div className="text-[0.75rem] text-slate-400 text-center">
            {manual
              ? "Previews aren't available here. The image will appear when you build."
              : "Live previews aren't available here. The image will appear when you build."}
          </div>
        ) : status === "loading" ? (
          <div data-testid="generated-asset-loading" className="text-[0.8rem] text-slate-500 text-center">
            {progress ?? "Getting ready…"}
          </div>
        ) : status === "failed" ? (
          <div className="flex flex-col items-center gap-1">
            <div data-testid="generated-asset-load-error" className="text-[0.75rem] text-red-700 text-center">
              The {generator.label} preview couldn't start{loadError ? `: ${loadError}` : "."}
            </div>
            <button
              type="button"
              data-testid="retry-generator-engine"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-[0.8rem] text-slate-800 hover:bg-slate-100"
              onClick={() => void runtime.load().catch(() => {})}
            >
              Try again
            </button>
          </div>
        ) : null}
        {downloadUrl && failedUrl !== imageUrl && (
          <a
            data-testid="download-generated-asset"
            href={downloadUrl}
            download={tactileView ? `${asset.ref}-tactile.svg` : `${asset.ref}.svg`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-[0.8rem] text-slate-800 no-underline hover:bg-slate-100"
          >
            {tactileView ? "Download tactile SVG" : "Download SVG"}
          </a>
        )}
      </div>
    );
  },
);

export default GeneratedAssetPreview;
