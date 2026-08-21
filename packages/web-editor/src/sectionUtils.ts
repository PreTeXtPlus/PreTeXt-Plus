/**
 * Utilities for splitting a PreTeXt article into individual sections and
 * merging them back into a complete document.
 *
 * Splitting always works at the `<section>`, `<introduction>`, and
 * `<conclusion>` level inside a top-level `<article>` element.
 */

import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import type { Element, ElementContent, Root } from "xast";
import type { Asset, Snippet, SourceFormat } from "./types/editor";
import type {
  Division,
  DivisionType,
  DocumentSection,
  DocumentSectionType,
  DocumentSplitResult,
  RootDivisionType,
} from "./types/sections";
import { derivePretextContent } from "./contentConversion";
import { resolveAssetRef } from "./assetTransforms";
import { escapeAttribute } from "./xmlUtils";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Serialize empty elements as self-closing (`<x/>` rather than `<x></x>`). */
const XML_SERIALIZE_OPTIONS = { closeEmptyElements: true, tightClose: true };

/** Generate a simple unique ID (not RFC-4122, but collision-resistant enough for in-memory use). */
function generateId(): string {
  return `sec-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Extract the plain-text title from a `<section>` / `<introduction>` / `<conclusion>` element. */
function extractTitle(element: Element): string {
  const titleChild = element.children.find(
    (child) => child.type === "element" && (child as Element).name === "title",
  ) as Element | undefined;
  if (!titleChild) return "";
  return titleChild.children
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; value: string }).value)
    .join("")
    .trim();
}

const SECTION_TAGS: ReadonlySet<string> = new Set([
  "introduction",
  "section",
  "worksheet",
  "handout",
  "exercises",
  "references",
  "glossary",
  "solutions",
  "reading-questions",
  "conclusion",
]);

/**
 * Every tag name recognised as a `DivisionType` — broader than
 * {@link SECTION_TAGS}, which lists only the tags a document *splits* at. The
 * nested levels belong here: a division record can be any `DivisionType`, and
 * a `<subsection>` whose tag went unrecognised is a division whose type and
 * title can't be read back out of its own source.
 *
 * This set is also the *inbound* contract with `@pretextbook/import`, whose
 * `PRETEXT_DIVISION_TAGS` decides which divisions an import splits into their
 * own records. Whatever it splits at, it emits a `<plus:TAG ref="…"/>`
 * placeholder for, and a tag missing from here is one
 * {@link parseDivisionRefs} skips — leaving a real division record that no
 * parent points at, which the TOC reports as orphaned. The front/back matter
 * entries below exist for exactly that reason; `importDivisionTags.test.ts`
 * pins the two lists together.
 */
const ALL_DIVISION_TYPES: ReadonlySet<string> = new Set([
  "book",
  "article",
  "slideshow",
  "part",
  "chapter",
  "subsection",
  "subsubsection",
  "paragraphs",
  // Front and back matter — recognised as divisions, but not split at by this
  // editor's own document splitter, so deliberately not in SECTION_TAGS.
  "frontmatter",
  "preface",
  "acknowledgement",
  "dedication",
  "biography",
  "contributors",
  "backmatter",
  "appendix",
  "index",
  "colophon",
  ...SECTION_TAGS,
]);

function tagToType(tag: string): DocumentSectionType {
  return SECTION_TAGS.has(tag) ? (tag as DocumentSectionType) : "section";
}

function untitledLabel(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

const DOCUMENT_ROOT_TAGS: ReadonlySet<string> = new Set([
  "article",
  "book",
  "letter",
  "memo",
  "slideshow",
]);

function trimTrailingWhitespaceNodes(
  children: Root["children"],
): Root["children"] {
  let end = children.length;
  while (end > 0) {
    const node = children[end - 1];
    if (node.type !== "text" || /\S/.test(node.value)) break;
    end -= 1;
  }
  return children.slice(0, end);
}

function trimBoundaryWhitespaceNodes(
  children: Root["children"],
): Root["children"] {
  let start = 0;
  let end = children.length;

  while (start < end) {
    const node = children[start];
    if (node.type !== "text" || /\S/.test(node.value)) break;
    start += 1;
  }

  while (end > start) {
    const node = children[end - 1];
    if (node.type !== "text" || /\S/.test(node.value)) break;
    end -= 1;
  }

  return children.slice(start, end);
}


function trimBoundaryBlankLines(value: string): string {
  return value
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "");
}

/**
 * Parse XML defensively.  Returns `null` instead of throwing when the input is
 * not well-formed.  Callers that run during render (e.g. `stripSectionWrapper`)
 * MUST use this rather than `fromXml` directly: the user routinely passes
 * temporarily-invalid XML while typing, and an uncaught parse error there
 * crashes the whole editor.
 */
function safeFromXml(xml: string): Root | null {
  try {
    return fromXml(xml);
  } catch {
    return null;
  }
}

/**
 * Parse `titleText` as the content of a `<title>` element so that PreTeXt
 * inline markup the user types directly into the title field (e.g.
 * `<term>Foo</term>`) is inserted as real XML elements rather than escaped
 * as literal text on serialization. Falls back to a single text node verbatim
 * when `titleText` isn't well-formed XML on its own (e.g. a `<` typed mid-edit
 * before its matching tag is closed).
 */
function parseTitleChildren(titleText: string): ElementContent[] {
  const tree = safeFromXml(`<__title__>${titleText}</__title__>`);
  const wrapper = tree?.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  return wrapper ? wrapper.children : [{ type: "text", value: titleText }];
}

/**
 * Strip the outer element from `xml` using string matching only — a fallback
 * for when the content cannot be parsed as well-formed XML.  Removes the first
 * opening tag and its matching trailing closing tag; returns the input
 * unchanged when no wrapper is detected.
 */
function stripWrapperByRegex(xml: string): string {
  const open = xml.match(/^\s*<([A-Za-z_][\w.:-]*)\b[^>]*?>/);
  if (!open || open.index === undefined) return xml;
  const afterOpen = xml.slice(open.index + open[0].length);
  const closeRe = new RegExp(`\\s*</${escapeRegex(open[1])}\\s*>\\s*$`);
  // Matches trimBoundaryWhitespaceNodes behavior in the valid-XML path so the
  // leading "\n" from rewrapSection doesn't appear as a spurious blank line.
  return trimBoundaryBlankLines(afterOpen.replace(closeRe, ""));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------


/**
 * Replace (or insert) the `<title>` of a section XML string with `newTitle`.
 * Returns the updated XML string.
 */
export function updateDivisionTitle(
  divisionXml: string,
  newTitle: string,
): string {
  const tree = safeFromXml(divisionXml);
  if (!tree) return divisionXml;
  const rootEl = tree.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  if (!rootEl) return divisionXml;

  const titleIndex = rootEl.children.findIndex(
    (n) => n.type === "element" && (n as Element).name === "title",
  );

  const titleNode: Element = {
    type: "element",
    name: "title",
    attributes: {},
    children: parseTitleChildren(newTitle),
  };

  if (titleIndex === -1) {
    rootEl.children.unshift(titleNode);
  } else {
    rootEl.children.splice(titleIndex, 1, titleNode);
  }

  return toXml(tree, XML_SERIALIZE_OPTIONS);
}

/**
 * Create a new blank division as a `Division` — a `<section>` unless `type`
 * says otherwise (a new child of a `<book>` has to be a chapter, say; see
 * `defaultChildDivisionType`).
 */
export function createNewSection(
  title = "New Section",
  type: DivisionType = "section",
): DocumentSection {
  const id = generateId();
  const source = `<${type} xml:id="${id}">\n\t<title>${title}</title>\n\n\t<p>\n\n\t</p>\n\n</${type}>`;
  return {
    id,
    xmlId: id,
    title,
    source,
    type,
    sourceFormat: "pretext",
  };
}

/** Create a blank `<introduction>` division. */
export function createIntroduction(): DocumentSection {
  const id = generateId();
  const source = `<introduction xml:id="${id}">\n\n\t<p>\n\n\t</p>\n\n</introduction>`;
  return {
    id,
    xmlId: id,
    title: "Introduction",
    source,
    type: "introduction",
    sourceFormat: "pretext",
  };
}

/** Create a blank `<conclusion>` division. */
export function createConclusion(): DocumentSection {
  const id = generateId();
  const source = `<conclusion xml:id="${id}">\n\n\t<p>\n\n\t</p>\n\n</conclusion>`;
  return {
    id,
    xmlId: id,
    title: "Conclusion",
    source,
    type: "conclusion",
    sourceFormat: "pretext",
  };
}

/**
 * Strip the outer wrapper element from a section XML string, returning just the
 * inner XML content (i.e. everything between `<section>` and `</section>`).
 * Used to show only the section body in the code editor so users can't
 * accidentally edit or delete the enclosing element.
 */
export function stripSectionWrapper(sectionXml: string): string {
  const tree = safeFromXml(sectionXml);
  // Malformed XML (common while the user is mid-edit): fall back to a
  // string-based strip so we still show the body instead of crashing.
  if (!tree) return stripWrapperByRegex(sectionXml);
  const rootEl = tree.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  if (!rootEl) return sectionXml;
  const inner: Root = {
    type: "root",
    children: trimBoundaryWhitespaceNodes(rootEl.children),
  };
  return toXml(inner, XML_SERIALIZE_OPTIONS);
}

/**
 * Re-wrap inner XML content (as returned by the code editor) with the correct
 * outer element for the given section type.
 *
 * Because `DocumentSectionType` values are identical to the XML tag names,
 * this is simply `<${type}>inner</${type}>`.
 */
export function rewrapSection(
  innerXml: string,
  type: DocumentSectionType,
): string {
  const normalizedInnerXml = trimBoundaryBlankLines(innerXml);
  return `<${type}>\n${normalizedInnerXml}\n</${type}>`;
}

/**
 * Ensure the given XML string has the correct outer element for its section
 * type.  If the outer tag is already present it is returned unchanged;
 * otherwise the content is re-wrapped so that accidental deletions in the
 * code editor are recovered gracefully.
 */
export function ensureSectionWrapper(
  content: string,
  type: DocumentSectionType,
): string {
  const trimmed = content.trimStart();
  if (trimmed.startsWith(`<${type}`)) return content;
  return rewrapSection(content, type);
}

export function splitDocument(xml: string): DocumentSplitResult {
  let normalized = xml.trim();
  if (normalized.startsWith("<?xml")) {
    const end = normalized.indexOf("?>");
    if (end !== -1) normalized = normalized.slice(end + 2).trim();
  }
  const tree = safeFromXml(`<__root__>${normalized}</__root__>`);
  // Malformed XML: treat the whole document as a single, unsplit blob rather
  // than throwing (which would crash the editor during a render/keystroke).
  if (!tree) return { wrapper: xml, sections: [] };
  const syntheticRoot = tree.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  if (!syntheticRoot) return { wrapper: "", sections: [] };

  const elementChildren = syntheticRoot.children.filter(
    (n) => n.type === "element",
  ) as Element[];

  if (
    elementChildren.length === 1 &&
    DOCUMENT_ROOT_TAGS.has(elementChildren[0].name)
  ) {
    const docRoot = elementChildren[0];
    const sectionElements = docRoot.children.filter(
      (c) => c.type === "element" && SECTION_TAGS.has((c as Element).name),
    ) as Element[];
    const nonSectionChildren = trimTrailingWhitespaceNodes(
      docRoot.children.filter(
        (c) => !(c.type === "element" && SECTION_TAGS.has((c as Element).name)),
      ),
    );
    const wrapperRoot: Root = {
      type: "root",
      children: [{ ...docRoot, children: nonSectionChildren } as Element],
    };
    const wrapper = toXml(wrapperRoot, XML_SERIALIZE_OPTIONS);
    if (sectionElements.length === 0) return { wrapper, sections: [] };
    return {
      wrapper,
      sections: sectionElements.map((el) => {
        const id = generateId();
        return {
          id,
          xmlId: (el.attributes?.["xml:id"] as string) || id,
          title: extractTitle(el) || untitledLabel(el.name),
          source: toXml({ type: "root", children: [el] } as Root, XML_SERIALIZE_OPTIONS),
          type: tagToType(el.name),
          sourceFormat: "pretext" as const,
        };
      }),
    };
  }

  const sectionElements = elementChildren.filter((el) => SECTION_TAGS.has(el.name));
  if (sectionElements.length === 0) return { wrapper: "", sections: [] };
  return {
    wrapper: "",
    sections: sectionElements.map((el) => {
      const id = generateId();
      return {
        id,
        xmlId: (el.attributes?.["xml:id"] as string) || id,
        title: extractTitle(el) || untitledLabel(el.name),
        source: toXml({ type: "root", children: [el] } as Root, XML_SERIALIZE_OPTIONS),
        type: tagToType(el.name),
        sourceFormat: "pretext" as const,
      };
    }),
  };
}

export function mergeDocument(
  wrapper: string,
  sections: DocumentSection[],
): string {
  if (!wrapper) return sections.map((s) => s.source).join("\n\n");
  const wrapperTree = safeFromXml(wrapper);
  if (!wrapperTree) return sections.map((s) => s.source).join("\n\n");
  const rootElement = wrapperTree.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  if (!rootElement) return sections.map((s) => s.source).join("\n\n");
  const sectionNodes: Element[] = sections.flatMap((sec) => {
    try {
      const secTree: Root = fromXml(sec.source);
      return secTree.children.filter((n) => n.type === "element") as Element[];
    } catch {
      return [];
    }
  });
  const interleaved = sectionNodes.flatMap((node) => [
    { type: "text" as const, value: "\n\n" },
    node,
  ]);
  const merged: Root = {
    type: "root",
    children: [
      {
        ...rootElement,
        children: [
          ...rootElement.children,
          ...interleaved,
          { type: "text" as const, value: "\n" },
        ],
      } as Element,
    ],
  };
  return toXml(merged, XML_SERIALIZE_OPTIONS);
}

// ---------------------------------------------------------------------------
// Chapter wrapper utilities (book mode)
// ---------------------------------------------------------------------------

/**
 * Strip the outer `<chapter>` element from a chapter XML string, returning
 * just its inner content (title, sections, etc.).  Behaves exactly like
 * {@link stripSectionWrapper}: the enclosing element is dropped but all
 * children are kept, so the user edits the chapter body without ever seeing
 * or editing the `<chapter>` division tag itself.
 */
export function stripChapterWrapper(chapterXml: string): string {
  return stripSectionWrapper(chapterXml);
}

/**
 * Re-wrap chapter body content (as produced by the code editor) with the
 * original `<chapter>` element, preserving its tag name and all attributes
 * (e.g. `xml:id`, `label`).
 *
 * The attributes are recovered from `originalChapterXml` — the last known
 * full chapter source — so that editing the body never drops them.  String
 * concatenation (rather than re-serialising via xast) keeps this robust to
 * invalid inner XML while the user is mid-edit.
 */
export function rewrapChapter(
  innerXml: string,
  originalChapterXml: string,
): string {
  let name = "chapter";
  const attrs: Record<string, string> = {};
  try {
    const tree: Root = fromXml(originalChapterXml);
    const el = tree.children.find((n) => n.type === "element") as
      | Element
      | undefined;
    if (el) {
      name = el.name;
      for (const [key, value] of Object.entries(el.attributes ?? {})) {
        if (value == null) continue;
        attrs[key] = String(value);
      }
    }
  } catch {
    // Fall back to a bare <chapter> wrapper if the original can't be parsed.
  }
  const attrStr = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join("");
  const normalizedInner = trimBoundaryBlankLines(innerXml);
  return `<${name}${attrStr}>\n${normalizedInner}\n</${name}>`;
}


// ===========================================================================
// LaTeX-specific section utilities
// ===========================================================================

interface LatexWrapper {
  preamble: string;
  closing: string;
}

function encodeLatexWrapper(w: LatexWrapper): string {
  return JSON.stringify(w);
}

function decodeLatexWrapper(s: string): LatexWrapper | null {
  try {
    return JSON.parse(s) as LatexWrapper;
  } catch {
    return null;
  }
}

function extractLatexSectionTitle(sectionCmd: string): string {
  const m = /\\section\*?\{([^}]*)\}/.exec(sectionCmd);
  return m?.[1]?.trim() ?? "Section";
}

function splitLatexPreamble(latex: string): {
  preamble: string;
  body: string;
  closing: string;
} {
  const beginIdx = latex.indexOf("\\begin{document}");
  if (beginIdx === -1) return { preamble: "", body: latex, closing: "" };
  const afterBegin = beginIdx + "\\begin{document}".length;
  const endIdx = latex.lastIndexOf("\\end{document}");
  if (endIdx !== -1 && endIdx > afterBegin) {
    return {
      preamble: latex.slice(0, afterBegin),
      body: latex.slice(afterBegin, endIdx),
      closing: latex.slice(endIdx),
    };
  }
  return { preamble: latex.slice(0, afterBegin), body: latex.slice(afterBegin), closing: "" };
}

function splitLatexByCommands(latex: string): DocumentSplitResult {
  const { preamble, body, closing } = splitLatexPreamble(latex);
  const parts = body.split(/(\\section\*?\{[^}]*\})/);
  const sections: DocumentSection[] = [];
  const intro = parts[0].trim();
  if (intro) {
    const id = generateId();
    sections.push({ id, xmlId: id, title: "Introduction", source: intro, type: "introduction", sourceFormat: "latex" });
  }
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i];
    const sectionBody = parts[i + 1] ?? "";
    const title = extractLatexSectionTitle(header);
    const id = generateId();
    sections.push({ id, xmlId: id, title, source: header + sectionBody, type: "section", sourceFormat: "latex" });
  }
  const wrapper = preamble ? encodeLatexWrapper({ preamble, closing }) : "";
  return { wrapper, sections };
}

function splitLatexByEnvironments(latex: string): DocumentSplitResult {
  const { preamble, body, closing } = splitLatexPreamble(latex);
  const envRe = /\\begin\{section\}([\s\S]*?)\\end\{section\}/g;
  const sections: DocumentSection[] = [];
  const firstMatch = envRe.exec(body);
  if (firstMatch) {
    const before = body.slice(0, firstMatch.index).trim();
    if (before) {
      const id = generateId();
      sections.push({ id, xmlId: id, title: "Introduction", source: before, type: "introduction", sourceFormat: "latex" });
    }
    const titleMatch = /\\title\{([^}]*)\}/.exec(firstMatch[1]);
    const title = titleMatch?.[1]?.trim() ?? "Section";
    const id = generateId();
    sections.push({ id, xmlId: id, title, source: firstMatch[0], type: "section", sourceFormat: "latex" });
  }
  let match: RegExpExecArray | null;
  while ((match = envRe.exec(body)) !== null) {
    const titleMatch = /\\title\{([^}]*)\}/.exec(match[1]);
    const title = titleMatch?.[1]?.trim() ?? "Section";
    const id = generateId();
    sections.push({ id, xmlId: id, title, source: match[0], type: "section", sourceFormat: "latex" });
  }
  const wrapper = preamble ? encodeLatexWrapper({ preamble, closing }) : "";
  return { wrapper, sections };
}

export function splitLatexDocument(latex: string): DocumentSplitResult {
  if (/\\begin\{section\}/.test(latex)) return splitLatexByEnvironments(latex);
  return splitLatexByCommands(latex);
}

export function mergeLatexDocument(
  wrapper: string,
  sections: DocumentSection[],
): string {
  const sectionTexts = sections.map((s) => s.source).join("\n\n");
  if (!wrapper) return sectionTexts;
  const w = decodeLatexWrapper(wrapper);
  if (!w) return sectionTexts;
  const parts = [w.preamble, sectionTexts];
  parts.push(w.closing || "\\end{document}");
  return parts.join("\n\n");
}

/**
 * Strip the section-level header from a LaTeX section string so the code
 * editor shows only the body content.
 *
 * - For `\section{…}`-style sections: removes the leading `\section{…}` command.
 * - For `\begin{section}…\end{section}`-style: removes the wrapper tags.
 * - For introduction / conclusion (no header): returns as-is.
 */
export function stripLatexSectionWrapper(
  content: string,
  type: DocumentSectionType,
): string {
  if (type === "introduction" || type === "conclusion") {
    return content; // no structural wrapper to strip
  }
  const trimmed = content.trimStart();
  if (trimmed.startsWith("\\begin{section}")) {
    return trimmed
      .replace(/^\\begin\{section\}\s*\n?/, "")
      .replace(/\n?\\end\{section\}\s*$/, "");
  }
  // Remove the leading `\section{…}` / `\worksheet{…}` header line, however
  // malformed — `parseLatexDivisionHeader` reports its full extent.
  const header = parseLatexDivisionHeader(content);
  if (!header) return content;
  return content.slice(header.length).replace(/^\s+/, "");
}

/**
 * Re-wrap inner LaTeX content (as produced by the code editor) with the
 * correct section header for the given section type and title.
 *
 * - `section` type: prepends `\section{title}`.
 * - `introduction` / `conclusion`: returns inner content unchanged.
 *
 * Pass `originalContent` to detect whether the document uses environment style
 * (`\begin{section}…\end{section}`) so the same style is preserved.
 */
export function rewrapLatexSection(
  inner: string,
  type: DocumentSectionType,
  title: string,
  originalContent?: string,
): string {
  if (type === "introduction" || type === "conclusion") {
    return inner;
  }
  // Detect environment style from the original content
  if (originalContent?.trimStart().startsWith("\\begin{section}")) {
    return `\\begin{section}\n\n${inner}\n\n\\end{section}`;
  }
  // The header command is named after the division type, so a `<worksheet>`
  // gets `\worksheet{…}` back rather than being demoted to a `\section{…}`.
  const macro = ALL_DIVISION_TYPES.has(type) ? type : "section";
  return joinLatexHeaderAndBody(
    buildLatexDivisionHeader({ macro, title }),
    inner,
  );
}

/**
 * Ensure the given LaTeX string has the correct section header/wrapper for its
 * type.  If the header is already present it is returned unchanged; otherwise
 * it is re-wrapped using `rewrapLatexSection` so that accidental deletions in
 * the code editor are recovered gracefully.
 */
export function ensureLatexSectionWrapper(
  content: string,
  type: DocumentSectionType,
  title: string,
  originalContent?: string,
): string {
  if (type === "introduction" || type === "conclusion") {
    return content; // no structural wrapper for these
  }
  if (content.trimStart().startsWith("\\begin{section}")) return content;
  // Any recognised division macro counts as an intact header — not just
  // `\section`, since the header is named after the division's own type.
  const header = parseLatexDivisionHeader(content);
  if (header && ALL_DIVISION_TYPES.has(header.macro)) return content;
  return rewrapLatexSection(content, type, title, originalContent);
}

/**
 * A LaTeX division's header, as read off the first line of its source.
 *
 * The macro name mirrors the PreTeXt division type (so `\worksheet{…}` reads as,
 * and is converted to, a `<worksheet>`), which is why hyphens are allowed even
 * though they aren't valid in a raw LaTeX command name — the header is only ever
 * rewritten from the TOC, never hand-typed.
 */
export interface LatexDivisionHeader {
  /** The header command name without its backslash — the division type. */
  macro: string;
  /** Whether the command was starred (`\section*{…}`). */
  starred: boolean;
  /** The title argument, with any `\label{…}` written inside it removed. */
  title: string;
  /** The header's `\label{…}` value — a division's `xml:id` — or `""`. */
  label: string;
  /**
   * How many characters of the source the header occupies, counting leading
   * whitespace and any malformed leftovers (stray `}`, duplicate `\label`s).
   * `source.slice(length)` is therefore the body, junk-free.
   */
  length: number;
}

/**
 * Read a LaTeX division's header off the first line of `content`, returning
 * `null` when there is none (an introduction/conclusion body, or the
 * `\begin{section}…\end{section}` environment style, which `\begin`/`\end` are
 * excluded so as not to be mistaken for a command header).
 *
 * This is deliberately *tolerant* rather than strict, because it is the only
 * thing standing between a mangled header and a division the author can no
 * longer fix: the header line is locked in the code editor, so whatever it
 * reads here is the sole route back to a well-formed one. It therefore
 * brace-matches the title argument rather than stopping at the first `}` (so
 * `\section{Foo\label{s}}` — a common hand-written LaTeX idiom, and the shape an
 * import can leave behind — yields the title `Foo` and the label `s` rather than
 * a title containing half a `\label`), and then swallows any run of stray `}`,
 * whitespace and further `\label{…}` commands that follows, since all of it is
 * header wreckage rather than body content. The last word on the label goes to
 * the one written *after* the argument, which is what the TOC form writes.
 *
 * Scanning never leaves the first line: a header is always written on one line,
 * and everything below it is the author's body, which must never be eaten.
 */
export function parseLatexDivisionHeader(
  content: string,
): LatexDivisionHeader | null {
  const lead = /^\s*/.exec(content)![0];
  const afterLead = content.slice(lead.length);
  const newline = afterLead.search(/\r?\n/);
  const line = newline === -1 ? afterLead : afterLead.slice(0, newline);

  const open = /^\\(?!begin\b|end\b)([A-Za-z][A-Za-z-]*)(\*?)\{/.exec(line);
  if (!open) return null;

  // Brace-match the title argument. An escaped pair (`\{`, `\}`) is copied
  // through without touching the depth; an unterminated argument ends at the
  // end of the line, taking whatever was there as the title.
  let i = open[0].length;
  let depth = 1;
  let arg = "";
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      arg += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      i++;
      break;
    }
    arg += ch;
    i++;
  }

  // Trailing header wreckage: unmatched closing braces, and one or more
  // `\label{…}` commands. Anything else ends the header and stays in the body.
  const trailingLabels: string[] = [];
  while (i < line.length) {
    if (line[i] === " " || line[i] === "\t" || line[i] === "}") {
      i++;
      continue;
    }
    const label = /^\\label\{([^}]*)\}/.exec(line.slice(i));
    if (!label) break;
    trailingLabels.push(label[1].trim());
    i += label[0].length;
  }

  const innerLabels: string[] = [];
  const title = arg
    .replace(/\\label\{([^}]*)\}/g, (_full, id: string) => {
      innerLabels.push(id.trim());
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();

  return {
    macro: open[1],
    starred: open[2] === "*",
    title,
    label: trailingLabels[0] ?? innerLabels[0] ?? "",
    length: lead.length + i,
  };
}

/**
 * Whether `line` opens a LaTeX division — a header command named after a real
 * division type (`\section{`, `\worksheet{`, `\article{`, …).
 *
 * Stricter than {@link parseLatexDivisionHeader} on purpose: this is what
 * decides whether a line may be locked and rewritten, and a division body that
 * merely happens to start with a macro (`\emph{Once} upon a time.` at the top
 * of an introduction) is prose, not structure.
 */
export function isLatexDivisionHeaderLine(line: string): boolean {
  const header = parseLatexDivisionHeader(line);
  return header !== null && ALL_DIVISION_TYPES.has(header.macro);
}

/** Render a division header from its parts — the inverse of {@link parseLatexDivisionHeader}. */
export function buildLatexDivisionHeader(header: {
  macro: string;
  starred?: boolean;
  title: string;
  label?: string;
}): string {
  const star = header.starred ? "*" : "";
  const label = header.label ? `\\label{${header.label}}` : "";
  return `\\${header.macro}${star}{${header.title}}${label}`;
}

/**
 * Join a rewritten header to the rest of a division's source, always separated
 * by exactly one blank line.
 *
 * The blank line isn't cosmetic: `@pretextbook/latex-pretext` reads a first
 * paragraph butted straight up against the header as part of the header rather
 * than as a paragraph of its own, so a division saved without it converts
 * wrongly. Every path that writes a header goes through here, and
 * `computeLockedRegion` locks the blank line along with the header so it can't
 * be typed away again.
 */
function joinLatexHeaderAndBody(header: string, rest: string): string {
  const body = rest.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/^[ \t]+/, "");
  return body ? `${header}\n\n${body}` : `${header}\n\n`;
}

/**
 * Rewrite a LaTeX division's header from what {@link parseLatexDivisionHeader}
 * could recover from it, dropping anything malformed and guaranteeing the blank
 * line below it. Idempotent, and a no-op for anything whose first line isn't a
 * recognised division header — an introduction's prose, or a body that happens
 * to open with some other macro, must be left exactly as the author wrote it.
 */
export function normalizeLatexDivisionSource(source: string): string {
  const header = parseLatexDivisionHeader(source);
  if (!header || !ALL_DIVISION_TYPES.has(header.macro)) return source;
  return joinLatexHeaderAndBody(
    buildLatexDivisionHeader(header),
    source.slice(header.length),
  );
}

/**
 * Replace (or insert) the section title in a LaTeX section string.
 *
 * - For command style (`\section{…}`, `\worksheet{…}`, …): rewrites the header.
 * - For `\begin{section}` style: updates the `\title{…}` inside.
 */
export function updateLatexSectionTitle(
  content: string,
  newTitle: string,
): string {
  const header = parseLatexDivisionHeader(content);
  if (header) {
    return joinLatexHeaderAndBody(
      buildLatexDivisionHeader({ ...header, title: newTitle }),
      content.slice(header.length),
    );
  }
  if (content.includes("\\begin{section}")) {
    if (/\\title\{/.test(content)) {
      return content.replace(/\\title\{[^}]*\}/, `\\title{${newTitle}}`);
    }
    return content.replace(
      "\\begin{section}",
      `\\begin{section}\n\n\\title{${newTitle}}\n\n`,
    );
  }
  return content;
}

/**
 * Derive a LaTeX division's title directly from its header — the code
 * editor's source-of-truth content — mirroring the two header styles
 * {@link updateLatexSectionTitle} writes. Returns `null` when no header is
 * found (introduction/conclusion have none), so callers leave title as-is.
 */
export function extractLatexDivisionTitle(content: string): string | null {
  const header = parseLatexDivisionHeader(content);
  if (header) return header.title;
  if (content.includes("\\begin{section}")) {
    const titleMatch = /\\title\{([^}]*)\}/.exec(content);
    if (titleMatch) return titleMatch[1].trim();
  }
  return null;
}

/**
 * Extract the `\label{…}` belonging to a LaTeX division's header — the LaTeX
 * spelling of a division's `xml:id`, since `@pretextbook/latex-pretext` maps
 * `\label` → `xml:id`.  Only the header's label is read (a `\label` inside the
 * body is ignored).  Returns `""` when no header label is present.
 */
export function extractLatexSectionLabel(content: string): string {
  return parseLatexDivisionHeader(content)?.label ?? "";
}

/**
 * Update a LaTeX division's header type, title, and/or `xml:id`.
 *
 * - `type` renames the header command (`\section{` → `\worksheet{`) so the
 *   source reads as the division it represents.
 * - `title` becomes the header command's argument.
 * - `xmlId` becomes the `\label{…}` after it — inserted when absent, dropped
 *   when `null`/empty.
 *
 * Omit a key (or pass `undefined`) to keep whatever the current header says.
 * The header is rebuilt wholesale from those three values rather than patched
 * field-by-field, so a division that arrived with a malformed one (a `\label`
 * left inside the title argument, a doubled `}`) comes back well-formed — the
 * only repair route there is, since the header line is locked in the code
 * editor. Only the command-style header is handled; `\begin{section}` divisions
 * keep the title-only update. This is the LaTeX analogue of
 * {@link updateSectionMetadata} and {@link updateMarkdownDivisionMetadata} —
 * same `(division, changes) => Division` shape — but LaTeX has no
 * representation for PreTeXt's separate `label` attribute, so `label` is
 * accepted (to keep the same `changes` shape) and ignored.
 */
export function updateLatexDivisionMetadata(
  division: Division,
  changes: {
    title?: string;
    type?: DivisionType;
    xmlId?: string | null;
    label?: string | null;
  },
): Division {
  const header = parseLatexDivisionHeader(division.source);
  let source = division.source;
  if (header) {
    source = joinLatexHeaderAndBody(
      buildLatexDivisionHeader({
        macro: changes.type ?? header.macro,
        starred: header.starred,
        title: changes.title ?? header.title,
        label: changes.xmlId === undefined ? header.label : (changes.xmlId ?? ""),
      }),
      division.source.slice(header.length),
    );
  } else if (changes.title !== undefined) {
    source = updateLatexSectionTitle(source, changes.title);
  }
  return {
    ...division,
    source,
    title: changes.title ?? division.title,
    type: changes.type ?? division.type,
    xmlId: changes.xmlId || division.xmlId,
  };
}

/**
 * Convert a LaTeX division's source to PreTeXt by passing the visible LaTeX
 * straight to `@pretextbook/latex-pretext` and using its output as-is.
 *
 * A division's header (`\section{…}\label{…}`, `\worksheet{…}`, … — and, for a
 * root division, `\article{…}`/`\book{…}`/`\slideshow{…}`) converts to its own
 * complete `<type xml:id="…"><title>…>` element, so the conversion is used
 * exactly as produced with no extra wrapper added here — doing so would nest a
 * second `<article>`/`<book>`/`<slideshow>` around the one the converter
 * already emitted from the header. If a header doesn't convert correctly,
 * that surfaces here to be fixed in the converter rather than worked around.
 *
 * Returns `null` when the conversion fails, so callers can disable the convert
 * action / fall back.
 */
export function latexDivisionToTaggedPretext(
  division: Pick<Division, "source">,
): string | null {
  const { pretextSource, pretextError } = derivePretextContent(
    division.source,
    "latex",
  );
  if (pretextError || pretextSource === undefined) return null;
  return pretextSource;
}

/** Create a new blank LaTeX section as a `Division`. */
export function createNewLatexSection(title = "New Section"): DocumentSection {
  const id = generateId();
  return {
    id,
    xmlId: id,
    title,
    source: `\\section{${title}}\n\n`,
    type: "section",
    sourceFormat: "latex",
  };
}

/** Create a blank LaTeX introduction. */
export function createLatexIntroduction(): DocumentSection {
  const id = generateId();
  return {
    id,
    xmlId: id,
    title: "Introduction",
    source: "% Introduction\n\n",
    type: "introduction",
    sourceFormat: "latex",
  };
}

/** Create a blank LaTeX conclusion. */
export function createLatexConclusion(): DocumentSection {
  const id = generateId();
  return {
    id,
    xmlId: id,
    title: "Conclusion",
    source: "% Conclusion\n\n",
    type: "conclusion",
    sourceFormat: "latex",
  };
}

// ---------------------------------------------------------------------------
// Wrap-as-section and merge utilities
// ---------------------------------------------------------------------------


/**
 * Merge two adjacent sections into one, keeping the title of the first.
 *
 * - For PreTeXt: parses both sections and concatenates the body children
 *   (skipping the second section's `<title>`).
 * - For LaTeX: strips the second section's header and appends its body.
 *
 * @param a First (absorbing) section.
 * @param b Second section whose content is appended to `a`.
 * @param isLatex Whether the document source is LaTeX.
 */
export function mergeTwoSections(
  a: DocumentSection,
  b: DocumentSection,
  isLatex: boolean,
): DocumentSection {
  if (isLatex) {
    const bBody = stripLatexSectionWrapper(b.source, b.type);
    return {
      ...a,
      source: a.source.trimEnd() + "\n\n" + bBody.trimStart(),
    };
  }

  // PreTeXt: parse and combine xast children
  const aTree = safeFromXml(a.source);
  const bTree = safeFromXml(b.source);
  const aEl = aTree?.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  const bEl = bTree?.children.find((n) => n.type === "element") as
    | Element
    | undefined;

  if (!aEl || !bEl) {
    // Malformed XML in either section: fall back to plain concatenation.
    return { ...a, source: a.source + "\n\n" + b.source };
  }

  // Drop the second section's <title> element
  const bBodyChildren = bEl.children.filter(
    (c) => !(c.type === "element" && (c as Element).name === "title"),
  );
  const merged: Element = {
    ...aEl,
    children: [...aEl.children, ...bBodyChildren],
  };
  return {
    ...a,
    source: toXml({ type: "root", children: [merged] } as Root, XML_SERIALIZE_OPTIONS),
  };
}

// ---------------------------------------------------------------------------
// Section attribute utilities
// ---------------------------------------------------------------------------

/**
 * Extract `xml:id` and `label` attributes from the root element of a section
 * content string.  Returns empty strings when the attributes are absent.
 */
export function getSectionAttributes(content: string): {
  xmlId: string;
  label: string;
} {
  try {
    const tree: Root = fromXml(content);
    const el = tree.children.find((n) => n.type === "element") as
      | Element
      | undefined;
    if (!el) return { xmlId: "", label: "" };
    return {
      xmlId: (el.attributes?.["xml:id"] as string) ?? "",
      label: (el.attributes?.["label"] as string) ?? "",
    };
  } catch {
    return { xmlId: "", label: "" };
  }
}

/**
 * Coerce a user-entered string into a value usable as an XML `xml:id`
 * (an NCName).  Disallowed characters are replaced with `-`, and any leading
 * characters that can't start an NCName (digits, `-`, `.`) are stripped.
 *
 * Returns `""` when nothing valid remains — callers treat that as "reject"
 * since a division's `xml:id` is its identity and may not be empty.
 */
export function sanitizeXmlId(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/^[^A-Za-z_]+/, "");
}

/**
 * Derive a slug-style `xml:id` from a division's title — lowercased, with
 * whitespace/punctuation collapsed to single hyphens and trimmed from the
 * ends. Used to keep a brand-new, not-yet-saved division's id in sync with
 * its title as the author types, in place of the opaque generated id it
 * starts with.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitizeXmlId(slug);
}

/**
 * Derive a division's title, type, `xml:id`, and `label` directly from its
 * full PreTeXt source — the code editor's content, wrapper tag included.
 * Used to keep the TOC in sync when the user edits these directly in the
 * source rather than through the metadata dropdown form.
 *
 * Returns `null` when `content` isn't well-formed XML or its root element
 * isn't a recognised division tag (both common mid-edit), so callers can
 * skip the update rather than clobbering existing metadata with junk.
 */
export function extractDivisionMetadata(content: string): {
  title: string;
  type: DivisionType;
  xmlId: string;
  label: string;
} | null {
  const tree = safeFromXml(content);
  if (!tree) return null;
  const el = tree.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  if (!el || !ALL_DIVISION_TYPES.has(el.name)) return null;
  return {
    title: extractTitle(el),
    type: el.name as DivisionType,
    xmlId: (el.attributes?.["xml:id"] as string) ?? "",
    label: (el.attributes?.["label"] as string) ?? "",
  };
}

/**
 * Update the title, tag name (type), `xml:id`, and `label` of a section.
 *
 * Pass `null` for `xmlId` or `label` to remove the attribute entirely.
 * Omit a key (or pass `undefined`) to leave it unchanged.
 *
 * Returns a new `DocumentSection` with updated `source`, `title`, and `type`.
 */
export function updateSectionMetadata(
  section: DocumentSection,
  changes: {
    title?: string;
    type?: DocumentSectionType;
    xmlId?: string | null;
    label?: string | null;
  },
): DocumentSection {
  const newType = changes.type ?? section.type;
  const newTitle = changes.title ?? section.title;

  try {
    const tree: Root = fromXml(section.source);
    const el = tree.children.find((n) => n.type === "element") as
      | Element
      | undefined;

    if (!el) {
      // Fallback: return section with type/title updated but source unchanged.
      return { ...section, title: newTitle, type: newType };
    }

    // Update tag name (type).
    const newEl: Element = {
      ...el,
      name: newType,
      attributes: { ...el.attributes },
    };

    // Update xml:id attribute.
    if (changes.xmlId !== undefined) {
      if (changes.xmlId === null || changes.xmlId === "") {
        delete newEl.attributes["xml:id"];
      } else {
        newEl.attributes["xml:id"] = changes.xmlId;
      }
    }

    // Update label attribute.
    if (changes.label !== undefined) {
      if (changes.label === null || changes.label === "") {
        delete newEl.attributes["label"];
      } else {
        newEl.attributes["label"] = changes.label;
      }
    }

    // Update <title> child element.
    const titleIndex = newEl.children.findIndex(
      (c) => c.type === "element" && (c as Element).name === "title",
    );
    const titleNode: Element = {
      type: "element",
      name: "title",
      attributes: {},
      children: parseTitleChildren(newTitle),
    };
    if (titleIndex === -1) {
      newEl.children = [titleNode, ...newEl.children];
    } else {
      newEl.children = [
        ...newEl.children.slice(0, titleIndex),
        titleNode,
        ...newEl.children.slice(titleIndex + 1),
      ];
    }

    const newSource = toXml(
      { type: "root", children: [newEl] } as Root,
      XML_SERIALIZE_OPTIONS,
    );
    const newXmlId =
      changes.xmlId !== undefined && changes.xmlId !== null && changes.xmlId !== ""
        ? changes.xmlId
        : section.xmlId;
    return {
      ...section,
      title: newTitle,
      type: newType,
      xmlId: newXmlId,
      source: newSource,
    };
  } catch {
    return { ...section, title: newTitle, type: newType };
  }
}

/**
 * Update the `<title>`, `xml:id`, and `label` of a chapter XML string.
 *
 * Mirrors {@link updateSectionMetadata} but operates on a raw chapter source
 * string and never changes the element's tag name (a chapter is always a
 * chapter).  Pass `null`/empty for `xmlId` or `label` to remove the
 * attribute; omit a key (or pass `undefined`) to leave it unchanged.
 */
export function updateChapterMetadata(
  chapterXml: string,
  changes: {
    title?: string;
    xmlId?: string | null;
    label?: string | null;
  },
): string {
  try {
    const tree: Root = fromXml(chapterXml);
    const el = tree.children.find((n) => n.type === "element") as
      | Element
      | undefined;
    if (!el) return chapterXml;

    const newEl: Element = { ...el, attributes: { ...el.attributes } };

    if (changes.xmlId !== undefined) {
      if (changes.xmlId === null || changes.xmlId === "") {
        delete newEl.attributes["xml:id"];
      } else {
        newEl.attributes["xml:id"] = changes.xmlId;
      }
    }

    if (changes.label !== undefined) {
      if (changes.label === null || changes.label === "") {
        delete newEl.attributes["label"];
      } else {
        newEl.attributes["label"] = changes.label;
      }
    }

    if (changes.title !== undefined) {
      const titleIndex = newEl.children.findIndex(
        (c) => c.type === "element" && (c as Element).name === "title",
      );
      const titleNode: Element = {
        type: "element",
        name: "title",
        attributes: {},
        children: parseTitleChildren(changes.title),
      };
      if (titleIndex === -1) {
        newEl.children = [titleNode, ...newEl.children];
      } else {
        newEl.children = [
          ...newEl.children.slice(0, titleIndex),
          titleNode,
          ...newEl.children.slice(titleIndex + 1),
        ];
      }
    }

    return toXml({ type: "root", children: [newEl] } as Root, XML_SERIALIZE_OPTIONS);
  } catch {
    return chapterXml;
  }
}

// ---------------------------------------------------------------------------
// Markdown frontmatter utilities
// ---------------------------------------------------------------------------

/**
 * Markdown divisions are stored as real markdown files: a leading YAML
 * frontmatter block carrying the structural metadata followed by the markdown
 * body.  The frontmatter keys are `division` (the PreTeXt element type),
 * `id`, `label`, and `title`.  `@pretextbook/remark-pretext` turns the
 * whole file — frontmatter included — into the proper
 * `<type xml:id="..." label="..."><title>...</title>` element, so (unlike
 * PreTeXt divisions) the wrapper element never appears in storage.
 */

/** Matches a leading `---` ... `---` YAML frontmatter block. */
const MARKDOWN_FRONTMATTER_RE =
  /^\uFEFF?[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/;

/**
 * Strip surrounding quotes from a scalar YAML value, unescaping `\"` and `\\`
 * when the value was double-quoted. Not a general YAML parser — just enough
 * to round-trip what {@link buildMarkdownFrontmatter} writes.
 */
function unquoteYamlValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
}

/** Double-quote and escape a scalar value for use in a YAML frontmatter line. */
function quoteYamlValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Parse the leading frontmatter block of a markdown division into its
 * structural metadata and remaining body.  Returns `null` when no well-formed
 * frontmatter block is present (common mid-edit), so callers can skip rather
 * than clobber metadata with junk.
 */
export function parseMarkdownFrontmatter(content: string): {
  type: DivisionType;
  xmlId: string;
  label: string;
  title: string;
  body: string;
} | null {
  const match = MARKDOWN_FRONTMATTER_RE.exec(content);
  if (!match) return null;
  const body = content.slice(match[0].length);
  let type = "section";
  let xmlId = "";
  let label = "";
  let title = "";
  for (const rawLine of match[1].split(/\r?\n/)) {
    // `@pretextbook/remark-pretext` reads the id from an `id` key, but accepts
    // the older `xmlid` (a YAML key can't contain a colon) and `xml:id`
    // spellings too so divisions saved before each rename still parse.
    const kv = /^[ \t]*(id|xmlid|xml:id|division|label|title)[ \t]*:[ \t]*(.*)$/.exec(
      rawLine,
    );
    if (!kv) continue;
    const value = unquoteYamlValue(kv[2]);
    if (kv[1] === "division") type = value;
    else if (kv[1] === "id" || kv[1] === "xmlid" || kv[1] === "xml:id") xmlId = value;
    else if (kv[1] === "title") title = value;
    else label = value;
  }
  return { type: (type || "section") as DivisionType, xmlId, label, title, body };
}

/** Build a `---`-fenced frontmatter block for a markdown division. */
export function buildMarkdownFrontmatter(meta: {
  type: DivisionType;
  xmlId: string;
  label: string;
  title?: string;
}): string {
  const lines = [`division: ${meta.type}`, `id: ${meta.xmlId}`];
  if (meta.title) lines.push(`title: ${quoteYamlValue(meta.title)}`);
  if (meta.label) lines.push(`label: ${meta.label}`);
  return `---\n${lines.join("\n")}\n---`;
}

/**
 * Extract a markdown division's leading `# heading` text, or `null` if none.
 * Legacy fallback only — titles now live in frontmatter's `title` key; see
 * {@link extractMarkdownDivisionMetadata}. Kept so documents saved before the
 * frontmatter-title migration still show a real title instead of "Untitled".
 */
export function deriveMarkdownTitle(body: string): string | null {
  const m = /^[ \t]*#[ \t]+(.*)$/m.exec(body);
  return m ? m[1].trim() : null;
}

/**
 * Derive a markdown division's title, type, `xml:id`, and `label` directly from
 * its source — all from the frontmatter block. Markdown analogue of
 * {@link extractDivisionMetadata}; returns `null` when the frontmatter is
 * absent/malformed (both common mid-edit), so callers can skip the update
 * rather than clobber metadata. When the frontmatter carries no `title` (a
 * document predating the migration to a frontmatter title), falls back to the
 * body's leading `# heading`.
 */
export function extractMarkdownDivisionMetadata(content: string): {
  title: string;
  type: DivisionType;
  xmlId: string;
  label: string;
} | null {
  const parsed = parseMarkdownFrontmatter(content);
  if (!parsed) return null;
  return {
    title: parsed.title || deriveMarkdownTitle(parsed.body) || "",
    type: parsed.type,
    xmlId: parsed.xmlId,
    label: parsed.label,
  };
}

/**
 * Update the title, type (`division`), `xml:id`, and `label` of a markdown
 * division — all rewritten in the frontmatter block; the body is left
 * untouched. Markdown analogue of {@link updateSectionMetadata} (which is
 * XML-only and would wrongly inject a `<title>` element). Pass `null`/empty
 * for `label` to clear it; omit a key to leave it unchanged. The `xml:id` is
 * never cleared — it is the division's identity — so an empty value falls
 * back to the record's existing id.
 */
export function updateMarkdownDivisionMetadata(
  division: Division,
  changes: {
    title?: string;
    type?: DocumentSectionType;
    xmlId?: string | null;
    label?: string | null;
  },
): Division {
  const parsed = parseMarkdownFrontmatter(division.source);
  const body = parsed ? parsed.body : division.source;
  const curType = parsed?.type ?? division.type;
  const curXmlId = parsed?.xmlId ?? division.xmlId;
  const curLabel = parsed?.label ?? "";
  const curTitle = parsed?.title || division.title;

  const newType = (changes.type ?? curType) as DivisionType;
  const effectiveXmlId =
    (changes.xmlId === undefined ? curXmlId : changes.xmlId ?? "") ||
    division.xmlId;
  const newLabel = changes.label === undefined ? curLabel : changes.label ?? "";
  const newTitle = changes.title ?? curTitle;

  const source = `${buildMarkdownFrontmatter({
    type: newType,
    xmlId: effectiveXmlId,
    label: newLabel,
    title: newTitle,
  })}\n${body}`;

  return {
    ...division,
    title: newTitle,
    type: newType,
    xmlId: effectiveXmlId,
    source,
  };
}

const PRETEXT_HEADER_TAGS: ReadonlySet<string> = new Set(["title", "docinfo"]);

export function wrapDocumentAsSection(
  xml: string,
  sectionTitle = "Section 1",
): DocumentSplitResult {
  let normalized = xml.trim();
  if (normalized.startsWith("<?xml")) {
    const end = normalized.indexOf("?>");
    if (end !== -1) normalized = normalized.slice(end + 2).trim();
  }
  const tree = safeFromXml(`<__root__>${normalized}</__root__>`);
  const syntheticRoot = tree?.children.find((n) => n.type === "element") as
    | Element
    | undefined;
  if (!syntheticRoot) {
    return { wrapper: "", sections: [createNewSection(sectionTitle)] };
  }
  const elementChildren = syntheticRoot.children.filter(
    (n) => n.type === "element",
  ) as Element[];
  if (
    elementChildren.length === 1 &&
    DOCUMENT_ROOT_TAGS.has(elementChildren[0].name)
  ) {
    const docRoot = elementChildren[0];
    const wrapperChildren = docRoot.children.filter(
      (c) => c.type === "element" && PRETEXT_HEADER_TAGS.has((c as Element).name),
    );
    const bodyChildren = docRoot.children.filter(
      (c) => !(c.type === "element" && PRETEXT_HEADER_TAGS.has((c as Element).name)),
    );
    const titleEl: Element = {
      type: "element",
      name: "title",
      attributes: {},
      children: [{ type: "text", value: sectionTitle }],
    };
    const sectionEl: Element = {
      type: "element",
      name: "section",
      attributes: {},
      children: [titleEl, ...bodyChildren],
    };
    const newWrapper: Root = {
      type: "root",
      children: [{ ...docRoot, children: wrapperChildren } as Element],
    };
    const id = generateId();
    return {
      wrapper: toXml(newWrapper, XML_SERIALIZE_OPTIONS),
      sections: [{
        id,
        xmlId: id,
        title: sectionTitle,
        source: toXml({ type: "root", children: [sectionEl] } as Root, XML_SERIALIZE_OPTIONS),
        type: "section",
        sourceFormat: "pretext" as const,
      }],
    };
  }
  const id = generateId();
  return {
    wrapper: "",
    sections: [{
      id,
      xmlId: id,
      title: sectionTitle,
      source: `<section xml:id="${id}">\n\t<title>${sectionTitle}</title>\n\n${normalized}\n</section>`,
      type: "section",
      sourceFormat: "pretext" as const,
    }],
  };
}

export function wrapLatexDocumentAsSection(
  latex: string,
  sectionTitle = "Section 1",
): DocumentSplitResult {
  const { preamble, body, closing } = splitLatexPreamble(latex);
  const sectionSource = `\\section{${sectionTitle}}\n\n${body.trim()}\n\n`;
  const wrapper = preamble ? encodeLatexWrapper({ preamble, closing }) : "";
  const id = generateId();
  return {
    wrapper,
    sections: [{ id, xmlId: id, title: sectionTitle, source: sectionSource, type: "section", sourceFormat: "latex" }],
  };
}

// ---------------------------------------------------------------------------
// Division ref utilities — `<plus:* ref="..."/>` placeholder manipulation
// ---------------------------------------------------------------------------

/** Escape a string for safe literal use inside a `RegExp` constructor. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a division of the given source format can embed child division refs.
 *
 * PreTeXt uses `<plus:* ref="..."/>` placeholders directly; Markdown uses the
 * `::section{ref="..."}` leaf directive and LaTeX the `\plus{section}{ref}`
 * macro — both of which `@pretextbook/remark-pretext` / `@pretextbook/latex-pretext`
 * convert to the same placeholder. All three current formats can therefore
 * embed child refs; they are enumerated (rather than returning a bare `true`)
 * so a future format defaults to leaf-only and must opt in here explicitly,
 * and so the TOC's "Add new division" gating reads intentionally.
 */
export function canEmbedDivisionRefs(sourceFormat: SourceFormat): boolean {
  return (
    sourceFormat === "pretext" ||
    sourceFormat === "markdown" ||
    sourceFormat === "latex"
  );
}

/**
 * Tag names that may appear in a `<plus:TAG ref="..."/>` placeholder used to
 * position a `Division` within its parent's content — i.e. every
 * `DivisionType` plus the generic `division` alias.
 *
 * Asset placeholders (`<plus:image ref="..."/>`) share the same
 * `<plus:* ref="..."/>` shape but are NOT divisions — they reference project
 * assets and must be excluded here, otherwise asset refs
 * get parsed as division children, auto-created as bogus Division records,
 * and shown/orphaned in the TOC.
 */
const DIVISION_REF_TAGS: ReadonlySet<string> = new Set([
  "division",
  ...ALL_DIVISION_TYPES,
]);

const DIVISION_REF_TAG_ALTERNATION = Array.from(DIVISION_REF_TAGS).join("|");

/**
 * Regex source matching the PreTeXt (XML) form of a division-ref placeholder
 * in EITHER shape:
 *   - self-closing:     `<plus:section ref="x"/>`
 *   - expanded-empty:   `<plus:section ref="x"></plus:section>`
 *
 * The expanded form is what an XML round-trip (e.g. through xast in
 * `stripSectionWrapper`/`rewrapSection`) produces, so every consumer must
 * accept it as well as the canonical self-closing form a user might type.
 */
function xmlDivisionRefSource(refValue: string | null): string {
  const ref =
    refValue === null ? `ref="([^"]+)"` : `ref="${escapeRegex(refValue)}"`;
  const tag = `(?:${DIVISION_REF_TAG_ALTERNATION})`;
  return `<plus:${tag}\\s[^>]*${ref}[^>]*?(?:/>|>\\s*</plus:${tag}>)`;
}

/**
 * Regex source matching the Markdown form of a division-ref placeholder — the
 * leaf directive `::section{ref="x"}` that `@pretextbook/remark-pretext`
 * converts to `<plus:section ref="x"/>`.  An optional `[label]` between the
 * name and the attribute block is tolerated (`::section[Intro]{ref="x"}`).
 */
function markdownDivisionRefSource(refValue: string | null): string {
  const ref =
    refValue === null ? `ref="([^"]+)"` : `ref="${escapeRegex(refValue)}"`;
  const tag = `(?:${DIVISION_REF_TAG_ALTERNATION})`;
  return `::${tag}(?:\\[[^\\]]*\\])?\\{[^}]*${ref}[^}]*\\}`;
}

/**
 * Regex source matching the LaTeX form of a division-ref placeholder — the
 * `\plus{section}{x}` macro that `@pretextbook/latex-pretext` converts to
 * `<plus:section ref="x"/>`.  The first brace group is the tag name, the
 * second the referenced `xml:id`.
 */
function latexDivisionRefSource(refValue: string | null): string {
  const ref = refValue === null ? `([^}]+)` : escapeRegex(refValue);
  const tag = `(?:${DIVISION_REF_TAG_ALTERNATION})`;
  return `\\\\plus\\{${tag}\\}\\{${ref}\\}`;
}

/**
 * Return the regex source for a division-ref placeholder written in the ONE
 * syntax that a division of `format` actually uses:
 *   - `pretext`  → `<plus:section ref="x"/>`
 *   - `markdown` → `::section{ref="x"}`
 *   - `latex`    → `\plus{section}{x}`
 *
 * Scanning is deliberately restricted to the holder's own format: there is no
 * all-formats-at-once variant, because every consumer knows the format of the
 * division whose source it is looking at, and a combined pattern silently
 * turns a `\plus{section}{x}` typed into a PreTeXt division (as literal
 * example text, or by a LaTeX author pasting into the wrong pane) into a real
 * include — the false match that was producing spurious blank sections, and
 * that made a stray macro copy inside a child look like its own parent.
 *
 * Only matches tag names in {@link DIVISION_REF_TAGS} — the asset placeholder
 * (`plus:image`) is deliberately excluded.
 *
 * When `refValue` is `null` the ref value is captured in group 1; otherwise the
 * pattern matches only that specific ref and captures nothing.
 */
function divisionRefSourceForFormat(
  format: SourceFormat,
  refValue: string | null,
): string {
  switch (format) {
    case "pretext":
      return xmlDivisionRefSource(refValue);
    case "markdown":
      return markdownDivisionRefSource(refValue);
    case "latex":
      return latexDivisionRefSource(refValue);
  }
}

/**
 * Regex sources matching *verbatim* spans in each source format — regions whose
 * text is rendered literally and must never be scanned for include placeholders.
 * An include shown as documentation inside a Markdown code fence
 * (```` ```\n::section{ref="x"}\n``` ````) or a PreTeXt `<pre>` is an example,
 * not a real child, so it is blanked out before ref-scanning (see
 * {@link blankVerbatim}).
 *
 * Each entry is an un-anchored source with NO capturing groups (so the
 * alternatives can be safely `|`-joined). Ordering matters: list block-level
 * spans (fences, environments) before inline spans so the larger region is
 * consumed first.
 */
const VERBATIM_SOURCES: Record<SourceFormat, string[]> = {
  // PreTeXt elements whose contents are rendered literally, so a `<plus:… ref>`
  // typed inside one (as a code sample / documentation) is an example, not a
  // real include. `<program>`, `<console>` and `<sage>` also enclose the
  // nested `<input>`/`<output>` verbatim blocks, so listing those separately
  // is unnecessary. Each opening tag tolerates attributes (e.g. `<program
  // language="python">`) via `(?:\s[^>]*)?`.
  pretext: [
    "pre",
    "c", // inline code
    "cd", // code display
    "program",
    "console",
    "sage",
    "latex-image",
    "sageplot",
    "asymptote",
  ].map((tag) => `<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`),
  markdown: [
    "```[\\s\\S]*?```", // fenced code block (backticks)
    "~~~[\\s\\S]*?~~~", // fenced code block (tildes)
    "`[^`\\n]*`", // inline code span
  ],
  latex: [
    "\\\\begin\\{verbatim\\}[\\s\\S]*?\\\\end\\{verbatim\\}",
    "\\\\begin\\{lstlisting\\}[\\s\\S]*?\\\\end\\{lstlisting\\}",
    "\\\\verb\\*?\\|[^|\\n]*\\|", // \verb|...| (pipe delimiter, the common case)
  ],
};

/**
 * Replace every verbatim span (per {@link VERBATIM_SOURCES} for `sourceFormat`)
 * with equal-length whitespace, preserving newlines. Blanking rather than
 * deleting keeps character offsets and document order intact for the caller's
 * subsequent ref scan, and guarantees no placeholder can straddle a blanked
 * boundary.
 */
function blankVerbatim(content: string, sourceFormat: SourceFormat): string {
  const sources = VERBATIM_SOURCES[sourceFormat];
  if (sources.length === 0) return content;
  const re = new RegExp(sources.join("|"), "g");
  return content.replace(re, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Return the ordered list of `xmlId` values referenced by
 * `<plus:* ref="..."/>` placeholders found in `content`.
 *
 * Only direct children are returned — the function does not recurse.
 * Call it for each division in the pool to build the full tree.
 *
 * `sourceFormat` is the parent division's format: only that format's include
 * syntax is scanned, and its verbatim spans are blanked first, so example
 * placeholders in code samples don't become phantom children.
 */
export function parseDivisionRefs(
  content: string,
  sourceFormat: SourceFormat,
): string[] {
  const refs: string[] = [];
  const re = new RegExp(divisionRefSourceForFormat(sourceFormat, null), "g");
  const scanned = blankVerbatim(content, sourceFormat);
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    // The per-format source has a single capture group: the ref value.
    refs.push(m[1]);
  }
  return refs;
}

/** A division ref together with the type its tag name names. */
export interface DivisionRefWithType {
  xmlId: string;
  /** The division type the placeholder's tag names. */
  type: DivisionType;
  /**
   * `true` when the placeholder used the generic `division` alias rather than
   * naming a type, so `type` is the `"section"` fallback rather than something
   * the author actually wrote.
   *
   * Callers that *create* a division from a ref can ignore this — they need
   * some concrete type and `"section"` is the documented default. Callers that
   * push the tag name onto an *existing* division must not: retyping a
   * `worksheet` to `section` because someone wrote `<plus:division ref="…"/>`
   * would silently destroy a type the author chose elsewhere.
   */
  generic: boolean;
}

/**
 * Like {@link parseDivisionRefs} but also returns the division type inferred
 * from the tag name (e.g. `<plus:chapter ref="x"/>` → `{ type: "chapter", xmlId: "x" }`).
 * Used to auto-create Division records when new refs appear in edited content,
 * and to push a retyped placeholder onto the division it points at.
 *
 * Only tag names in {@link DIVISION_REF_TAGS} are considered — the asset
 * placeholder (`plus:image`) is not a division and is skipped. The generic
 * `<plus:division ref="x"/>` alias falls back to type
 * `"section"`, matching {@link tagToType}'s default for unrecognised tags, and
 * is flagged `generic` so callers can tell the fallback from a real choice.
 */
export function parseDivisionRefsWithTypes(
  content: string,
  sourceFormat: SourceFormat,
): DivisionRefWithType[] {
  const refs: DivisionRefWithType[] = [];
  const tags = DIVISION_REF_TAG_ALTERNATION;
  const closeTag = `(?:${tags})`;
  // One alternative per format, each capturing tag in group 1 and ref in
  // group 2, so only the parent's own include syntax is recognised.
  const source: Record<SourceFormat, string> = {
    pretext: `<plus:(${tags})\\s[^>]*ref="([^"]+)"[^>]*?(?:/>|>\\s*</plus:${closeTag}>)`,
    markdown: `::(${tags})(?:\\[[^\\]]*\\])?\\{[^}]*ref="([^"]+)"[^}]*\\}`,
    latex: `\\\\plus\\{(${tags})\\}\\{([^}]+)\\}`,
  };
  const re = new RegExp(source[sourceFormat], "g");
  const scanned = blankVerbatim(content, sourceFormat);
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    const tagName = m[1];
    const xmlId = m[2];
    const generic = tagName === "division";
    const type: DivisionType = generic ? "section" : (tagName as DivisionType);
    refs.push({ type, xmlId, generic });
  }
  return refs;
}

/**
 * Locate every division-ref placeholder for `xmlId` in `content`, returning the
 * `[index, length)` span of each within `content` itself.
 *
 * The scan runs against a {@link blankVerbatim} copy of `content` and only in
 * `sourceFormat`'s own include syntax, so it agrees exactly with
 * {@link parseDivisionRefs} about what counts as a real include. Blanking
 * preserves length, so offsets found in the blanked copy index the original
 * unchanged — which is what lets the rewrite helpers below edit the real text
 * while still ignoring examples inside verbatim spans.
 */
function locateDivisionRefs(
  content: string,
  xmlId: string,
  sourceFormat: SourceFormat,
): { index: number; length: number }[] {
  const re = new RegExp(divisionRefSourceForFormat(sourceFormat, xmlId), "g");
  const scanned = blankVerbatim(content, sourceFormat);
  const spans: { index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    spans.push({ index: m.index, length: m[0].length });
  }
  return spans;
}


// ---------------------------------------------------------------------------
// Asset ref utilities — `<plus:image ref="..."/>` placeholder parsing
// ---------------------------------------------------------------------------

/** A `<plus:image ref="..."/>` asset placeholder. */
export interface AssetRef {
  ref: string;
}

/**
 * Parse every asset placeholder out of `content`, in document order, without
 * de-duplicating.  The PreTeXt form (`<plus:image ref="..."/>`), the Markdown
 * leaf-directive form (`::image{ref="..."}`) and the LaTeX macro form
 * (`\plus{image}{...}`) are all matched — the latter two are what
 * `@pretextbook/remark-pretext` / `@pretextbook/latex-pretext` convert to the
 * same placeholder.
 *
 * Asset placeholders share the same shape as division refs (see
 * {@link DIVISION_REF_TAGS}) but are deliberately parsed by a separate,
 * disjoint tag (`image`) so the two kinds of include are never conflated.
 */
export function parseAssetRefs(
  content: string,
  sourceFormat: SourceFormat,
): AssetRef[] {
  const refs: AssetRef[] = [];
  // One alternative per format, capturing the ref in group 1, so only the
  // division's own asset-include syntax is recognised and example
  // placeholders in verbatim spans are ignored.
  const source: Record<SourceFormat, string> = {
    pretext: `<plus:image\\b[^>]*\\bref="([^"]+)"`,
    markdown: `::image(?:\\[[^\\]]*\\])?\\{[^}]*\\bref="([^"]+)"[^}]*\\}`,
    latex: `\\\\plus\\{image\\}\\{([^}]+)\\}`,
  };
  const re = new RegExp(source[sourceFormat], "g");
  const scanned = blankVerbatim(content, sourceFormat);
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    refs.push({ ref: m[1] });
  }
  return refs;
}

/**
 * Rewrite every asset placeholder for `oldRef` in `content` to use `newRef`
 * instead, leaving any other attributes (e.g. `width="50%"`) untouched. The
 * PreTeXt (`<plus:image ref="..."/>`), Markdown (`::image{ref="..."}`) and
 * LaTeX (`\plus{image}{...}`) forms are all rewritten in place. Used when an
 * asset's `ref` is renamed, or when an unresolved placeholder is linked to an
 * existing asset whose ref differs — so the source stays in sync with the
 * project-asset pool across every division.
 */
export function renameAssetRef(
  content: string,
  oldRef: string,
  newRef: string,
): string {
  const oldR = escapeRegex(oldRef);
  // Match the placeholder opening and the specific ref separately so other
  // attributes between/around them are preserved verbatim. The three forms are
  // textually disjoint, so replacing each in turn never double-applies.
  const xmlRe = new RegExp(`(<plus:image\\b[^>]*?\\bref=")${oldR}(")`, "g");
  const mdRe = new RegExp(
    `(::image(?:\\[[^\\]]*\\])?\\{[^}]*?\\bref=")${oldR}(")`,
    "g",
  );
  const latexRe = new RegExp(`(\\\\plus\\{image\\}\\{)${oldR}(\\})`, "g");
  return content
    .replace(xmlRe, `$1${newRef}$2`)
    .replace(mdRe, `$1${newRef}$2`)
    .replace(latexRe, `$1${newRef}$2`);
}

/**
 * Remove every asset placeholder for `ref` from `content`, in the PreTeXt
 * (`<plus:image ref="..."/>`), Markdown (`::image{ref="..."}`) or LaTeX
 * (`\plus{image}{...}`) form. Used when removing an unresolved placeholder
 * (one with no backing asset) directly from the source.
 */
export function removeAssetRef(content: string, ref: string): string {
  const r = escapeRegex(ref);
  const xmlRe = new RegExp(`<plus:image\\b[^>]*?\\bref="${r}"[^>]*/?>`, "g");
  const mdRe = new RegExp(
    `::image(?:\\[[^\\]]*\\])?\\{[^}]*?\\bref="${r}"[^}]*\\}`,
    "g",
  );
  const latexRe = new RegExp(`\\\\plus\\{image\\}\\{${r}\\}`, "g");
  return content.replace(xmlRe, "").replace(mdRe, "").replace(latexRe, "");
}

/**
 * Build the embed code a user copies (or types) to place an asset placeholder,
 * matched to the target division's source format. A Markdown division needs the
 * leaf-directive form `::image{ref="x"}` and a LaTeX division the macro form
 * `\plus{image}{x}` — raw `<plus:image .../>` XML pasted into either does NOT
 * survive conversion (it is escaped as literal text). PreTeXt gets the
 * canonical `<plus:image ref="x"/>` form.
 */
export function assetEmbedCode(
  ref: string,
  sourceFormat: SourceFormat = "pretext",
): string {
  if (sourceFormat === "markdown") return `::image{ref="${ref}"}`;
  if (sourceFormat === "latex") return `\\plus{image}{${ref}}`;
  return `<plus:image ref="${ref}"/>`;
}

// ---------------------------------------------------------------------------
// Snippet ref utilities — `<plus:snippet ref="..."/>` placeholder parsing
// ---------------------------------------------------------------------------

/** A `<plus:snippet ref="..."/>` snippet placeholder. */
export interface SnippetRef {
  ref: string;
}

/**
 * Parse every snippet placeholder out of `content`, in document order, without
 * de-duplicating (a snippet ref may legitimately appear more than once). The
 * PreTeXt form (`<plus:snippet ref="..."/>`), the Markdown leaf-directive form
 * (`::snippet{ref="..."}`) and the LaTeX macro form (`\plus{snippet}{...}`)
 * are all matched.
 *
 * Snippet placeholders share the same shape as division/asset refs (see
 * {@link DIVISION_REF_TAGS}) but are deliberately parsed by a separate,
 * disjoint tag (`snippet`) so the three kinds of include are never conflated.
 */
export function parseSnippetRefs(
  content: string,
  sourceFormat: SourceFormat,
): SnippetRef[] {
  const refs: SnippetRef[] = [];
  const source: Record<SourceFormat, string> = {
    pretext: `<plus:snippet\\b[^>]*\\bref="([^"]+)"`,
    markdown: `::snippet(?:\\[[^\\]]*\\])?\\{[^}]*\\bref="([^"]+)"[^}]*\\}`,
    latex: `\\\\plus\\{snippet\\}\\{([^}]+)\\}`,
  };
  const re = new RegExp(source[sourceFormat], "g");
  const scanned = blankVerbatim(content, sourceFormat);
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    refs.push({ ref: m[1] });
  }
  return refs;
}

/**
 * Rewrite every snippet placeholder for `oldRef` in `content` to use `newRef`
 * instead, leaving any other attributes untouched. The PreTeXt
 * (`<plus:snippet ref="..."/>`), Markdown (`::snippet{ref="..."}`) and LaTeX
 * (`\plus{snippet}{...}`) forms are all rewritten in place. Used when a
 * snippet's `ref` is renamed, so the source stays in sync with the
 * project-snippet pool across every division.
 */
export function renameSnippetRef(
  content: string,
  oldRef: string,
  newRef: string,
): string {
  const oldR = escapeRegex(oldRef);
  const xmlRe = new RegExp(`(<plus:snippet\\b[^>]*?\\bref=")${oldR}(")`, "g");
  const mdRe = new RegExp(
    `(::snippet(?:\\[[^\\]]*\\])?\\{[^}]*?\\bref=")${oldR}(")`,
    "g",
  );
  const latexRe = new RegExp(`(\\\\plus\\{snippet\\}\\{)${oldR}(\\})`, "g");
  return content
    .replace(xmlRe, `$1${newRef}$2`)
    .replace(mdRe, `$1${newRef}$2`)
    .replace(latexRe, `$1${newRef}$2`);
}

/**
 * Remove every snippet placeholder for `ref` from `content`, in the PreTeXt
 * (`<plus:snippet ref="..."/>`), Markdown (`::snippet{ref="..."}`) or LaTeX
 * (`\plus{snippet}{...}`) form. Used when removing an unresolved placeholder
 * (one with no backing snippet) directly from the source.
 */
export function removeSnippetRef(content: string, ref: string): string {
  const r = escapeRegex(ref);
  const xmlRe = new RegExp(`<plus:snippet\\b[^>]*?\\bref="${r}"[^>]*/?>`, "g");
  const mdRe = new RegExp(
    `::snippet(?:\\[[^\\]]*\\])?\\{[^}]*?\\bref="${r}"[^}]*\\}`,
    "g",
  );
  const latexRe = new RegExp(`\\\\plus\\{snippet\\}\\{${r}\\}`, "g");
  return content.replace(xmlRe, "").replace(mdRe, "").replace(latexRe, "");
}

/**
 * Build the embed code a user copies (or types) to place a snippet
 * placeholder, matched to the target division's source format. Mirrors
 * {@link assetEmbedCode}.
 */
export function snippetEmbedCode(
  ref: string,
  sourceFormat: SourceFormat = "pretext",
): string {
  if (sourceFormat === "markdown") return `::snippet{ref="${ref}"}`;
  if (sourceFormat === "latex") return `\\plus{snippet}{${ref}}`;
  return `<plus:snippet ref="${ref}"/>`;
}

/**
 * Create a minimal Division record for a given `xmlId` and `type`.
 * Used when the user types a new `<plus:TYPE ref="id"/>` placeholder into a
 * division's content and no matching Division exists in the pool yet.
 */
export function createDivisionWithId(
  xmlId: string,
  type: DivisionType,
  sourceFormat: SourceFormat = "pretext",
): Division {
  const tag = type.charAt(0).toUpperCase() + type.slice(1);
  const title = `New ${tag}`;
  const source = createDivisionContent(type, sourceFormat, title, xmlId);
  return { id: xmlId, xmlId, title, type, sourceFormat, source };
}

/**
 * Create blank content for a division of the given type and source format.
 * Used when adding a new division — the format is chosen via the TOC's
 * properties form before the division is first saved, so unlike editing an
 * existing division there's no prior source to translate: switching format
 * just starts over from this format's template.
 */
export function createDivisionContent(
  type: DivisionType,
  sourceFormat: SourceFormat,
  title: string,
  xmlId: string,
): string {
  if (sourceFormat === "latex") {
    if (type === "introduction" || type === "conclusion") return `% ${title}\n\n`;
    // Emit the `\label{…}` (LaTeX's spelling of `xml:id`) immediately after the
    // header, matching updateLatexDivisionMetadata, so a freshly created
    // division already carries its id rather than only gaining it on first edit.
    return `${buildLatexDivisionHeader({ macro: type, title, label: xmlId })}\n\n`;
  }
  if (sourceFormat === "markdown") {
    return `${buildMarkdownFrontmatter({ type, xmlId, label: "", title })}\n\n`;
  }
  if (type === "introduction" || type === "conclusion") {
    return `<${type} xml:id="${xmlId}">\n\n\t<p>\n\n\t</p>\n\n</${type}>`;
  }
  return `<${type} xml:id="${xmlId}">\n\t<title>${title}</title>\n\n\t<p>\n\n\t</p>\n\n</${type}>`;
}

/**
 * Render a division-ref placeholder in `sourceFormat`'s own include syntax: a
 * Markdown holder stores its includes as `::type{ref="x"}` leaf directives, a
 * LaTeX holder as `\plus{type}{x}` macros, and a PreTeXt holder as the
 * canonical `<plus:type ref="x"/>` placeholder.
 *
 * Exported because the TOC emits the same three shapes when inserting a ref at
 * the cursor, and the two spellings must not be able to drift apart.
 *
 * `type` accepts the generic `"division"` alias as well as a real
 * {@link DivisionType}, for the fallback placeholder `moveDivisionRef` writes
 * when the ref it was asked to move isn't present.
 */
export function divisionRefTag(
  type: DivisionType | "division",
  xmlId: string,
  sourceFormat: SourceFormat,
): string {
  switch (sourceFormat) {
    case "markdown":
      return `::${type}{ref="${xmlId}"}`;
    case "latex":
      return `\\plus{${type}}{${xmlId}}`;
    case "pretext":
      return `<plus:${type} ref="${xmlId}"/>`;
  }
}

/**
 * Insert a `<plus:TYPE ref="xmlId"/>` placeholder into `content`, written in
 * `sourceFormat`'s own include syntax.
 *
 * - When `afterXmlId` is `null` the ref is appended just before the closing
 *   tag of the outer element (or at the end of the string if none is found).
 * - When `afterXmlId` is provided the new ref is inserted immediately after
 *   that ref's placeholder.  If the named ref is not found, falls back to
 *   appending.
 */
export function insertDivisionRef(
  content: string,
  xmlId: string,
  type: DivisionType,
  afterXmlId: string | null,
  sourceFormat: SourceFormat = "pretext",
): string {
  const tag = divisionRefTag(type, xmlId, sourceFormat);

  if (afterXmlId !== null) {
    const [anchor] = locateDivisionRefs(content, afterXmlId, sourceFormat);
    if (anchor) {
      const pos = anchor.index + anchor.length;
      return content.slice(0, pos) + "\n" + tag + content.slice(pos);
    }
  }

  // Append before the last closing tag, otherwise at end.
  const lastClose = content.lastIndexOf("</");
  if (lastClose !== -1) {
    return content.slice(0, lastClose) + tag + "\n" + content.slice(lastClose);
  }
  return content + "\n" + tag;
}

/**
 * Remove the `<plus:* ref="xmlId"/>` placeholder for `xmlId` from `content`.
 * The surrounding horizontal whitespace and trailing newline are swallowed too
 * so the result stays tidy.
 *
 * Only placeholders written in `sourceFormat`'s own syntax and outside verbatim
 * spans are removed, so unplacing a division cannot silently mangle a code
 * sample that happens to show the same include (see {@link locateDivisionRefs}).
 * The whitespace either side is trimmed from the *original* text rather than
 * the blanked scan copy, so a placeholder sitting immediately after a verbatim
 * span (`\verb|x|\plus{section}{a}`) takes only its own characters with it.
 */
export function removeDivisionRef(
  content: string,
  xmlId: string,
  sourceFormat: SourceFormat = "pretext",
): string {
  const spans = locateDivisionRefs(content, xmlId, sourceFormat);
  if (spans.length === 0) return content;

  const isBlank = (ch: string | undefined) => ch === " " || ch === "\t";
  let out = "";
  let cursor = 0;
  for (const { index, length } of spans) {
    let start = index;
    while (start > cursor && isBlank(content[start - 1])) start--;
    let end = index + length;
    while (end < content.length && isBlank(content[end])) end++;
    if (content[end] === "\n") end++;
    out += content.slice(cursor, start);
    cursor = end;
  }
  return out + content.slice(cursor);
}

/**
 * Move an existing `<plus:* ref="xmlId"/>` placeholder to a new position.
 *
 * Equivalent to `removeDivisionRef` followed by `insertDivisionRef`, but
 * preserves the original tag's element name (e.g. `plus:section` stays
 * `plus:section` rather than being normalised to `plus:division`).
 *
 * - `afterXmlId === null` moves the ref to the end (before the closing tag).
 * - `afterXmlId` moves it immediately after that ref.
 */
export function moveDivisionRef(
  content: string,
  xmlId: string,
  afterXmlId: string | null,
  sourceFormat: SourceFormat = "pretext",
): string {
  // Capture the original tag so we preserve its element name.
  const [span] = locateDivisionRefs(content, xmlId, sourceFormat);
  const originalTag = span
    ? content.slice(span.index, span.index + span.length)
    : divisionRefTag("division", xmlId, sourceFormat);

  const withoutRef = removeDivisionRef(content, xmlId, sourceFormat);

  if (afterXmlId !== null) {
    const [anchor] = locateDivisionRefs(withoutRef, afterXmlId, sourceFormat);
    if (anchor) {
      const pos = anchor.index + anchor.length;
      return (
        withoutRef.slice(0, pos) + "\n" + originalTag + withoutRef.slice(pos)
      );
    }
  }

  const lastClose = withoutRef.lastIndexOf("</");
  if (lastClose !== -1) {
    return (
      withoutRef.slice(0, lastClose) +
      originalTag +
      "\n" +
      withoutRef.slice(lastClose)
    );
  }
  return withoutRef + "\n" + originalTag;
}

/**
 * Rename an existing `<plus:* ref="oldXmlId"/>` placeholder in-place to point
 * at `newXmlId`, also updating the `*` tag name to `newType` if it changed.
 * Unlike {@link moveDivisionRef}, the placeholder's position is left
 * untouched — only its `ref` value and element name are rewritten.
 *
 * Used to keep a parent division's child placeholder in sync when the
 * child's own `xml:id`/type are edited directly in its source, so the
 * rename doesn't orphan the child from its parent.
 *
 * Every placeholder for `oldXmlId` is rewritten, not just the first: after an
 * id rename a missed one would dangle, and a duplicate include is already
 * malformed enough without leaving half of it pointing at the old type. The
 * rewrite is emitted in `sourceFormat`'s own syntax, and placeholders inside
 * verbatim spans are left alone.
 *
 * Returns `content` unchanged if no placeholder for `oldXmlId` is found.
 */
export function renameDivisionRef(
  content: string,
  oldXmlId: string,
  newXmlId: string,
  newType: DivisionType,
  sourceFormat: SourceFormat = "pretext",
): string {
  const spans = locateDivisionRefs(content, oldXmlId, sourceFormat);
  if (spans.length === 0) return content;

  const tag = divisionRefTag(newType, newXmlId, sourceFormat);
  let out = "";
  let cursor = 0;
  for (const { index, length } of spans) {
    out += content.slice(cursor, index) + tag;
    cursor = index + length;
  }
  return out + content.slice(cursor);
}

/**
 * Find the division in `divisions` whose content contains a
 * `<plus:* ref="xmlId"/>` placeholder for `xmlId` — i.e. `xmlId`'s parent in
 * the division tree.  Returns `null` if `xmlId` is unplaced (orphaned) or is
 * the root.
 *
 * Membership is decided by {@link parseDivisionRefs}, so this agrees exactly
 * with the TOC tree about who a division's parent is. Two consequences are
 * deliberate and load-bearing: a division is never its own parent (a stray
 * `\plus{handout}{self}` pasted into a child's body is malformed, not a
 * placement), and a division that only *mentions* the placeholder — inside a
 * verbatim span, or in another format's syntax — is not a parent either.
 * Without both, a ref-sync write could land on the wrong division's source.
 */
export function findDivisionParent(
  divisions: Division[],
  xmlId: string,
): Division | null {
  return (
    divisions.find(
      (d) =>
        d.xmlId !== xmlId &&
        parseDivisionRefs(d.source, d.sourceFormat).includes(xmlId),
    ) ?? null
  );
}

/**
 * Rewrite `content` so its `<plus:* ref="..."/>` placeholders appear in the
 * order given by `orderedXmlIds`.
 *
 * Implemented by repeatedly moving each ref to sit immediately after its
 * predecessor in the desired order; because every referenced child is moved,
 * the final relative order of the whole group matches `orderedXmlIds` exactly
 * while non-ref content keeps its position.  Original tag element names are
 * preserved (via `moveDivisionRef`).
 */
export function reorderDivisionRefs(
  content: string,
  orderedXmlIds: string[],
  sourceFormat: SourceFormat = "pretext",
): string {
  let result = content;
  let prev: string | null = null;
  for (const xmlId of orderedXmlIds) {
    result = moveDivisionRef(result, xmlId, prev, sourceFormat);
    prev = xmlId;
  }
  return result;
}

/**
 * Build a reachability set starting from `rootXmlId` by following
 * `<plus:* ref="..."/>` placeholders recursively through the `divisions` pool.
 *
 * Returns a `Set<string>` of all `xmlId` values reachable from the root,
 * including the root itself.  Used to identify orphaned divisions.
 */
function collectReachable(divisions: Division[], rootXmlId: string): Set<string> {
  const seen = new Set<string>();
  const queue = [rootXmlId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const div = divisions.find((d) => d.xmlId === id);
    if (div) {
      for (const ref of parseDivisionRefs(div.source, div.sourceFormat)) {
        queue.push(ref);
      }
    }
  }
  return seen;
}

/**
 * Return all divisions in `divisions` that are not reachable from
 * `rootXmlId` (and are not the root itself).
 *
 * Orphaned divisions are shown separately in the TOC so they can be placed
 * inside a parent division.
 */
export function getOrphanedDivisions(
  divisions: Division[],
  rootXmlId: string,
): Division[] {
  const reachable = collectReachable(divisions, rootXmlId);
  return divisions.filter((d) => !reachable.has(d.xmlId));
}

/** A division flattened into a depth-first list, annotated for tree rendering. */
export interface DivisionTreeNode {
  division: Division;
  /** Nesting depth: direct children of the start division are depth 0. */
  depth: number;
  /** `xmlId` of the division that references this one. */
  parentXmlId: string;
}

/**
 * Walk the division hierarchy starting from `startXmlId` (exclusive) and return
 * a depth-first–ordered flat list of descendant nodes, each annotated with its
 * `depth` and `parentXmlId`.
 *
 * The start division itself is not included.  Cycles and missing refs are
 * skipped defensively.  Rendering the result as a single list with
 * depth-based indentation reproduces the tree visually while keeping a flat
 * structure that a single dnd `SortableContext` can operate over.
 */
export function buildDivisionTree(
  divisions: Division[],
  startXmlId: string,
): DivisionTreeNode[] {
  const out: DivisionTreeNode[] = [];
  const visited = new Set<string>([startXmlId]);
  const walk = (parentXmlId: string, depth: number) => {
    const parent = divisions.find((d) => d.xmlId === parentXmlId);
    if (!parent) return;
    for (const ref of parseDivisionRefs(parent.source, parent.sourceFormat)) {
      if (visited.has(ref)) continue;
      const div = divisions.find((d) => d.xmlId === ref);
      if (!div) continue;
      visited.add(ref);
      out.push({ division: div, depth, parentXmlId });
      walk(ref, depth + 1);
    }
  };
  walk(startXmlId, 0);
  return out;
}

/**
 * Return the "roots" of the orphaned (unreachable) divisions: orphans that are
 * not referenced by any other orphan.  Each orphan root heads its own dangling
 * subtree, so the TOC can render unplaced material as trees rather than a flat
 * jumble of every disconnected descendant.
 */
export function getOrphanRoots(
  divisions: Division[],
  rootXmlId: string,
): Division[] {
  const orphans = getOrphanedDivisions(divisions, rootXmlId);
  const orphanIds = new Set(orphans.map((d) => d.xmlId));
  const referenced = new Set<string>();
  for (const o of orphans) {
    for (const ref of parseDivisionRefs(o.source, o.sourceFormat)) {
      if (orphanIds.has(ref)) referenced.add(ref);
    }
  }
  return orphans.filter((d) => !referenced.has(d.xmlId));
}

// ---------------------------------------------------------------------------
// Full project source assembly
// ---------------------------------------------------------------------------


/** Root division types — already a valid top-level PreTeXt element on their own. */
const ROOT_DIVISION_TYPES: ReadonlySet<DivisionType> = new Set<RootDivisionType>([
  "book",
  "article",
  "slideshow",
]);

/**
 * Narrow an arbitrary value to a {@link RootDivisionType}. Exists because the
 * root type arrives from the *host*, which may be untyped JavaScript (the Rails
 * app hands it over as a JSON string), so an unknown value has to fall back
 * rather than be trusted into a template.
 */
export function isRootDivisionType(value: unknown): value is RootDivisionType {
  return (
    typeof value === "string" && ROOT_DIVISION_TYPES.has(value as DivisionType)
  );
}

/**
 * The index just past a start/end tag beginning at `open`, or -1 if it never
 * closes. Quoted attribute values are skipped, since an unescaped `>` is legal
 * inside one and `indexOf(">")` would stop short.
 */
function tagEnd(xml: string, open: number): number {
  let quote = "";
  for (let i = open + 1; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i + 1;
    }
  }
  return -1;
}

