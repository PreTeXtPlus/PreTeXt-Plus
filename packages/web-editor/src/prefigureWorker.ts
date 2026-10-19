/**
 * Worker entry for the PreFigure engine. A host bundles this file as an ES
 * module Web Worker and passes its URL to `Editors` as
 * `generatorRuntimes.prefigure.workerUrl`; see `generators/prefigure/runtime.ts`
 * for the other half.
 */
import { handlePrefigureWorkerRequest } from "./generators/prefigure/worker/handler";
import type { PrefigureWorkerRequest, PrefigureWorkerResponse } from "./generators/prefigure/worker/protocol";

const post = (response: PrefigureWorkerResponse) => self.postMessage(response);

self.addEventListener("message", (event: MessageEvent<PrefigureWorkerRequest>) => {
  void handlePrefigureWorkerRequest(event.data, post);
});
