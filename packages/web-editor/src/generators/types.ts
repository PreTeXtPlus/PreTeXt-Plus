/**
 * Generated assets: authored source that a *generator* turns into a picture.
 *
 * A generator is one registry entry (see `./index.ts`): how its source is
 * wrapped into PreTeXt, what the editor opens a new asset with, which docinfo
 * elements its render depends on, and — when it can run in the browser — a
 * runtime that renders live. Nothing outside the registry names a generator.
 *
 * The browser render is a preview. The picture it produces is stored with the
 * asset so the asset list, a peer without an engine and a reload have something
 * to show; a build generates the asset from its source like any other, with the
 * build server's own cache deciding whether the generator reruns.
 */
import type { EditorLanguage, GeneratorId } from "../types/editor";

export interface RenderResult {
  /** The diagram, as standalone SVG markup. */
  svg: string;
  /** The generator's annotations document for the diagram, when it made one. */
  annotations: string | null;
  /** The exact source string that was rendered — what the digest must be over. */
  source: string;
}

/**
 * The raw inner text of the docinfo elements a render depends on, by element
 * (`macros`, `latex-image-preamble`, …): a generator's `docinfoInputElements`.
 */
export type DocinfoInputs = Readonly<Record<string, string>>;

export interface RenderOptions {
  docinfo?: DocinfoInputs;
  /**
   * The asset's ref — its `@label`, the output's basename. A server render
   * needs it to name the figure in the document it ships; a browser engine
   * has no use for it.
   */
  ref?: string;
  /** Word from the engine while the render is under way ("Queued on the build server…"). */
  onProgress?: (message: string) => void;
}

/** What a host's server render is asked for: one figure, from the source as typed. */
export interface ServerRenderRequest {
  generator: GeneratorId;
  /** The asset's ref, which the figure's `@label` will be. */
  ref: string;
  source: string;
  /** The docinfo pieces the generator reads (`docinfoInputElements`), raw. Informational: the host has the docinfo. */
  docinfo: DocinfoInputs;
  onProgress?: (message: string) => void;
}

/**
 * A host's render of a figure on its build server (see `createServerRuntime`):
 * resolves the picture, or rejects — with a `GeneratorRenderError` carrying the
 * CLI's log when there is one — when the server could not make it.
 */
export type ServerRender = (request: ServerRenderRequest) => Promise<{ svg: string }>;

export type GeneratorRuntimeStatus = "idle" | "loading" | "ready" | "failed";

/**
 * A browser-side renderer for one generator, shared by every asset of that
 * generator on the page. Loading fetches the engine (a couple of megabytes for
 * PreFigure's wasm build), so it happens once a generated asset is opened, not
 * on page load.
 */
export interface GeneratorRuntime {
  readonly status: GeneratorRuntimeStatus;
  /** The failure, while `status` is `"failed"`. */
  readonly error: string | undefined;
  /** What the engine is doing while `status` is `"loading"`, for the pane to show. */
  readonly progress: string | undefined;
  /** Start the engine. Safe to call repeatedly; later calls await the first. */
  load(): Promise<void>;
  /**
   * Render `source`. Rejects with the generator's own message, in a
   * `GeneratorRenderError` carrying its transcript when it keeps one.
   */
  render(source: string, options?: RenderOptions): Promise<RenderResult>;
  /** Tear the engine down; the next `load()` starts afresh. */
  dispose(): void;
  /** Notified on every status/progress change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * What a host must provide for a generator's runtime to exist: for an engine in
 * the browser, its worker and files; for one on the host's build server, the
 * `render` call. A generator with neither renders nothing live.
 */
export interface GeneratorRuntimeOptions {
  /** The bundled worker (`@pretextbook/web-editor/<generator>-worker`), as an ES module. */
  workerUrl?: string;
  /**
   * The URL of each of the generator's own runtime files, keyed by filename —
   * for PreFigure the wasm engine and its JS glue (the names in
   * `prefigure/worker/protocol.ts`). Per file rather than one base directory so
   * a host can serve them under content-digested names: the engine changes
   * without its filenames changing, and a long-cached copy must not outlive it.
   */
  assetUrls?: Readonly<Record<string, string>>;
  /**
   * The directory an engine's files are served from, for one that fetches too
   * many, by name, for `assetUrls` to carry (TeX's own file lookups). The
   * directory is versioned, which does for it what digests do for `assetUrls`.
   */
  baseUrl?: string;
  /**
   * For a generator no browser runs (Asymptote, Sage): the host's render on its
   * build server. The runtime built on it renders only when asked
   * (`renderTrigger: "manual"`), never on a debounce.
   */
  render?: ServerRender;
}

/** Per-generator runtime configuration a host passes to `Editors`. */
export type GeneratorRuntimeConfigs = Partial<Record<GeneratorId, GeneratorRuntimeOptions>>;

export interface AssetGenerator {
  id: GeneratorId;
  /** Tab and title-bar label: "PreFigure". */
  label: string;
  /**
   * The PreTeXt element `wrapSource` wraps the source in, which is also the
   * directory under `generated/` a renderer puts the picture in. Mirrors
   * Rails' `Content::GeneratedAssetBehavior::ELEMENTS`.
   */
  element: string;
  /** The code editor's language for the source buffer. */
  language: EditorLanguage;
  /** What a new asset of this generator opens with. Persisted on create. */
  starterSource: string;
  /**
   * The PreTeXt child of `<image>` for this source — the only form the
   * document ever carries. `ref` becomes the generator's `@label`, which a
   * build uses as the output's basename.
   */
  wrapSource(source: string, ref: string): string;
  /**
   * The docinfo elements whose inner text is part of the render input, in
   * order. Mirrors the Rails `Content::GeneratedAssetBehavior::DOCINFO_INPUT_ELEMENTS` entry.
   */
  docinfoInputElements: readonly string[];
  /**
   * When the preview pane renders: `live`, a second after typing stops, for an
   * engine in the browser; `manual`, on the author's Render, for one that costs
   * a job on a build server.
   */
  renderTrigger: "live" | "manual";
  /** Absent when the generator has no runtime, in the browser or on a server. */
  createRuntime?(options: GeneratorRuntimeOptions): GeneratorRuntime;
}