/** Start of the next markup construct at or after `from`, skipping text. */
const TAG_NAME_RE = /^<\/?([A-Za-z_][A-Za-z0-9_.:-]*)/;

interface StartTag {
  name: string;
  /** Index of the `<`. */
  open: number;
  /** Index just past the `>`. */
  close: number;
  /** True for `<foo/>`, which has no matching end tag. */
  selfClosing: boolean;
  /** True for `</foo>`. */
  closing: boolean;
}

/**
 * The next tag at or after `from`, with comments, CDATA, processing
 * instructions and the doctype skipped rather than reported. Returns
 * `undefined` at end of input.
 */
function nextTag(xml: string, from: number): StartTag | undefined {
  let i = from;
  while (i < xml.length) {
    const open = xml.indexOf("<", i);
    if (open === -1) return undefined;
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end === -1) return undefined;
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      if (end === -1) return undefined;
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", open) || xml.startsWith("<!", open)) {
      const end = tagEnd(xml, open);
      if (end === -1) return undefined;
      i = end;
      continue;
    }
    const name = TAG_NAME_RE.exec(xml.slice(open, open + 128))?.[1];
    const close = tagEnd(xml, open);
    if (!name || close === -1) return undefined;
    return {
      name,
      open,
      close,
      selfClosing: xml[close - 2] === "/",
      closing: xml[open + 1] === "/",
    };
  }
  return undefined;
}

