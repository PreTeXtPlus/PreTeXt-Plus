import type { Division, DivisionType } from "../../types/sections";
import type { SourceFormat } from "../../types/editor";

/** Draft state for the inline division edit form. */
export interface EditDraft {
  title: string;
  type: DivisionType;
  xmlId: string;
  label: string;
  sourceFormat: SourceFormat;
}

export const SOURCE_FORMAT_LABELS: Record<SourceFormat, string> = {
  pretext: "PreTeXt",
  latex: "LaTeX",
  markdown: "Markdown",
};

export const TYPE_LABELS: Record<string, string> = {
  book: "Book",
  article: "Art",
  slideshow: "Slides",
  part: "Part",
  chapter: "Ch",
  introduction: "Intro",
  conclusion: "Conc",
  section: "§",
  worksheet: "WS",
  handout: "HO",
  exercises: "Ex",
  references: "Ref",
  glossary: "Gls",
  solutions: "Sol",
  "reading-questions": "RQ",
  frontmatter: "Front",
  preface: "Pref",
  acknowledgement: "Ack",
  dedication: "Ded",
  biography: "Bio",
  contributors: "Contrib",
  backmatter: "Back",
  appendix: "App",
  index: "Idx",
  colophon: "Coloph",
};

/**
 * Short, lowercase, NCName-safe prefix for a division type, used to seed a
 * brand-new division's `xml:id` (e.g. "ws-my-title" for a worksheet) — see
 * SectionEditForm's title-to-id sync.
 */
export const DIVISION_ID_PREFIXES: Record<DivisionType, string> = {
  book: "bk",
  article: "art",
  slideshow: "slides",
  part: "pt",
  chapter: "ch",
  section: "sec",
  subsection: "subsec",
  subsubsection: "subsubsec",
  introduction: "intro",
  conclusion: "conc",
  worksheet: "ws",
  handout: "ho",
  exercises: "ex",
  references: "ref",
  glossary: "gloss",
  solutions: "sol",
  "reading-questions": "rq",
  paragraphs: "para",
  frontmatter: "front",
  preface: "pref",
  acknowledgement: "ack",
  dedication: "ded",
  biography: "bio",
  contributors: "contrib",
  backmatter: "back",
  appendix: "app",
  index: "idx",
  colophon: "coloph",
};

export const TYPE_FULL_LABELS: Record<string, string> = {
  book: "Book",
  article: "Article",
  slideshow: "Slideshow",
  part: "Part",
  chapter: "Chapter",
  section: "Section",
  worksheet: "Worksheet",
  handout: "Handout",
  exercises: "Exercises",
  references: "References",
  glossary: "Glossary",
  solutions: "Solutions",
  "reading-questions": "Reading Questions",
  introduction: "Introduction",
  conclusion: "Conclusion",
  subsection: "Subsection",
  subsubsection: "Subsubsection",
  paragraphs: "Paragraphs",
  frontmatter: "Front Matter",
  preface: "Preface",
  acknowledgement: "Acknowledgement",
  dedication: "Dedication",
  biography: "Biography",
  contributors: "Contributors",
  backmatter: "Back Matter",
  appendix: "Appendix",
  index: "Index",
  colophon: "Colophon",
};

/**
 * Root document types the author can switch between from the TOC's root
 * "Edit properties" form. Slideshow exists as a division type but isn't
 * offered as a switch target yet.
 */
export const SWITCHABLE_ROOT_TYPES: DivisionType[] = ["article", "book"];

/** Division types that can be freely reordered (not positionally constrained). */
export const REGULAR_DIVISION_TYPES: DivisionType[] = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "worksheet",
  "handout",
  "exercises",
  "references",
  "glossary",
  "solutions",
  "reading-questions",
];

/** Returns true for division types that can be freely reordered. */
export function isRegularDivision(type: string): boolean {
  return type !== "introduction" && type !== "conclusion";
}

/**
 * Specialized divisions that may stand in for a subdivision at any level.
 * `paragraphs` is not among them: it's a lightweight block division, not
 * something to create from the TOC. An existing one still shows its own type
 * (see `getSelectableDivisionTypes`); it just isn't offered as a choice.
 */
const FLEXIBLE_DIVISION_TYPES: DivisionType[] = [
  "worksheet",
  "handout",
  "exercises",
  "references",
  "glossary",
  "solutions",
  "reading-questions",
];

/**
 * Which division types may be placed as a direct child of a given parent
 * division type. Deliberately **total** over `DivisionType`: a partial map
 * would silently fall back to "every type is allowed" for any parent left
 * out, which is how invalid choices reached the Type dropdown before. Adding
 * a new `DivisionType` is therefore a type error until its rule is stated
 * here.
 *
 * An empty list means the type holds no divisions at all (its content is
 * leaf material: exercises, bibliography entries, paragraphs, …), so nothing
 * can be nested under it — see `canContainDivisions`.
 *
 * `introduction`/`conclusion` are absent from every list on purpose: they're
 * positionally constrained (first/last within their parent), so they're never
 * offered as a *choice*. A division that already is one keeps its type — see
 * `getSelectableDivisionTypes`.
 */
