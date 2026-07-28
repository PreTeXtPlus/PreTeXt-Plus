# Division-scoped Full Preview

## Problem

`LivePreview` currently receives `previewContent` (`Editors.tsx`), which is:

- For PreTeXt-format divisions: the active division's raw `content`, including its
  own outer tag (e.g. `<section xml:id="...">...</section>`), but with **no**
  document-level wrapper — no `<pretext>`, no `<book>`/`<article>` root, no
  `<docinfo>`.
- For LaTeX/Markdown-format divisions: `divisionConvertedPretext`, the **inner**
  converted body only — not even wrapped in the division's own tag.

Neither shape is a document the build server (`https://build.pretext.plus`) can
render as a real PreTeXt build. We want full preview to always build from just
the currently-viewed division (already true today, in the sense that it never
pulls in other divisions), wrapped in just enough structure for the build
server to treat it as a self-contained fragment.

The full-document build (resolving every `<plus:* ref="..."/>` across the whole
divisions pool) is unaffected — that happens via `assembleProjectSource`, which
the host calls separately when saving/exiting, not on every preview rebuild.

## Non-goals

- Expanding `<plus:* ref="..."/>` placeholders inside the previewed division.
  They are left untouched; the build server is expected to special-case them
  for fragment previews via custom XSL (a build-server-side concern, out of
  scope here).
- Fixing the existing `emitContentChange` gap where `pretextSource` is always
  `undefined` for latex/markdown edits (contradicts the documented
  `EditorContentState`/`EditorContentChange` contract). Tracked as a separate,
  later task.
- Any change to the full-document build path (`assembleProjectSource`,
  `resolveDivisionXml`).

## Design

### 1. New pure wrapping function — `sectionUtils.ts`

```ts
export function wrapDivisionForPreview(
  divisionType: DivisionType,
  divisionXml: string,
  docinfo: string,
): string;
```

Conversion-agnostic: takes XML that is already fully tagged with the
division's own outer element (e.g. `<section xml:id="...">...</section>` or
`<chapter>...</chapter>`), and:

1. Picks a minimal type-based wrapper:
   - `book` / `article` / `slideshow` (root types): no extra wrapper — the XML
     already has its own root tag.
   - `chapter` / `part`: wrap in a bare `<book>...</book>`.
   - everything else (`section`, `introduction`, `worksheet`, `exercises`,
     etc.): wrap in a bare `<article>...</article>`.
2. Wraps the result in `<pretext>{docinfo}{wrapped-or-not}</pretext>`, with
   `docinfo` inserted as a **sibling** of the root element (matching real
   PreTeXt document shape — `docinfo` is not nested inside `book`/`article`).
3. Never inspects or modifies `<plus:* ref="..."/>` placeholders inside
   `divisionXml` — whatever is there passes through unchanged.

This function has no dependency on `Division`, conversion, or the divisions
pool — pure string-in, string-out.

### 2. Wiring — `Editors.tsx`

- Compute `effectiveDocinfo`: `useCommonDocinfo ? commonDocinfo : docinfo`,
  using the same `props.x ?? internalX` resolution already used in the
  `syncState` effect. (No such "effective docinfo" selection exists anywhere
  today — `DocinfoEditor` only edits both values, it doesn't select between
  them for consumers.)
- Compute the active division's own tagged XML, reusing what's already
  available — no new conversion logic:
  - PreTeXt format: `activeDivision.source` as-is.
  - LaTeX/Markdown format: reconstruct the division's own tag around the
    **already-memoized** `divisionConvertedPretext`
    (`` `<${type} xml:id="${xmlId}">\n<title>${title}</title>\n\n${convertedBody}\n</${type}>` ``),
    or `undefined` if conversion failed (`divisionConvertedPretext` is
    `undefined` on error) — preview falls back to empty content in that case,
    same as today.
- Replace the `previewContent` computation with:
  `wrapDivisionForPreview(activeDivision.type, taggedXml, effectiveDocinfo)`.
- `divisionConvertedPretext` itself is untouched — still used by the
  Convert-to-PreText dialog.

### 3. Public API doc update

The `onPreviewRebuild` JSDoc on `editorProps` currently describes `source` as
"the current PreTeXt XML to render." Update it to note that `source` is now a
self-contained fragment document (synthetic `<pretext>`/`<book>`/`<article>`
wrapper + docinfo) for just the active division, with any `<plus:* ref="..."/>`
inside it left unexpanded — not the raw division content.

## Files touched

- `src/sectionUtils.ts` — add `wrapDivisionForPreview`.
- `src/components/Editors.tsx` — compute `effectiveDocinfo` and the active
  division's tagged XML; replace `previewContent`; update `onPreviewRebuild`
  JSDoc.

## Manual verification

No automated tests in this repo (per `CLAUDE.md`). Verify via `npm run dev`:

- Load the Book demo, select a `section` division deep in a chapter — preview
  payload (visible via the demo's existing "Show Build Payload" panel is a
  _different_ code path, so instead inspect the POST via browser devtools or
  a temporary console log) should show `<pretext><docinfo>...</docinfo>
  <article><section ...>...</section></article></pretext>`.
- Select a `chapter` division — wrapper should be `<book>`, not `<article>`.
- Select the root `book`/`article` division — no synthetic wrapper tag, just
  `<pretext><docinfo>...</docinfo><book ...>...</book></pretext>`.
- A division whose content contains `<plus:section ref="..."/>` — confirm the
  placeholder is sent through completely unexpanded.
- Toggle `useCommonDocinfo` (if exposed in the demo) and confirm the right
  docinfo source is used.
- A LaTeX or Markdown division — confirm preview still renders (tagged +
  wrapped converted content), not just a bare inner fragment.