/**
 * Locate the root division element's start tag — `<book>`, `<article>` or
 * `<slideshow>` — as either the document's own first element or the first such
 * child of a `<pretext>` wrapper (`<docinfo>`, its usual preceding sibling, is
 * skipped over). Returns `undefined` when `xml` holds neither, which is the
 * ordinary case for a bare division fragment.
 *
 * Deliberately a scanner rather than a parse. This runs on every assembly, and
 * an assembled book is the whole project: parsing it to reach one attribute on
 * the outermost element cost ~2.5s on a 900KB document and dominated every
 * preview rebuild. The scan stops at the root division tag, so it reads the
 * document's first few hundred bytes rather than all of it.
 */
function findRootDivisionTag(xml: string): StartTag | undefined {
  const first = nextTag(xml, 0);
  if (!first || first.closing) return undefined;
  if (ROOT_DIVISION_TYPES.has(first.name as DivisionType)) return first;
  if (first.name !== "pretext" || first.selfClosing) return undefined;

  // Inside <pretext>: walk its direct children, skipping any that isn't a root
  // division (in practice just <docinfo>) over its whole subtree.
  let i = first.close;
  for (;;) {
    const tag = nextTag(xml, i);
    if (!tag || tag.closing) return undefined; // </pretext>, or end of input
    if (ROOT_DIVISION_TYPES.has(tag.name as DivisionType)) return tag;
    if (tag.selfClosing) {
      i = tag.close;
      continue;
    }
    let depth = 1;
    i = tag.close;
    while (depth > 0) {
      const inner = nextTag(xml, i);
      if (!inner) return undefined;
      i = inner.close;
      if (inner.closing) depth--;
      else if (!inner.selfClosing) depth++;
    }
  }
}

