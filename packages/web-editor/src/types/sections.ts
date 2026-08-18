import type { SourceFormat } from "./editor";

/**
 * Every structural element in a PreTeXt project — book, article, chapter,
 * section, worksheet, etc. — is a `Division`.  Divisions are stored as a flat
 * pool of records on the host (Rails) side; hierarchy is expressed by
 * embedding `<plus:division ref="xml-id"/>` placeholder tags inside a parent
 * division's `source`.
 *
 * Type-specific aliases (`<plus:chapter ref="..."/>`, `<plus:section ref="..."/>`)
 * are accepted by the editor as equivalent to `<plus:division ref="..."/>`.
 *
 * Root divisions (type `"book"`, `"article"`, or `"slideshow"`) are the entry
 * point for building the tree.  Non-root divisions whose `xmlId` does not
 * appear in any other division's ref placeholders are considered *orphaned* and
 * are shown separately in the TOC so they can be placed.
 *
 * `"markdown"` divisions can contain child refs authored as the leaf directive
 * `::section{ref="..."}`, and `"latex"` divisions as the macro
 * `\plus{section}{...}`.  Both are converted to a `<plus:section ref="..."/>`
 * placeholder by `@pretextbook/remark-pretext` / `@pretextbook/latex-pretext`.
 */

/**
 * A division type that is already a legal top-level PreTeXt element, and so can
 * be a project's root. These are element *tag names*, not host-side project
 * categories: a host that models article-vs-book differently (the Rails app
 * carries a `document_type` column) still has to name one of these, because
 * this is the literal tag a synthesized wrapper is written with.
 */
export type RootDivisionType = "book" | "article" | "slideshow";

/**
 * The PreTeXt element type of a division.  Values match the XML tag name so
 * the type can be used directly when serialising (`<${type}>…</${type}>`).
 */
export type DivisionType =
  | RootDivisionType
  // Book structure
  | "part"
  | "chapter"
  // Article / chapter content divisions
  | "section"
  | "subsection"
  | "subsubsection"
  | "introduction"
  | "conclusion"
  | "worksheet"
  | "handout"
  | "exercises"
  | "references"
  | "glossary"
  | "solutions"
  | "reading-questions"
  | "paragraphs"
  // Front and back matter. A book imported by `@pretextbook/import` splits at
  // these too, so the editor has to at least *recognise* them — a
  // `<plus:preface ref="…"/>` it cannot parse is a division record with
  // nothing pointing at it, which the TOC shows as orphaned. They are
  // deliberately absent from `SECTION_TAGS` in `sectionUtils.ts`: the editor's
  // own splitter does not cut a pasted document at them.
  | "frontmatter"
  | "preface"
  | "acknowledgement"
  | "dedication"
  | "biography"
  | "contributors"
  | "backmatter"
  | "appendix"
  | "index"
  | "colophon";

/**
 * A single division record, as stored in the host database and passed to
 * the editor.
 */
export interface Division {
  /**
   * Stable server-assigned identifier. Divisions are persisted through the
   * project's nested `divisions_attributes`, so a freshly-created division has
   * **no** `id` until the project is saved and the server mints one — the
   * *absence* of an `id` is the signal that a division is new. The editor keys
   * division identity on `xmlId` (never `id`), so an id-less division is fully
   * usable the instant it's added.
   */
  id?: string;
  /**
   * The `xml:id` attribute value for this division.  Used as the `ref`
   * value in `<plus:division ref="..."/>` placeholders in parent divisions.
   * Must be unique within the project.
   */
  xmlId: string;
  /** Plain-text display title (extracted from `<title>`). */
  title: string;
  /** The PreTeXt element type of this division. */
  type: DivisionType;
  /**
   * The source format of this division's content.
   * Replaces the project-level `sourceFormat` prop; individual divisions
   * may eventually be converted between formats independently.
   */
  sourceFormat: SourceFormat;
  /**
   * The full source string for this division.
   *
   * For PreTeXt divisions this is the complete XML including the outer
   * wrapper element, e.g. `<section xml:id="..."><title>…</title>…</section>`.
   * Parent divisions may include `<plus:division ref="child-id"/>` placeholders
   * where child divisions should be rendered.
   *
   * For LaTeX / Markdown divisions this is raw source. Markdown may embed
   * child refs as `::section{ref="child-id"}` leaf directives, and LaTeX as
   * `\plus{section}{child-id}` macros.
   */
  source: string;
}

// ---------------------------------------------------------------------------
// Deprecated aliases kept for migration compatibility
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `DivisionType` instead.  This alias will be removed in a
 * future release once all consumers have migrated to the `Division` model.
 */
export type DocumentSectionType = DivisionType;

/**
 * @deprecated Use `Division` instead.  This alias will be removed in a future
 * release once all consumers have migrated to the `Division` model.
 */
export type DocumentSection = Division;

/**
 * @deprecated The chapter/section split no longer exists in the `Division`
 * model — chapters are simply divisions with `type: "chapter"`.  This alias
 * will be removed in a future release.
 */
export interface DocumentChapter {
  id: string;
  title: string;
  xmlId?: string;
  label?: string;
  content?: string;
  sections?: Division[];
}

/**
 * @deprecated The `wrapper` concept has been removed.  Use `Division` records
 * and `<plus:division ref="..."/>` placeholders instead.
 */
export interface DocumentSplitResult {
  wrapper: string;
  sections: Division[];
}
