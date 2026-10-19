/**
 * Generated assets: authored source that a *generator* turns into a picture.
 *
 * A generator is one registry entry (see `./index.ts`): how its source is
 * wrapped into PreTeXt, what the editor opens a new asset with, which docinfo
 * elements its render depends on, which files it produces, and — when it can
 * run in the browser — a runtime that renders live. Nothing outside the
 * registry names a specific generator.
 */
import type { GeneratorId, SourceFormat } from "../types/editor";

/** One file of a render, named as a build's generated directory names it. */
export interface GeneratorOutput {
  /** `<ref>.svg`, `<ref>-annotations.xml`, `<ref>-diagcess.svg`, … */
  filename: string;
  blob: Blob;
}

export interface RenderResult {
  /** Every file the render produced, in a stable order with the primary SVG first. */
  outputs: GeneratorOutput[];
  /** The primary SVG, for the preview pane. */
  svg: string;
  /** The exact source string that was rendered — what the digest must be over. */
  source: string;
}

export type GeneratorRuntimeStatus = "idle" | "loading" | "ready" | "failed";

/**
 * A browser-side renderer for one generator, shared by every asset of that
 * generator on the page. Loading is explicit and may be expensive (PreFigure's
 * engine is ~100 MB cold), so nothing loads it but an author's click.
 */
export interface GeneratorRuntime {
  readonly status: GeneratorRuntimeStatus;
  /** The failure, while `status` is `"failed"`. */
  readonly error: string | undefined;
  /** What the engine is doing while `status` is `"loading"`, for the pane to show. */
  readonly progress: string | undefined;
  /** Start the engine. Safe to call repeatedly; later calls await the first. */
  load(): Promise<void>;
  /** Render `source` for the asset `ref`. Rejects with the generator's own message. */
  render(source: string, ref: string): Promise<RenderResult>;
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
   * Where the generator's own runtime files are served from — for PreFigure the
   * `prefig` and `segno` wheels — with a trailing slash.
   */
  assetBaseUrl: string;
  /** Override the Pyodide distribution (default: the pinned jsDelivr copy). */
  pyodideIndexUrl?: string;
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
   * document ever carries. `ref` becomes the generator's `@label`, so a build
   * that regenerates names its output exactly as the stored output is named.
   */
  wrapSource(source: string, ref: string): string;
  /**
   * The docinfo elements whose inner text is part of the render input, in
   * order. Mirrors the Rails `Asset::DOCINFO_INPUT_ELEMENTS` entry.
   */
  docinfoInputElements: readonly string[];
  /** The files a render of `source` for `ref` produces, primary SVG first. */
  outputFilenames(ref: string, source: string): string[];
  /** Absent when the generator has no browser runtime (server-rendered only). */
  createRuntime?(options: GeneratorRuntimeOptions): GeneratorRuntime;
}