const LABEL_ATTR_RE = /\slabel\s*=\s*("([^"]*)"|'([^']*)')/g;
const XML_ID_ATTR_RE = /\sxml:id\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/**
 * A `label` value not already used anywhere in `xml`, starting from
 * `desiredLabel` and appending `-1`, `-2`, … until one is free.
 *
 * Only reached for a root element with no `@xml:id` at all, so the one full
 * pass over the document this costs is rare.
 */
function findUnusedLabel(xml: string, desiredLabel: string): string {
  const used = new Set<string>();
  for (const match of xml.matchAll(LABEL_ATTR_RE)) {
    used.add(match[2] ?? match[3] ?? "");
  }
  let label = desiredLabel;
  let i = 1;
  while (used.has(label)) {
    label = `${desiredLabel}-${i}`;
    i++;
  }
  return label;
}

/**
 * Ensure that the provided xml string has a label on the root document element
 * (book, article, or slideshow). We can generally assume there is an xml:id,
 * but we should duplicate that as a label if it is missing. This is important
 * for the previewer, which uses the label to identify the root document
 * element.
 *
 * The label is spliced into the root element's start tag, so the rest of the
 * document comes back byte-for-byte — which also keeps every line number
 * intact for the preview's two-way sync.
 *
 * @param xml Full XML for a PreTeXt document, including `<pretext>` around the
 * `<book>`/`<article>`/`<slideshow>` root element — or a bare division
 * fragment, which has no root element and is returned untouched.
 */
