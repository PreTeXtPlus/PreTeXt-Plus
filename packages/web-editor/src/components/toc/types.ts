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
  "paragraphs",
];

/** Returns true for division types that can be freely reordered. */
export function isRegularDivision(type: string): boolean {
  return type !== "introduction" && type !== "conclusion";
}

const FLEXIBLE_DIVISION_TYPES: DivisionType[] = [
  "worksheet",
  "handout",
  "exercises",
  "references",
  "glossary",
  "solutions",
  "reading-questions",
  "paragraphs",
];

/**
 * Which division types may be placed as a direct child of a given parent
 * division type. Not yet populated — add entries here as the nesting rules
 * are defined (e.g. `book: ["part", "chapter"]`).
 * A parent type with no entry falls back to every regular division type
 * being selectable, so the dropdown is unrestricted until a rule exists.
 */
export const ALLOWED_CHILD_DIVISION_TYPES: Partial<
  Record<DivisionType, DivisionType[]>
> = {
  book: ["part", "chapter"],
  article: ["section", ...FLEXIBLE_DIVISION_TYPES],
  slideshow: ["section"],
  part: ["chapter"],
  chapter: ["section", ...FLEXIBLE_DIVISION_TYPES],
  section: ["subsection", ...FLEXIBLE_DIVISION_TYPES],
  subsection: ["subsubsection", ...FLEXIBLE_DIVISION_TYPES],
  subsubsection: [...FLEXIBLE_DIVISION_TYPES],
  worksheet: ["paragraphs"],
  handout: ["paragraphs"],
};

/**
 * Returns the division types that should be offered in the "Type" dropdown
 * for a division nested under `parentType`. `parentType` is `null` for
 * divisions that aren't currently placed under any parent (e.g. unplaced
 * orphans), in which case every regular type remains selectable.
 */
export function getSelectableDivisionTypes(
  parentType: DivisionType | null,
): DivisionType[] {
  if (!parentType) return REGULAR_DIVISION_TYPES;
  return ALLOWED_CHILD_DIVISION_TYPES[parentType] ?? REGULAR_DIVISION_TYPES;
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
