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
import type { GeneratorId, SourceFormat } from "../types/editor";

export interface RenderResult {
  /** The diagram, as standalone SVG markup. */
  svg: string;
  /** The generator's annotations document for the diagram, when it made one. */
  annotations: string | null;
  /** The exact source string that was rendered — what the digest must be over. */
  source: string;
}

export interface RenderOptions {
  /** TeX macro definitions (the docinfo `<macros>` text) the diagram's labels may use. */
  macros?: string;
}

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
  /** Render `source`. Rejects with the generator's own message. */
  render(source: string, options?: RenderOptions): Promise<RenderResult>;
  /** Tear the engine down; the next `load()` starts afresh. */
  dispose(): void;
  /** Notified on every status/progress change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** What a host must provide for a generator's browser runtime to exist. */
export interface GeneratorRuntimeOptions {
  /** The bundled worker (`@pretextbook/web-editor/prefigure-worker`), as an ES module. */
  workerUrl: string;
  /**
   * The URL of each of the generator's own runtime files, keyed by filename —
   * for PreFigure the wasm engine and its JS glue (the names in
   * `prefigure/worker/protocol.ts`). Per file rather than one base directory so
   * a host can serve them under content-digested names: the engine changes
   * without its filenames changing, and a long-cached copy must not outlive it.
   */
  assetUrls: Readonly<Record<string, string>>;
}

/** Per-generator runtime configuration a host passes to `Editors`. */
export type GeneratorRuntimeConfigs = Partial<Record<GeneratorId, GeneratorRuntimeOptions>>;

export interface AssetGenerator {
  id: GeneratorId;
  /** Tab and title-bar label: "PreFigure". */
  label: string;
  /** The code editor's language for the source buffer. */
  language: SourceFormat;
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
  /** Absent when the generator has no browser runtime. */
  createRuntime?(options: GeneratorRuntimeOptions): GeneratorRuntime;
}
