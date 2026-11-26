/**
 * What PreFigure's wasm engine asks the browser for (the prefigure repo's
 * `packages/prefig-wasm/src/host.rs`): TeX labels typeset to SVG, text measured,
 * and — for tactile output — braille. Handed to the engine once through
 * `set_host_api`.
 *
 * Ported from the PreFigure playground's `src/worker/compat-api.ts` (Jason
 * Siefken, David Austin; GPL-3.0 — see NOTICE in this directory). Braille is
 * not here but in a module of its own (`../braille`), a few megabytes the
 * worker imports only for a tactile render and hands over with `setBraille`;
 * until then the two braille entry points throw rather than return print.
 */
import type { BrailleTranslator } from "../braille";
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
import { SerializedMmlVisitor } from "@mathjax/src/mjs/core/MmlTree/SerializedMmlVisitor.js";
import type { MmlNode } from "@mathjax/src/mjs/core/MmlTree/MmlNode.js";
// TeX packages beyond `base`, registered by import; the names below pick them.
import "@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/mjs/input/tex/noundefined/NoUndefinedConfiguration.js";
import "@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/mjs/input/tex/color/ColorConfiguration.js";

const TEX_PACKAGES = ["base", "ams", "newcommand", "noundefined", "boldsymbol", "color"];

const BRAILLE_NOT_LOADED = "Braille translation is not loaded";

export class PrefigBrowserApi implements PrefigHostApi {
  private macros = "";
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private readonly adaptor = liteAdaptor();
  private readonly svgDocument: MathDocument<LiteElement, LiteText, LiteDocument>;
  // TeX → MathML only, for Nemeth: no output jax.
  private readonly mmlDocument: MathDocument<LiteElement, LiteText, LiteDocument>;
  private braille: BrailleTranslator | null = null;

  constructor() {
    RegisterHTMLHandler(this.adaptor);
    this.svgDocument = mathjax.document("", {
      InputJax: new TeX({ packages: TEX_PACKAGES }),
      OutputJax: new SVG({ linebreaks: { inline: false } }),
    });
    this.mmlDocument = mathjax.document("", { InputJax: new TeX({ packages: TEX_PACKAGES }) });
  }

  /** The translator a tactile render's labels go through. */
  setBraille(braille: BrailleTranslator): void {
    this.braille = braille;
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

  /** A text label in contracted UEB; `typeform` is each character's emphasis. */
  translate_text(text: string, typeform: number[]): string {
    if (!this.braille) throw new Error(BRAILLE_NOT_LOADED);
    return this.braille.text(text, typeform);
  }

  /** A TeX label in Nemeth, by way of MathML, with the document's macros in scope. */
  processBraille(expression: string): string {
    if (!this.braille) throw new Error(BRAILLE_NOT_LOADED);
    const tex = this.macros ? `${this.macros}\n${expression}` : expression;
    const math = this.mmlDocument.convert(tex, { display: true, end: "mathml" }) as MmlNode;
    return this.braille.math(new SerializedMmlVisitor().visitTree(math));
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
