/**
 * RELAX NG validation of PreTeXt source, via `@pretextbook/schema`.
 *
 * Three things about the dependency shape are load-bearing:
 *
 *  - **The import is dynamic.** The validator carries `salve-annos` (~300KB),
 *    which is dead weight for anyone editing LaTeX or Markdown, or reading a
 *    document without typing in it. Loading it on the first lint keeps it off
 *    the page-load path.
 *  - **The grammar is fetched, not bundled.** `@pretextbook/schema` ships
 *    `assets/pretext.json` (~425KB) but does not list it in `exports`, so no
 *    bundler can reach it — see the second half of upstream issue #256. Until
 *    that lands, it comes from the CDN, pinned to the same minor this package
 *    depends on; {@link setPretextSchemaUrl} lets a host self-host instead.
 *  - **`path`/`url`/`fs` are aliased at bundle time** — the package has no
 *    browser build. See `src/nodeShims/README.md`.
 *
 * Everything here is best-effort: a validator that cannot load, a grammar that
 * cannot be fetched, or source that blows up mid-parse must never cost the
 * author their editor. Callers get an empty diagnostic list and life goes on.
 */

import type { Diagnostic } from "@pretextbook/schema";

export type { Diagnostic };

/**
 * Where the compiled grammar comes from. Pinned to `0.5`, matching this
 * package's `^0.5.0` dependency on `@pretextbook/schema` — a caret range on a
 * `0.x` version allows only that same minor, so the two move together. **Bump
 * both at once.**
 */
const DEFAULT_SCHEMA_URL =
  "https://cdn.jsdelivr.net/npm/@pretextbook/schema@0.5/assets/pretext.json";

let schemaUrl = DEFAULT_SCHEMA_URL;

/**
 * Serve the PreTeXt grammar from somewhere other than jsDelivr — a
 * self-hosted copy, an offline bundle, a same-origin path. Call it before the
 * first lint; the compiled grammar is cached from then on.
 *
 * Mirrors `setAssetsBase` in `@pretextbook/pretext-html`, which solves the
 * same problem for the preview's stylesheets.
 */
export function setPretextSchemaUrl(url: string): void {
  if (url === schemaUrl) return;
  schemaUrl = url;
  validatorPromise = undefined;
}

/** The validator, its grammar, and the ruleset — resolved once, then cached. */
interface Validator {
  validate: (source: string) => Diagnostic[];
}

let validatorPromise: Promise<Validator | undefined> | undefined;

async function loadValidator(): Promise<Validator | undefined> {
  const [schema, response] = await Promise.all([
    import("@pretextbook/schema"),
    fetch(schemaUrl),
  ]);
  if (!response.ok) {
    throw new Error(`Grammar fetch failed: ${response.status}`);
  }
  const grammar = schema.loadGrammarFromJSON(await response.text());

  return {
    validate: (source) =>
      schema.validateDocument(source, grammar, {
        uri: "file:///source/main.ptx",
        // The document handed to us is already assembled — every
        // `<plus:* ref/>` expanded, every division inlined — so there is
        // nothing to resolve, and no filesystem here to resolve it from.
        resolveXIncludes: false,
        // Never consulted (xi:include resolution is off), but the default is a
        // node `fs` reader, and leaving that reachable in a browser bundle is
        // asking for a confusing stack trace one refactor from now.
        readFile: () => undefined,
        // Same: cross-file xref/duplicate-id checking reads from disk. The
        // default is `["main.ptx"]`, which would be a failed read every pass.
        rootDocuments: [],
        // Relaxed suppresses violations PreTeXt authors hit legitimately but
        // the stable schema has not caught up with. An editor that cries wolf
        // over valid prose gets its markers ignored wholesale.
        ruleset: schema.relaxedRuleset,
      }).diagnostics,
  };
}

function getValidator(): Promise<Validator | undefined> {
  if (!validatorPromise) {
    validatorPromise = loadValidator();
    // A failed load (offline, blocked CDN) should be retryable rather than
    // cached as a permanent "this editor has no linting".
    validatorPromise.catch(() => {
      validatorPromise = undefined;
    });
  }
  return validatorPromise;
}

/**
 * Validate a complete, assembled `<pretext>` document.
 *
 * Ranges are 0-based and relative to `source` — which is *not* the editor
 * buffer, so callers must map them back (see `pretextDiagnostics.ts`).
 *
 * Resolves empty when the validator is unavailable for any reason. That is
 * indistinguishable from "no problems found", and deliberately so: there is no
 * useful thing an editor can say about a linter that failed to load.
 */
export async function validatePretextDocument(
  source: string,
): Promise<Diagnostic[]> {
  try {
    const validator = await getValidator();
    return validator?.validate(source) ?? [];
  } catch {
    return [];
  }
}