function ensureRootLabel(xml: string): string {
  const tag = findRootDivisionTag(xml);
  if (!tag) return xml;
  const startTag = xml.slice(tag.open, tag.close);
  if (LABEL_ATTR_RE.test(startTag)) {
    LABEL_ATTR_RE.lastIndex = 0; // /g regexes carry state between .test() calls
    return xml;
  }
  LABEL_ATTR_RE.lastIndex = 0;
  const xmlIdMatch = XML_ID_ATTR_RE.exec(startTag);
  const label =
    xmlIdMatch?.[1] ?? xmlIdMatch?.[2] ?? findUnusedLabel(xml, "main");
  // Before the tag's own `>` or `/>`, so both forms stay well-formed.
  const insertAt = tag.close - (tag.selfClosing ? 2 : 1);
  return (
    xml.slice(0, insertAt) +
    ` label="${escapeAttribute(label)}"` +
    xml.slice(insertAt)
  );
}

/**
 * Converted PreTeXt for one division, remembered alongside the exact source it
 * came from.
 *
 * Keyed by `xml:id` rather than by source text, so the cache holds one entry
 * per division and is bounded by the size of the project rather than by how
 * long the author has been typing. A stale entry costs a re-conversion, never a
 * wrong answer: the stored source must equal the division's current source for
 * the entry to be used at all.
 */
