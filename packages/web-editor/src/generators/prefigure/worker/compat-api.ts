/**
 * What PreFigure's wasm engine asks the browser for (the prefigure repo's
 * `packages/prefig-wasm/src/host.rs`): TeX labels typeset to SVG, text measured,
 * and — for tactile output — braille. Handed to the engine once through
 * `set_host_api`.
 *
 * Ported from the PreFigure playground's `src/worker/compat-api.ts` (Jason
 * Siefken, David Austin; GPL-3.0 — see NOTICE in this directory), minus braille:
 * this editor renders SVG only, so the speech-rule-engine and liblouis builds
 * that tactile output needs are not carried. The two braille entry points say so
 * rather than silently returning the text.
 */
import type { PrefigHostApi } from "./handler";
import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import { TeX } from "@mathjax/src/mjs/input/tex.js";
import { SVG } from "@mathjax/src/mjs/output/svg.js";
import { liteAdaptor } from "@mathjax/src/mjs/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/mjs/handlers/html.js";
import type { MathDocument } from "@mathjax/src/mjs/core/MathDocument.js";
import type { LiteElement } from "@mathjax/src/mjs/adaptors/lite/Element.js";
import type { LiteText } from "@mathjax/src/mjs/adaptors/lite/Text.js";
import type { LiteDocument } from "@mathjax/src/mjs/adaptors/lite/Document.js";
// TeX packages beyond `base`, registered by import; the names below pick them.
import "@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/mjs/input/tex/noundefined/NoUndefinedConfiguration.js";
import "@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/mjs/input/tex/color/ColorConfiguration.js";

const TEX_PACKAGES = ["base", "ams", "newcommand", "noundefined", "boldsymbol", "color"];

const TACTILE_UNSUPPORTED =
  "Tactile (braille) output is not available in the editor; build the project for it.";

export class PrefigBrowserApi implements PrefigHostApi {
  private macros = "";
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private readonly adaptor = liteAdaptor();
  private readonly svgDocument: MathDocument<LiteElement, LiteText, LiteDocument>;

  constructor() {
    RegisterHTMLHandler(this.adaptor);
    this.svgDocument = mathjax.document("", {
      InputJax: new TeX({ packages: TEX_PACKAGES }),
      OutputJax: new SVG({ linebreaks: { inline: false } }),
    });
  }

  /** `[width, ascent, descent]` of `text` set in `fontString` (a CSS font). */
  measure_text(text: string, fontString: string): [number, number, number] {
    this.canvas ??= new OffscreenCanvas(200, 200);
    this.ctx ??= this.canvas.getContext("2d");
    if (!this.ctx) throw new Error("Could not create a canvas context to measure text");
    this.ctx.font = fontString;
    const metrics = this.ctx.measureText(text);
    return [metrics.width, metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent];
  }

  // Called by Python with (text, typeform) / (expression); the arguments are
  // not read because there is no braille translator to hand them to.
  translate_text(): string {
    throw new Error(TACTILE_UNSUPPORTED);
  }

  processBraille(): string {
    throw new Error(TACTILE_UNSUPPORTED);
  }

  /**
   * The document's `<macros>` (docinfo), put in scope for every label: a build
   * writes them into PreFigure's publication file, so the preview must honour
   * them too or a label using one renders differently here than there. Prepended
   * to each expression rather than defined once, since MathJax's `\newcommand`
   * redefines silently and the macros may change between renders.
   */
  setMacros(macros: string): void {
    this.macros = macros.trim();
  }

  /** TeX → standalone SVG markup, inline style. */
  processMath(expression: string): string {
    const tex = this.macros ? `${this.macros}\n${expression}` : expression;
    const node = this.svgDocument.convert(tex, { display: false }) as LiteElement;
    return this.adaptor.outerHTML(node);
  }
}
