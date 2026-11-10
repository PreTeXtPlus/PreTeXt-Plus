/**
 * Asymptote (https://asymptote.sourceforge.io): figures authored in its own
 * C-like language, the text of an `<asymptote>`. No browser runs it; the picture
 * comes from the host's build server (`createServerRuntime`), which also leaves
 * it in the project's cache for the next full build.
 */
import { escapeText } from "../../xmlUtils";
import { createServerRuntime } from "../serverRuntime";
import { sanitizeSvg } from "../tikz/sanitizeSvg";
import type { AssetGenerator } from "../types";

/** The source a new Asymptote asset opens with: axes, a graphed function, a TeX label. */
export const ASYMPTOTE_STARTER_SOURCE = `import graph;
size(7cm, 7cm, IgnoreAspect);

real f(real x) { return exp(x/3) * cos(x); }
draw(graph(f, -4, 4), blue + 1bp);

xaxis("$x$", -4, 4, Arrow);
yaxis("$y$", -4, 4, Arrow);
dot((1, f(1)));
label("$(1, f(1))$", (1, f(1)), NE);`;

export const asymptote: AssetGenerator = {
  id: "asymptote",
  label: "Asymptote",
  element: "asymptote",
  language: "asymptote",
  starterSource: ASYMPTOTE_STARTER_SOURCE,
  // Code, not XML: `a < b` and `&&` go in as typed, and only the document's copy
  // is escaped. Exactly `&`, `<` and `>`, as for TikZ.
  wrapSource: (source, ref) => `<asymptote label="${ref}">\n${escapeText(source)}\n</asymptote>`,
  // Mirrors Content::GeneratedAssetBehavior::DOCINFO_INPUT_ELEMENTS["asymptote"]:
  // extract-asymptote.xsl writes both into the .asy file.
  docinfoInputElements: ["macros", "asymptote-preamble"],
  renderTrigger: "manual",
  createRuntime: (options) =>
    createServerRuntime({ generator: "asymptote", label: "Asymptote", finishSvg: sanitizeSvg }, options),
};