interface ConvertedDivision {
  source: string;
  xml: string;
}

const conversionCache = new Map<string, ConvertedDivision>();

/**
 * Cap on remembered divisions. Reached only by a session that has cycled
 * through several large projects, since a single project contributes one entry
 * per division; clearing wholesale (rather than evicting one entry) keeps this
 * free in the common case, where the limit is never approached.
 */
const CONVERSION_CACHE_LIMIT = 2000;

/**
 * A division's own PreTeXt XML: its source as-is when it is already PreTeXt,
 * and the converter's output — the division's own element included — when it
 * is LaTeX or Markdown. Conversion failures come back as an XML comment, so
 * one bad division never takes the surrounding document down with it.
 *
 * Conversions are cached because assembly walks the *whole* project on every
 * keystroke, while only the division being typed in has actually changed.
 * Re-converting the other divisions each time cost 18s per keystroke on an
 * 870KB LaTeX book; with the cache it is the ~25ms of converting the one that
 * changed.
 */
function divisionToPretext(division: Division): string {
  if (division.sourceFormat === "pretext") return division.source;

  const cached = conversionCache.get(division.xmlId);
  if (cached && cached.source === division.source) return cached.xml;

  let xml: string;
  if (division.sourceFormat === "markdown") {
    // A markdown division is a full markdown file (frontmatter + body); the
    // converter emits the complete `<type xml:id="..." label="...">` element
    // from the frontmatter, so the source is converted as-is with no wrapper
    // to strip or re-add here.
    const { pretextSource, pretextError } = derivePretextContent(
      division.source,
      "markdown",
    );
    xml = pretextSource ?? `<!-- conversion error: ${pretextError} -->`;
  } else {
    // LaTeX: convert the source and tag it with the division's authored type
    // (the `\label` becomes the `xml:id`) — see latexDivisionToTaggedPretext.
    xml =
      latexDivisionToTaggedPretext(division) ??
      `<!-- conversion error: ${division.xmlId} -->`;
  }

  if (conversionCache.size >= CONVERSION_CACHE_LIMIT) conversionCache.clear();
  conversionCache.set(division.xmlId, { source: division.source, xml });
  return xml;
}

