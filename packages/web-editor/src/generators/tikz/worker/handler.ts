/**
 * The worker's half of the TikZ runtime: start the engine once, then compile
 * documents on request. Pure in the sense of the PreFigure worker's handler —
 * it takes a request and a `post`, so the entry (`src/tikzWorker.ts`) is one
 * line and a test can drive it directly.
 *
 * The engine is mp-tikz-wasm: pdfTeX in DVI mode and dvisvgm, both compiled to
 * WebAssembly, reading a TeX tree a file at a time as they ask for it. Its module
 * is imported from the URL the host serves it at with a dynamic `import()` of a
 * computed string, which no bundler follows, and it finds its own files from
 * there. Nothing outside this file and `./protocol.ts` knows which TeX this is.
 *
 * It runs in this worker rather than the one it would otherwise start for
 * itself, which leaves one worker to stop when TeX hangs. Stopping it is the
 * runtime's job: a wasm loop cannot be interrupted from the thread it runs on.
 */
import { buildTikzDocument } from "../document";
import { tikzFailureMessage } from "../texLog";
import { TIKZ_BUNDLES, type TikzWorkerRequest, type TikzWorkerResponse } from "./protocol";

/** The part of a `latex()` result this worker reads (the library's `LatexResult`). */
export interface TikzLatexResult {
  status: "ok" | "warning" | "error" | "fatal";
  /** One SVG per page. */
  pages: string[];
  /** TeX's transcript. Empty if TeX never got far enough to write one. */
  texLog: string;
  /** What TeX printed. */
  log: string;
}

/** The surface of the library's `MetaPost` this worker uses. */
export interface TikzEngine {
  latex(document: string, options: Readonly<Record<string, unknown>>): Promise<TikzLatexResult>;
  on(event: "log", listener: (line: string) => void): () => void;
}

/** The pieces a test replaces. */
export interface TikzWorkerDeps {
  createEngine?: (baseUrl: string) => Promise<TikzEngine>;
}

/**
 * Fixed to pdfTeX, never the library's `auto`, which picks LuaTeX for `\directlua`:
 * the build has no LuaTeX, so the preview must fail on it too. Glyphs as paths make
 * the SVG self-contained, which is what lets an `<img>` show it. The page is the box,
 * see `../document.ts`.
 */
const LATEX_OPTIONS = { engine: "latex", fonts: "paths", bbox: "papersize" } as const;

/** How often a run that is printing says so to the runtime's stall timer. */
const HEARTBEAT_MS = 1000;

const defaultDeps: Required<TikzWorkerDeps> = {
  createEngine: async (baseUrl) => {
    const { MetaPost } = (await import(/* @vite-ignore */ new URL("index.js", baseUrl).href)) as {
      MetaPost: { create(options: Readonly<Record<string, unknown>>): Promise<TikzEngine> };
    };
    return MetaPost.create({
      worker: false,
      bundles: [...TIKZ_BUNDLES],
      bundleBaseUrl: new URL("bundles/", baseUrl).href,
      logLevel: "silent",
      // A first run touches about ninety files; ask for them in parallel, not one
      // synchronous request at a time.
      prefetch: ["latex"],
    });
  },
};

let engine: TikzEngine | null = null;
let loading: Promise<TikzEngine> | null = null;
let onEngineOutput: (() => void) | null = null;

async function loadEngine(
  baseUrl: string,
  progress: (message: string) => void,
  deps: Required<TikzWorkerDeps>,
): Promise<TikzEngine> {
  progress("Loading the TikZ engine. The first time, this fetches a few megabytes…");
  const loaded = await deps.createEngine(baseUrl);
  loaded.on("log", () => onEngineOutput?.());
  return loaded;
}

export async function handleTikzWorkerRequest(
  request: TikzWorkerRequest,
  post: (response: TikzWorkerResponse) => void,
  deps: TikzWorkerDeps = {},
): Promise<void> {
  const { token } = request;
  const fail = (error: unknown) =>
    post({ type: "failed", token, message: error instanceof Error ? error.message : String(error) });

  if (request.type === "load") {
    try {
      loading ??= loadEngine(
        request.baseUrl,
        (message) => post({ type: "progress", token, message }),
        { ...defaultDeps, ...deps },
      );
      engine = await loading;
      post({ type: "loaded", token });
    } catch (error) {
      loading = null;
      fail(error);
    }
    return;
  }

  if (!engine) {
    fail("The TikZ engine is not loaded");
    return;
  }
  const { document, sourceLine } = buildTikzDocument(request);
  let lastBeat = 0;
  onEngineOutput = () => {
    if (Date.now() - lastBeat < HEARTBEAT_MS) return;
    lastBeat = Date.now();
    post({ type: "progress", token, message: "Typesetting…" });
  };
  try {
    const result = await engine.latex(document, LATEX_OPTIONS);
    // Nonstop mode carries on past an error, so a page can come back from a run
    // that failed. The build reports that run as failed too.
    const svg = result.status === "ok" ? result.pages[0] : undefined;
    if (svg) {
      post({ type: "rendered", token, svg, annotations: null });
    } else {
      const log = result.texLog || result.log;
      post({ type: "failed", token, message: tikzFailureMessage(log, sourceLine), log });
    }
  } catch (error) {
    fail(error);
  } finally {
    onEngineOutput = null;
  }
}

/** Tests only: forget the loaded engine so the next load starts afresh. */
export function resetTikzEngineForTests(): void {
  engine = null;
  loading = null;
  onEngineOutput = null;
}