export const ALLOWED_CHILD_DIVISION_TYPES: Record<
  DivisionType,
  DivisionType[]
> = {
  // Chapter first: it's a book's usual child, and the head of each list is
  // what a newly added child defaults to (`defaultChildDivisionType`).
  book: ["chapter", "part"],
  article: ["section", ...FLEXIBLE_DIVISION_TYPES],
  slideshow: ["section"],
  part: ["chapter"],
  chapter: ["section", ...FLEXIBLE_DIVISION_TYPES],
  section: ["subsection", ...FLEXIBLE_DIVISION_TYPES],
  subsection: ["subsubsection", ...FLEXIBLE_DIVISION_TYPES],
  subsubsection: [...FLEXIBLE_DIVISION_TYPES],
  // A worksheet/handout divides into <page>s, which aren't a `DivisionType`,
  // and `paragraphs` is no longer offered anywhere — so there's nothing left
  // to nest under either.
  worksheet: [],
  handout: [],
  introduction: [],
  conclusion: [],
  exercises: [],
  references: [],
  glossary: [],
  solutions: [],
  "reading-questions": [],
  paragraphs: [],
  // Front and back matter. Like `introduction`/`conclusion`, none of these
  // appear in any *other* type's list: they are positionally constrained (a
  // book has one frontmatter, first, and one backmatter, last), so they are
  // never offered as a child to create. They arrive from an import, and
  // `getSelectableDivisionTypes` keeps a division's own type selectable
  // whether or not its parent lists it.
  frontmatter: [
    "preface",
    "acknowledgement",
    "dedication",
    "biography",
    "contributors",
    "colophon",
  ],
  backmatter: [
    "appendix",
    "solutions",
    "references",
    "glossary",
    "index",
    "colophon",
  ],
  // An appendix divides like a chapter does.
  appendix: ["section", ...FLEXIBLE_DIVISION_TYPES],
  // The rest hold prose, not divisions.
  preface: [],
  acknowledgement: [],
  dedication: [],
  biography: [],
  contributors: [],
  index: [],
  colophon: [],
};

/**
 * The nesting rule for `type`, or `null` when there is none to apply: a
 * division whose type the host never supplied (it's derived from the source,
 * and LaTeX carries none) or one tagged with something outside
 * `DivisionType`. Callers treat `null` as "no restriction known" — the
 * unrestricted behaviour that predates these rules — rather than as "nothing
 * is allowed".
 */
function allowedChildTypes(
  type: DivisionType | null | undefined,
): DivisionType[] | null {
  if (!type) return null;
  return ALLOWED_CHILD_DIVISION_TYPES[type] ?? null;
}

/** True when divisions may be nested inside a division of this type. */
export function canContainDivisions(
  type: DivisionType | null | undefined,
): boolean {
  const allowed = allowedChildTypes(type);
  return allowed === null || allowed.length > 0;
}

/**
 * The type a newly created child of `parentType` should get — the first type
 * the parent actually allows, so a new division is valid the moment it's
 * added (a new child of a `<book>` is a chapter, not a section). Falls back to
 * `"section"` when the parent is unknown or holds no divisions at all.
 */
export function defaultChildDivisionType(
  parentType: DivisionType | null | undefined,
): DivisionType {
  return allowedChildTypes(parentType)?.[0] ?? "section";
}

/**
 * Returns the division types that should be offered in the "Type" dropdown
 * for a division nested under `parentType`. When there's no rule to apply —
 * no parent at all, or a parent whose type is unknown (see
 * `allowedChildTypes`) — every regular type stays selectable.
 *
 * `currentType` — the type the division actually has — is always included,
 * even when the parent doesn't allow it (an `<introduction>`, or a child left
 * stranded by an edit to its parent's type). The dropdown is what the form
 * displays *and* what Save persists, so a type missing from the list would be
 * shown as some other type and silently rewritten on save.
 */
export function getSelectableDivisionTypes(
  parentType: DivisionType | null | undefined,
  currentType?: DivisionType | null,
): DivisionType[] {
  const allowed = allowedChildTypes(parentType) ?? REGULAR_DIVISION_TYPES;
  if (!currentType || allowed.includes(currentType)) return allowed;
  return [currentType, ...allowed];
}

/** Introduction must be first, conclusion must be last within a parent. */
export function validateDivisionOrder(divisions: Division[]): boolean {
  const introIdx = divisions.findIndex((d) => d.type === "introduction");
  const conclusionIdx = divisions.findIndex((d) => d.type === "conclusion");
  return (
    (introIdx === -1 || introIdx === 0) &&
    (conclusionIdx === -1 || conclusionIdx === divisions.length - 1)
  );
}