/**
 * Scan `xml` for every `<plus:* ref="..."/>` placeholder and expand each one:
 * `image` resolves against `assets`, `snippet` resolves (recursively —
 * see {@link resolveSnippetRef}) against `snippets`, and anything else is
 * treated as a division ref and resolved via {@link resolveDivisionXml}.
 *
 * Shared by both division and snippet resolution, since a snippet's own
 * content can itself embed further snippet/image/division refs. `ancestors`
 * is a single set of refs shared across all three kinds — Division, Asset,
 * and Snippet refs are unique against each other project-wide, so one set
 * safely guards cycles across all three without risk of collision.
 */
function expandRefs(
  xml: string,
  divisions: Division[],
  snippets: Snippet[],
  assets: Asset[],
  ancestors: Set<string>,
): string {
  return xml.replace(
    /<plus:([a-z-]+)\s([^>]*ref="[^"]+"[^>]*?)(?:\/>|>\s*<\/plus:\1>)/g,
    (_match, tag: string, attrs: string) => {
      const ref = /ref="([^"]+)"/.exec(attrs)?.[1] ?? "";
      if (tag === "image") {
        const width = /width="([^"]+)"/.exec(attrs)?.[1];
        return resolveAssetRef(ref, assets, width);
      }
      if (tag === "snippet") {
        return resolveSnippetRef(ref, snippets, divisions, assets, ancestors);
      }
      return resolveDivisionXml(ref, divisions, snippets, assets, ancestors);
    },
  );
}

