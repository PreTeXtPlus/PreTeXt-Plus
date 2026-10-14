/**
 * Entry point for the preview render worker — see components/previewRenderer.ts.
 *
 * A host bundles this file as a Web Worker (ES module) and passes the URL it
 * is served from to `Editors` as `previewWorkerUrl`. Nothing else is needed:
 * the worker fetches the stylesheets itself and finds the WASM binary next to
 * its own script, exactly as the main bundle does.
 */
import { handlePreviewWorkerRequest } from "./components/previewWorkerHandler";
import type { PreviewWorkerRequest, PreviewWorkerResponse } from "./components/previewRenderer";

const scope = self as unknown as {
  postMessage(message: PreviewWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: { data: PreviewWorkerRequest }) => void,
  ): void;
};

scope.addEventListener("message", ({ data }) => {
  void handlePreviewWorkerRequest(data, (response) => scope.postMessage(response));
});
