import { useEffect, useRef, useState } from "react";
import type { Asset } from "../types/editor";
import {
  docinfoElementInner,
  generatorFor,
  renderInputFor,
  sha256Hex,
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
  /** The docinfo in force, whose macros are part of the render input. */
  docinfo: string;
  /** The generator's browser engine, or undefined when the host configured none. */
  runtime: GeneratorRuntime | undefined;
  /**
   * A render of the current source, for the host to store. Rejecting means it
   * was not stored: the pane says so and offers to try again.
   */
  onOutput?: (asset: Asset, output: GeneratedAssetOutput) => Promise<void> | void;
  readOnly?: boolean;
  /** How long typing must settle before a render; tests shorten it. */
  debounceMs?: number;
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

/**
 * The preview panel while a generated asset is open. The engine is started as
 * soon as the pane mounts with one (it is a few megabytes, fetched once per
 * page); until it is up, the stored picture shows with a line saying whether it
 * matches the current source. Then the engine renders a second after typing
 * stops, the previous picture staying up and an engine error showing beneath
 * it, and each fresh picture goes to the host through `onOutput` with the digest
 * of exactly the source rendered — so a keystroke that lands mid-render leaves
 * the stored picture honestly stale rather than wrongly current. A picture the
 * host fails to store is reported beneath it, with a retry.
 */
const GeneratedAssetPreview = ({
  asset,
  docinfo,
  runtime,
  onOutput,
  readOnly,
  debounceMs = RENDER_DEBOUNCE_MS,
}: GeneratedAssetPreviewProps) => {
  const generator = generatorFor(asset.sourceFormat);
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
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
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

  // Render on a debounce whenever the source (or macros) change while the engine is up.
  useEffect(() => {
    if (!runtime || status !== "ready" || !generator || !asset.ref || readOnly) return;
    const timer = setTimeout(async () => {
      setIsRendering(true);
      try {
        const result = await runtime.render(source, { macros: docinfoElementInner(docinfo, "macros") });
        const digest = await sha256Hex(renderInputFor(generator, result.source, docinfo));
        setRenderError(null);
        setRendered((previous) => {
          if (previous) URL.revokeObjectURL(previous.url);
          return { url: URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" })), digest };
        });
        // Hand the host only a render of the source as it is *now*; one that
        // typing has overtaken is shown but not stored.
        const now = latest.current;
        const liveDigest = await sha256Hex(renderInputFor(generator, now.source, now.docinfo));
        if (digest === liveDigest && digest !== now.asset.previewInputDigest && !sentDigests.current.has(digest)) {
          void store({ svg: result.svg, previewInputDigest: digest });
        }
      } catch (cause) {
        setRenderError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsRendering(false);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [runtime, status, generator, asset.ref, source, docinfo, readOnly, debounceMs]);

  if (!generator) {
    return (
      <div data-testid="asset-preview" className="flex flex-1 h-full items-center justify-center p-6 bg-[#fafafa] text-[0.9rem] text-slate-500">
        Unknown generator “{asset.sourceFormat}”.
      </div>
    );
  }

  const storedIsCurrent = !!asset.url && !!currentDigest && asset.previewInputDigest === currentDigest;
  const showingFresh = rendered && rendered.digest === currentDigest;
  const imageUrl = rendered?.url ?? asset.url;

  let statusLine: string;
  if (showingFresh) statusLine = isRendering ? "Rendering…" : "Rendered from the current source.";
  else if (isRendering) statusLine = "Rendering…";
  else if (rendered) statusLine = "Source changed since this was rendered.";
  else if (!asset.url) statusLine = "Not rendered yet.";
  else if (storedIsCurrent) statusLine = "Stored picture matches the current source.";
  else statusLine = "Source changed since the stored picture was rendered.";

  return (
    <div
      data-testid="asset-preview"
      className="flex flex-1 h-full min-h-0 flex-col items-center justify-center gap-3 p-6 bg-[#fafafa]"
    >
      {imageUrl && failedUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt={asset.shortDescription || asset.title}
          className="max-w-full min-h-0 flex-shrink object-contain border border-slate-200 rounded bg-white"
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
      {renderError && (
        <pre
          data-testid="generated-asset-error"
          className="max-w-full overflow-x-auto whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-3 py-2 text-[0.75rem] text-red-800"
        >
          {renderError}
        </pre>
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
          Live rendering isn't available here; builds generate this diagram.
        </div>
      ) : status === "loading" ? (
        <div data-testid="generated-asset-loading" className="text-[0.8rem] text-slate-500 text-center">
          {progress ?? "Loading the engine…"}
        </div>
      ) : status === "failed" ? (
        <div className="flex flex-col items-center gap-1">
          <div data-testid="generated-asset-load-error" className="text-[0.75rem] text-red-700 text-center">
            The {generator.label} engine couldn't be loaded{loadError ? `: ${loadError}` : "."}
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
    </div>
  );
};

export default GeneratedAssetPreview;
