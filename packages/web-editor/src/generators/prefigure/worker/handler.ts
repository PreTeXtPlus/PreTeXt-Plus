/**
 * The worker's half of the PreFigure runtime: load Pyodide and the `prefig`
 * wheel once, then render diagrams on request. Pure in the sense of the
 * preview worker's handler — it takes a request and a `post`, so the entry
 * (`src/prefigureWorker.ts`) is one line and a test can drive it directly.
 *
 * Pyodide itself is loaded from its distribution URL at runtime with a dynamic
 * `import()` of a computed string, which no bundler follows: the editor's
 * bundle carries nothing of Pyodide, and the browser caches one copy of the
 * CDN release across every site that uses it.
 */
import type { PrefigureWorkerRequest, PrefigureWorkerResponse } from "./protocol";
import { PYODIDE_PACKAGES } from "./protocol";

/** The sliver of Pyodide's API this worker uses. */
interface Pyodide {
  registerJsModule(name: string, module: object): void;
  loadPackage(
    names: string | string[],
    options?: { messageCallback?: (message: string) => void },
  ): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { set(name: string, value: unknown): void; delete(name: string): void };
}
type LoadPyodide = (options: { indexURL: string }) => Promise<Pyodide>;

let pyodide: Pyodide | null = null;
let loading: Promise<Pyodide> | null = null;

async function loadEngine(
  pyodideIndexUrl: string,
  wheelUrls: string[],
  progress: (message: string) => void,
): Promise<Pyodide> {
  progress("Loading Python…");
  const module = (await import(/* @vite-ignore */ `${pyodideIndexUrl}pyodide.mjs`)) as {
    loadPyodide: LoadPyodide;
  };
  const py = await module.loadPyodide({ indexURL: pyodideIndexUrl });

  // MathJax and the canvas-backed text measurement PreFigure's labels need.
  // Imported here rather than at the top so a worker that only ever fails to
  // reach Pyodide never pays for MathJax.
  const { PrefigBrowserApi } = await import("./compat-api");
  py.registerJsModule("prefigBrowserApi", new PrefigBrowserApi());

  progress("Loading PreFigure's dependencies (scipy is the big one)…");
  await py.loadPackage([...PYODIDE_PACKAGES, ...wheelUrls], {
    messageCallback: (message) => {
      // Pyodide narrates every package; keep the ones that name a fetch.
      if (/^Loading /.test(message)) progress(message);
    },
  });
  progress("Starting PreFigure…");
  await py.runPythonAsync("import prefig");
  return py;
}

const RENDER_PYTHON = `
import prefig
_prefig_result = prefig.engine.build_from_string("svg", _prefig_source, environment="pyodide")
`;

export async function handlePrefigureWorkerRequest(
  request: PrefigureWorkerRequest,
  post: (response: PrefigureWorkerResponse) => void,
): Promise<void> {
  const { token } = request;
  const fail = (error: unknown) =>
    post({ type: "failed", token, message: error instanceof Error ? error.message : String(error) });

  if (request.type === "load") {
    try {
      loading ??= loadEngine(request.pyodideIndexUrl, request.wheelUrls, (message) =>
        post({ type: "progress", token, message }),
      );
      pyodide = await loading;
      post({ type: "loaded", token });
    } catch (error) {
      loading = null;
      fail(error);
    }
    return;
  }

  if (!pyodide) {
    fail("The PreFigure engine is not loaded");
    return;
  }
  try {
    pyodide.globals.set("_prefig_source", request.source);
    await pyodide.runPythonAsync(RENDER_PYTHON);
    const result = (await pyodide.runPythonAsync("_prefig_result")) as unknown;
    pyodide.globals.delete("_prefig_source");
    // build_from_string returns (svg, annotations) — a tuple, which arrives as a
    // PyProxy; an empty string means it found no <diagram>.
    const pair = toPair(result);
    if (!pair) {
      fail("PreFigure produced no diagram. Is there a <diagram> element?");
      return;
    }
    post({ type: "rendered", token, svg: pair[0], annotations: pair[1] });
  } catch (error) {
    fail(pythonMessage(error));
  }
}

function toPair(result: unknown): [string, string | null] | null {
  if (typeof result === "string") return result ? [result, null] : null;
  const proxy = result as { toJs?: () => unknown; destroy?: () => void };
  const value = proxy.toJs ? proxy.toJs() : result;
  proxy.destroy?.();
  if (Array.isArray(value) && typeof value[0] === "string") {
    return [value[0], typeof value[1] === "string" ? value[1] : null];
  }
  return null;
}

/**
 * The last line of a Python traceback is the one an author can act on
 * (`ValueError: PreFigure source is not well-formed XML: …`); the frames above
 * it are PreFigure's.
 */
function pythonMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lines = text.trim().split("\n");
  return lines[lines.length - 1] || text;
}
