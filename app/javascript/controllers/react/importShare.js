/**
 * Mailing us a pandoc conversion an author chose to share, from either place
 * that imports: the new-project wizard (`react/import.jsx`, a "Share
 * conversion" button beside the result) and the editor's Tools → Import…
 * dialog (`react/editor.jsx`, an opt-in checkbox). Both hand over the same
 * `ConversionShare` from `@pretextbook/import`, so one function serves both,
 * and `context` tells the email which one it came from.
 *
 * `projects#import_share` is a collection route, like feedback: there may be no
 * project yet (the wizard runs before one exists), and the action only mails
 * what it is sent.
 */

/** @typedef {import("@pretextbook/import/react").ConversionShare} ConversionShare */

export const IMPORT_SHARE_URL = "/projects/import_share";

/**
 * Build the `onShare` both import UIs take.
 *
 * It rejects with a sentence an author can read, because the wizard shows the
 * rejection beside its button ("Could not share: …"); the editor only logs it.
 *
 * @param {{ context: string, csrfToken?: string, projectUrl?: string, fetchImpl?: typeof fetch }} options
 * @returns {(share: ConversionShare) => Promise<void>}
 */
export function buildImportShare({ context, csrfToken, projectUrl, fetchImpl }) {
  return async (share) => {
    const body = new FormData();
    body.append("file", share.file);
    body.append("engine", share.engineLabel);
    body.append("context", context);
    if (projectUrl) body.append("project_url", projectUrl);
    if (share.pretext !== undefined) body.append("pretext", share.pretext);
    if (share.error !== undefined) body.append("error", share.error);

    const res = await (fetchImpl ?? fetch)(IMPORT_SHARE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "X-CSRF-Token": csrfToken ?? "" },
      credentials: "same-origin",
      body,
    });
    if (res.ok) return;
    throw new Error(
      res.status === 429
        ? "Too many conversions shared in a short time. Please try again in a few minutes."
        : `The server could not take it (error ${res.status}).`,
    );
  };
}
