/**
 * PreFigure (https://prefigure.org): diagrams authored as XML. The registry
 * entry — the parts that need no engine.
 */
import type { AssetGenerator } from "../types";
import { createPrefigureRuntime } from "./runtime";

export const PREFIGURE_NAMESPACE = "https://prefigure.org";

/** The source a new PreFigure asset opens with: axes, a graph, one TeX label. */
export const PREFIGURE_STARTER_SOURCE = `<diagram dimensions="(300,300)" margins="5">
  <definition>f(x) = exp(x/3)*cos(x)</definition>
  <coordinates bbox="(-4,-4,4,4)">
    <grid-axes xlabel="x" ylabel="y"/>
    <graph function="f"/>
    <point p="(1, f(1))">
      <m>(1, f(1))</m>
    </point>
  </coordinates>
</diagram>`;

export const prefigure: AssetGenerator = {
  id: "prefigure",
  label: "PreFigure",
  language: "pretext",
  starterSource: PREFIGURE_STARTER_SOURCE,
  wrapSource: (source, ref) =>
    `<prefigure xmlns="${PREFIGURE_NAMESPACE}" label="${ref}">\n${source}\n</prefigure>`,
  // Mirrors Content::GeneratedAssetBehavior::DOCINFO_INPUT_ELEMENTS["prefigure"].
  docinfoInputElements: ["macros", "prefigure-preamble"],
  createRuntime: createPrefigureRuntime,
};
