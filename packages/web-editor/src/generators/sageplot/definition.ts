/**
 * Sage plots: Python (Sage) whose last line is the plot, the text of a
 * `<sageplot>`. No browser runs Sage; the picture comes from the host's build
 * server (`createServerRuntime`), which also leaves it in the project's cache
 * for the next full build.
 */
import { escapeText } from "../../xmlUtils";
import { createServerRuntime } from "../serverRuntime";
import { sanitizeSvg } from "../tikz/sanitizeSvg";
import type { AssetGenerator } from "../types";

/**
 * The source a new Sage asset opens with. PreTeXt splits the source at its last
 * line: everything above is run as is, and the last line must be the plot.
 */
export const SAGEPLOT_STARTER_SOURCE = `f(x) = exp(x/3) * cos(x)
p = plot(f, (x, -4, 4), color='blue', thickness=2)
p += point((1, f(1)), size=30, color='black')
p += text('$(1, f(1))$', (1.4, f(1) + 0.4))
p`;

export const sageplot: AssetGenerator = {
  id: "sageplot",
  label: "Sage",
  element: "sageplot",
  language: "python",
  starterSource: SAGEPLOT_STARTER_SOURCE,
  // Code, not XML: `x < 2` goes in as typed; only the document's copy is escaped.
  wrapSource: (source, ref) => `<sageplot label="${ref}">\n${escapeText(source)}\n</sageplot>`,
  // Mirrors Content::GeneratedAssetBehavior::DOCINFO_INPUT_ELEMENTS["sageplot"]:
  // extract-sageplot.xsl reads nothing from the docinfo.
  docinfoInputElements: [],
  renderTrigger: "manual",
  createRuntime: (options) =>
    createServerRuntime({ generator: "sageplot", label: "Sage", finishSvg: sanitizeSvg }, options),
};
