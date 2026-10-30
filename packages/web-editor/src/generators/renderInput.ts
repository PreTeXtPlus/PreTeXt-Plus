/**
 * The exact string a generated asset's `previewInputDigest` is the sha256 of.
 *
 * The source, then the inner text of each docinfo element the generator's
 * render depends on (core writes `<macros>` and the generator's preamble into
 * the generator's publication file for a real build), joined by a separator no
 * author would type. The docinfo pieces are read with a regex, not an XML
 * parser, so this side and Rails' `Asset#render_input` produce the same bytes
 * without having to agree on a serialization. **Change either and both tests
 * pinning the shared fixture hex fail** — that is the point of them.
 */
import type { AssetGenerator, DocinfoInputs } from "./types";

export const RENDER_INPUT_SEPARATOR = "\n\u0000\n";

/**
 * The raw inner text of the first `<element …>…</element>` in `docinfo` without
 * `@syntax`, or "". Core reads only such a `<latex-image-preamble>`; one with
 * `@syntax` belongs to some other image language.
 */
export function docinfoElementInner(docinfo: string, element: string): string {
  const name = element.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${name}(?![^>]*\\ssyntax\\s*=)(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(docinfo);
  return match ? match[1] : "";
}

/**
 * The docinfo pieces a generator's render depends on, by element: what the
 * runtime is handed as `RenderOptions.docinfo`, and what the digest is of.
 */
export function docinfoInputsFor(
  generator: Pick<AssetGenerator, "docinfoInputElements">,
  docinfo: string,
): DocinfoInputs {
  return Object.fromEntries(
    generator.docinfoInputElements.map((element) => [element, docinfoElementInner(docinfo, element)]),
  );
}

export function renderInputFor(
  generator: Pick<AssetGenerator, "docinfoInputElements">,
  source: string,
  docinfo: string,
): string {
  const inputs = docinfoInputsFor(generator, docinfo);
  return [source, ...generator.docinfoInputElements.map((element) => inputs[element])].join(RENDER_INPUT_SEPARATOR);
}

/** Lower-case hex sha256 of `text`, via Web Crypto (Node 20+ has it too). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
