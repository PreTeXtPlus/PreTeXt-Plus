/**
 * The worker's half of previewRenderer.ts: render what the main thread sends,
 * post back what came of it. Pure, so it can be tested without a worker; the
 * entry that binds it to `self` is `../previewWorker.ts`.
 */
import { isLocalPreviewAvailable, renderPreviewHtml } from "./wasmPreview";
import type { PreviewWorkerRequest, PreviewWorkerResponse } from "./previewRenderer";

export async function handlePreviewWorkerRequest(
  request: PreviewWorkerRequest,
  post: (response: PreviewWorkerResponse) => void,
): Promise<void> {
  if (request.type !== "render") return;
  // JSPI in a worker is the same engine capability as on the page, so this is
  // belt and braces — but a worker that cannot render must say so rather than
  // throw on every request, or the preview would show nothing but errors.
  if (!isLocalPreviewAvailable()) {
    post({ type: "unavailable" });
    return;
  }
  try {
    const result = await renderPreviewHtml(request.source, request.options);
    post({ type: "rendered", token: request.token, result });
  } catch (error) {
    post({
      type: "failed",
      token: request.token,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
