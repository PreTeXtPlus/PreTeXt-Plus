/**
 * Web Worker entry point: runs `computeDivisionOwnXml` (the LaTeX/Markdown ->
 * PreTeXt AST conversion) off the main thread. A host bundles and serves this
 * file as its own script and constructs a `Worker` pointed at it — see
 * `useBackgroundDivisionConversion.ts` for the main-thread side of the
 * protocol this file speaks.
 *
 * `self` is redeclared locally rather than adding `"WebWorker"` to this
 * package's tsconfig `lib`: TypeScript doesn't allow the `"DOM"` and
 * `"WebWorker"` libs in the same program, and `DOM` is needed everywhere else
 * in this package. A module-scoped `declare const self` shadows the ambient
 * DOM `self` for this file only, without touching the shared tsconfig.
 */
import { computeDivisionOwnXml } from "../sectionUtils";
import type { ConversionRequest, ConversionResponse } from "./protocol";

declare const self: {
  onmessage: ((event: MessageEvent<ConversionRequest>) => void) | null;
  postMessage: (message: ConversionResponse) => void;
};

self.onmessage = (event) => {
  const { id, division } = event.data;
  try {
    self.postMessage({ id, xml: computeDivisionOwnXml(division) });
  } catch (error) {
    // `computeDivisionOwnXml` already turns ordinary conversion failures into
    // an error-comment string rather than throwing; reaching here means
    // something unexpected broke (e.g. an OOM in the AST parse).
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
