/**
 * Worker entry for the TikZ engine. A host bundles this file as an ES module
 * Web Worker and passes its URL to `Editors` as
 * `generatorRuntimes.tikz.workerUrl`; see `generators/tikz/runtime.ts` for the
 * other half.
 */
import { handleTikzWorkerRequest } from "./generators/tikz/worker/handler";
import type { TikzWorkerRequest, TikzWorkerResponse } from "./generators/tikz/worker/protocol";

const post = (response: TikzWorkerResponse) => self.postMessage(response);

self.addEventListener("message", (event: MessageEvent<TikzWorkerRequest>) => {
  void handleTikzWorkerRequest(event.data, post);
});
