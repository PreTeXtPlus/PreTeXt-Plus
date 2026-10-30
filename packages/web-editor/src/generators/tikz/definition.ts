/**
 * TikZ: pictures authored as TeX, the text of a `<latex-image>`. The registry
 * entry — the parts that need no engine.
 */
import { escapeText } from "../../xmlUtils";
import type { AssetGenerator } from "../types";
import { createTikzRuntime } from "./runtime";

/** The source a new TikZ asset opens with: axes, a plotted function, one labelled point. */
export const TIKZ_STARTER_SOURCE = String.raw`\begin{tikzpicture}[scale=0.7]
  \draw[->] (-4,0) -- (4,0) node[right] {$x$};
  \draw[->] (0,-4) -- (0,4) node[above] {$y$};
  \draw[thick, blue, domain=-4:4, samples=100]
    plot (\x, {exp(\x/3)*cos(\x r)});
  \fill (1, {exp(1/3)*cos(1 r)}) circle (2pt)
    node[above right] {$(1, f(1))$};
\end{tikzpicture}`;

export const tikz: AssetGenerator = {
  id: "tikz",
  label: "TikZ",
  element: "latex-image",
  language: "tex",
  starterSource: TIKZ_STARTER_SOURCE,
  // PreFigure's source is XML and goes in verbatim. This is TeX: an author typing
  // `x < y` or a `tikzcd` row should not have to write entities, so the buffer is
  // TeX and only the document's copy is XML. Exactly `&`, `<` and `>` are escaped,
  // so that unwrapping a `<latex-image>` into an asset round-trips.
  wrapSource: (source, ref) => `<latex-image label="${ref}">\n${escapeText(source)}\n</latex-image>`,
  // Mirrors Content::GeneratedAssetBehavior::DOCINFO_INPUT_ELEMENTS["tikz"].
  docinfoInputElements: ["macros", "latex-image-preamble"],
  createRuntime: createTikzRuntime,
};