/**
 * Resolve a single division to its final PreTeXt XML, then recursively expand
 * any `<plus:* ref="..."/>` placeholders found inside it.
 *
 * A LaTeX/Markdown division's content is first converted to PreTeXt (its own
 * element included) and the resulting XML is then scanned for child refs just
 * like a native PreTeXt division — Markdown authors express includes as
 * `::section{ref="x"}` leaf directives and LaTeX authors as `\plus{section}{x}`
 * macros, both of which the converter turns into `<plus:section ref="x"/>`
 * placeholders before this expansion runs.
 *
 * `ancestors` guards against cycles in the ref graph — a division that
 * (directly or transitively) references itself is rendered as a comment
 * rather than recursing forever.
 */
function resolveDivisionXml(
  xmlId: string,
  divisions: Division[],
  snippets: Snippet[],
  assets: Asset[],
  ancestors: Set<string>,
): string {
  const division = divisions.find((d) => d.xmlId === xmlId);
  if (!division) return `<!-- missing division: ${xmlId} -->`;
  if (ancestors.has(xmlId)) return `<!-- circular reference: ${xmlId} -->`;

  const xml = divisionToPretext(division);
  const nextAncestors = new Set(ancestors).add(xmlId);
  return expandRefs(xml, divisions, snippets, assets, nextAncestors);
}

/**
 * Resolve a single `<plus:snippet ref="..."/>` placeholder to its final
 * PreTeXt markup by looking up the matching {@link Snippet} in `snippets`.
 * The snippet's own source is converted to PreTeXt (format-aware, via
 * {@link derivePretextContent}) and then itself scanned for further
 * `<plus:snippet>` / `<plus:image>` refs, so a snippet can embed another
 * snippet or an image. Falls back to an XML comment if no matching snippet
 * is found, its own conversion fails, or it (directly or transitively)
 * references itself.
 */
function resolveSnippetRef(
  ref: string,
  snippets: Snippet[],
  divisions: Division[],
  assets: Asset[],
  ancestors: Set<string>,
): string {
  const snippet = snippets.find((s) => s.ref === ref);
  if (!snippet) return `<!-- missing snippet: ${ref} -->`;
  if (ancestors.has(ref)) return `<!-- circular reference: ${ref} -->`;

  const { pretextSource, pretextError } = derivePretextContent(
    snippet.source,
    snippet.sourceFormat,
  );
  const xml = pretextSource ?? `<!-- conversion error: ${pretextError} -->`;
  const nextAncestors = new Set(ancestors).add(ref);
  return expandRefs(xml, divisions, snippets, assets, nextAncestors);
}

/**
 * Resolve the root division and recursively expand every
 * `<plus:* ref="..."/>` placeholder it (transitively) contains, converting
 * any LaTeX/Markdown divisions to PreTeXt along the way. Returns the bare
 * root element (e.g. `<book>...</book>`) — *not* wrapped in `<pretext>` and
 * without `<docinfo>`.
 *
 * This is the body half of a full document. Most callers that want an
 * actual buildable/persistable document should use
 * {@link assembleFullProjectSource} instead; this lower-level function
 * remains for callers (like the division-scoped preview path) that need to
 * compose the resolved body further before wrapping it themselves.
 */
export function assembleProjectSource(
  divisions: Division[],
  rootXmlId: string,
  assets: Asset[] = [],
  snippets: Snippet[] = [],
): string {
  return ensureRootLabel(
    resolveDivisionXml(rootXmlId, divisions, snippets, assets, new Set()),
  );
}

/**
 * Wrap a resolved document body in the outer `<pretext>` element with
 * `<docinfo>` inserted as its sibling, matching real PreTeXt document shape.
 * `lang`, when provided (a BCP-47 code like `"en-US"`), is written as
 * `@xml:lang` on the root `<pretext>` element.
 */
function wrapInPretextDocument(body: string, docinfo: string, lang?: string): string {
  const docinfoBlock = docinfo.trim() ? `${docinfo.trim()}\n` : "";
  const langAttr = lang ? ` xml:lang="${lang}"` : "";
  return ensureRootLabel(`<pretext${langAttr}>\n${docinfoBlock}${body}\n</pretext>`);
}

/**
 * Assemble the complete PreTeXt document for a project: the root division,
 * fully resolved (every `<plus:* ref="..."/>` placeholder expanded and any
 * LaTeX/Markdown divisions converted to PreTeXt), wrapped in the outer
 * `<pretext>` element with `<docinfo>` inserted as its sibling.
 *
 * This is the same shape produced for a root-division preview build, and is
 * what a host application should persist as "the full source" and send to a
 * build server (e.g. `https://build.pretext.plus`) to produce the final
 * rendered document — the `divisions` pool itself is never a valid build
 * input, since it's a flat list of fragments rather than a single document
 * tree.
 * `lang`, when provided, is written as `@xml:lang` on the root `<pretext>` element.
 */
export function assembleFullProjectSource(
  divisions: Division[],
  rootXmlId: string,
  docinfo: string,
  assets: Asset[] = [],
  lang?: string,
  snippets: Snippet[] = [],
): string {
  const body = resolveDivisionXml(rootXmlId, divisions, snippets, assets, new Set());
  return wrapInPretextDocument(body, docinfo, lang);
}

// ---------------------------------------------------------------------------
// Division-scoped preview wrapping
// ---------------------------------------------------------------------------

/** Division types that are direct children of `<book>`. */
const BOOK_CHILD_DIVISION_TYPES: ReadonlySet<DivisionType> = new Set([
  "part",
  "chapter",
]);



/**
 * Wrap a single division's own tagged XML (e.g.
 * `<section xml:id="...">...</section>`) into a standalone PreTeXt fragment
 * document suitable for a build-server preview of just that division.
 *
 * This function itself never expands `<plus:* ref="..."/>` placeholders —
 * the real build server has no notion of that placeholder syntax, so callers
 * must resolve them first (e.g. via {@link assembleProjectSource}) before
 * passing `divisionXml` in. Passing unresolved refs produces invalid PreTeXt
 * and a build failure.
 *
 * `divisionType` determines the minimal wrapper needed around `divisionXml`:
 * root types (`book`/`article`/`slideshow`) need none, `chapter`/`part` are
 * wrapped in a bare `<book>`, and everything else in a bare `<article>`.
 * The PreTeXt schema requires `<book>`/`<article>`/`<slideshow>` to have a
 * `<title>` as their first child, so a wrapper built here uses `wrapperTitle`
 * for that — without it the build server's schema validation rejects the
 * document, produces no output, and 500s.
 * `docinfo` (the full `<docinfo>...</docinfo>` element, or `""`) is inserted
 * as a sibling of the root element inside `<pretext>`, matching real PreTeXt
 * document shape. `lang`, when provided, is written as `@xml:lang` on the
 * root `<pretext>` element.
 *
 * `rootType` is the type of the *project's* root division, which a division's
 * own type cannot reveal: a `<section>` looks identical whether it lives in an
 * article or in a deck. It matters only for a slideshow, and getting it wrong
 * there **fails silently**. A section of slides wrapped in `<article>` still
 * renders — the renderer detects the `<slide>` elements and selects the
 * reveal.js conversion, which is then handed a root element it has no template
 * for, and emits a deck-shaped page with no slides in it. An empty preview, not
 * an error. Omit it and the article fallback is used, as before.
 */
export function wrapDivisionForPreview(
  divisionType: DivisionType,
  divisionXml: string,
  docinfo: string,
  wrapperTitle: string,
  lang?: string,
  rootType?: RootDivisionType,
): string {
  // A root division is already a complete top-level element.
  if (ROOT_DIVISION_TYPES.has(divisionType)) {
    return wrapInPretextDocument(divisionXml, docinfo, lang);
  }
  const wrapper: RootDivisionType =
    rootType === "slideshow"
      ? "slideshow"
      : BOOK_CHILD_DIVISION_TYPES.has(divisionType)
        ? "book"
        : "article";
  return wrapInPretextDocument(
    `<${wrapper}>\n<title>${wrapperTitle}</title>\n${divisionXml}\n</${wrapper}>`,
    docinfo,
    lang,
  );
}

// ---------------------------------------------------------------------------
// Initial-load normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a division pool right after it arrives from the host, before
 * it's seeded into the store as the editing buffer.
 *
 * Hosts aren't required to persist a division's `title` separately from its
 * PreTeXt source — it's meant to be read from the `<title>` element inside
 * `source` — so a freshly loaded division's `title` field can be blank even
 * though its source already has a real title. Backfill it here so the TOC
 * doesn't show "Untitled" for content that already has one.
 *
 * The root division additionally needs an `<article>`/`<book>`/`<slideshow>`
 * wrapper element. A host that hands back a brand-new project's root division
 * as a bare body fragment (no wrapper at all) gets one added here, named by
 * `projectType` (defaulting to `"article"`). The wrapper's `<title>` falls back
 * to the host's `projectTitle` when the fragment carries no title of its own,
 * rather than the placeholder `"Untitled"`.
 */
/**
 * Strip a leading `<title>...</title>` element off a bare (unwrapped) PreTeXt
 * fragment, returning its text alongside the remaining body. A fragment with
 * several top-level siblings generally isn't well-formed XML on its own (only
 * one root element is allowed), so this matches by string rather than
 * parsing — mirroring {@link stripWrapperByRegex}'s fallback approach.
 */
function extractLeadingTitle(content: string): { title: string; body: string } {
  const trimmed = content.trim();
  const m = trimmed.match(/^<title\b[^>]*>([\s\S]*?)<\/title>\s*/);
  if (!m) return { title: "", body: trimmed };
  return { title: m[1].trim(), body: trimmed.slice(m[0].length) };
}

export function normalizeDivisionsOnLoad(
  divisions: Division[],
  rootDivisionId: string | undefined,
  projectType: RootDivisionType | undefined,
  projectTitle?: string,
): Division[] {
  // Checked rather than cast: `projectType` comes from the host, which may be
  // untyped JavaScript, and this value is written straight into a tag name.
  const wrapperType: RootDivisionType = isRootDivisionType(projectType)
    ? projectType
    : "article";

  return divisions.map((division) => {
    if (division.sourceFormat === "markdown") {
      // Markdown divisions keep their title (and other structural metadata)
      // in frontmatter; only backfill a blank title so the TOC doesn't show
      // "Untitled" for content that already names itself — and the type, which
      // hosts generally don't store either (see the pretext branch below).
      const mdMeta = !division.title || !division.type
        ? extractMarkdownDivisionMetadata(division.source)
        : null;
      if (mdMeta) {
        return {
          ...division,
          title: division.title || mdMeta.title,
          type: division.type || mdMeta.type,
        };
      }
      return division;
    }
    if (division.sourceFormat === "latex") {
      // LaTeX divisions keep their title in the source header (the first-line
      // `\section{…}` or a `\title{…}` inside `\begin{section}`); backfill a
      // blank title from there so the TOC doesn't show "Untitled". There is no
      // type to recover: a LaTeX division's PreTeXt type isn't represented in
      // its source at all (it's applied when the conversion is tagged).
      //
      // The header is also rewritten from what can be read out of it, which is
      // where a division imported with a malformed one (a `\label` inside the
      // title argument and so a stray `}` after it) gets repaired: the header
      // line is locked in the code editor, so an author who never opens the
      // properties form has no other way to reach it. This also installs the
      // blank line the converter needs below the header.
      const source = normalizeLatexDivisionSource(division.source);
      const title =
        division.title || extractLatexDivisionTitle(source) || division.title;
      if (source === division.source && title === division.title) return division;
      return { ...division, source, title };
    }
    if (division.sourceFormat !== "pretext") return division;

    const meta = extractDivisionMetadata(division.source);

    if (division.xmlId === rootDivisionId && !(meta && ROOT_DIVISION_TYPES.has(meta.type))) {
      // The bare fragment may already carry its own leading <title> even
      // though it was never wrapped in <article>/<book> — use that ahead of
      // the host's project title (and "Untitled" only as a last resort) so a
      // real title isn't discarded, and drop it from the body so it isn't
      // duplicated once it's reinserted as the wrapper's <title>.
      const { title: embeddedTitle, body } = extractLeadingTitle(division.source);
      const title =
        division.title || embeddedTitle || projectTitle || "Untitled";
      return {
        ...division,
        type: wrapperType,
        title,
        source: `<${wrapperType} xml:id="${division.xmlId}">\n<title>${title}</title>\n\n${body}\n</${wrapperType}>`,
      };
    }

    // A PreTeXt division carries its type in its own source — the wrapper
    // element's tag name — and hosts that derive it from there (the Rails app
    // does) only bother for the root, leaving every other division typeless.
    // Recover it here so the TOC can tell a chapter from a subsection: type
    // drives the row's label, the `<plus:TYPE ref/>` placeholders written for
    // it, and which types its children may be.
    if (meta && ((!division.title && meta.title) || !division.type)) {
      return {
        ...division,
        title: division.title || meta.title,
        type: division.type || meta.type,
      };
    }
    return division;
  });
}

