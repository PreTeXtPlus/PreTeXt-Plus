/**
 * Utilities for splitting a PreTeXt article into individual sections and
 * merging them back into a complete document.
 *
 * Splitting always works at the `<section>`, `<introduction>`, and
 * `<conclusion>` level inside a top-level `<article>` element.
 */

import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import type { Element, Root } from "xast";
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
import { escapeAttribute, escapeText, unescapeAttribute } from "./xmlUtils";

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

function trimBoundaryBlankLines(value: string): string {
  return value
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "");
}

/**
 * Parse XML defensively.  Returns `null` instead of throwing when the input is
 * not well-formed.  Callers that run during render MUST use this rather than `fromXml` directly: the user routinely passes
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------


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
  return {
    id,
    xmlId: id,
    title,
    source: createDivisionContent("pretext"),
    type,
    sourceFormat: "pretext",
  };
}

/** Create a blank `<introduction>` division. */
export function createIntroduction(): DocumentSection {
  const id = generateId();
  return {
    id,
    xmlId: id,
    title: "",
    source: createDivisionContent("pretext"),
    type: "introduction",
    sourceFormat: "pretext",
  };
}

/** Create a blank `<conclusion>` division. */
export function createConclusion(): DocumentSection {
  const id = generateId();
  return {
    id,
    xmlId: id,
    title: "",
    source: createDivisionContent("pretext"),
    type: "conclusion",
    sourceFormat: "pretext",
  };
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

/** Create a new blank LaTeX section as a `Division`. */
export function createNewLatexSection(title = "New Section"): DocumentSection {
  const id = generateId();
  return {
    id,
    xmlId: id,
    title,
    source: "",
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
    title: "",
    source: "",
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
    title: "",
    source: "",
    type: "conclusion",
    sourceFormat: "latex",
  };
}

// ---------------------------------------------------------------------------
// Wrap-as-section and merge utilities
// ---------------------------------------------------------------------------


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
  label?: string;
  title?: string;
  /** Further attributes of the division's element, e.g. `component`. */
  attrs?: Record<string, string>;
}): string {
  const lines = [`division: ${meta.type}`, `id: ${meta.xmlId}`];
  if (meta.title) lines.push(`title: ${quoteYamlValue(meta.title)}`);
  if (meta.label) lines.push(`label: ${meta.label}`);
  for (const [name, value] of Object.entries(meta.attrs ?? {})) {
    lines.push(`${name}: ${quoteYamlValue(value)}`);
  }
  return `---\n${lines.join("\n")}\n---`;
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
 * The expanded form is what an XML round-trip (e.g. through xast) produces,
 * so every consumer must
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
 *
 * The optional argument is where a LaTeX author writes the pass-through
 * attributes that a PreTeXt or Markdown holder writes inline:
 * `\plus[component=teacher]{section}{x}` converts to
 * `<plus:section ref="x" component="teacher"/>`.  It is tolerated — and
 * preserved by the rewrite helpers — everywhere a placeholder is matched, but
 * never emitted: the writers produce the bare two-argument form and leave the
 * optional argument to the author.
 */
function latexDivisionRefSource(refValue: string | null): string {
  const ref = refValue === null ? `([^}]+)` : escapeRegex(refValue);
  const tag = `(?:${DIVISION_REF_TAG_ALTERNATION})`;
  return `\\\\plus(?:\\[[^\\]]*\\])?\\{${tag}\\}\\{${ref}\\}`;
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
    // A PreFigure diagram is code too; a `<label>` in one can say anything.
    "prefigure",
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
    latex: `\\\\plus(?:\\[[^\\]]*\\])?\\{(${tags})\\}\\{([^}]+)\\}`,
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
    latex: `\\\\plus(?:\\[[^\\]]*\\])?\\{image\\}\\{([^}]+)\\}`,
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
  const latexRe = new RegExp(`(\\\\plus(?:\\[[^\\]]*\\])?\\{image\\}\\{)${oldR}(\\})`, "g");
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
  const latexRe = new RegExp(`\\\\plus(?:\\[[^\\]]*\\])?\\{image\\}\\{${r}\\}`, "g");
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
    latex: `\\\\plus(?:\\[[^\\]]*\\])?\\{snippet\\}\\{([^}]+)\\}`,
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
  const latexRe = new RegExp(`(\\\\plus(?:\\[[^\\]]*\\])?\\{snippet\\}\\{)${oldR}(\\})`, "g");
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
  const latexRe = new RegExp(`\\\\plus(?:\\[[^\\]]*\\])?\\{snippet\\}\\{${r}\\}`, "g");
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

// ---------------------------------------------------------------------------
// Placements — where an image or snippet is placed, and under which instance
// ---------------------------------------------------------------------------

/** The two kinds of record that may be placed more than once. */
export type PlacementTag = "image" | "snippet";

/**
 * One `<plus:image>`/`<plus:snippet>` placeholder in a source: what it places,
 * the `instance` it names (see {@link qualifyIdentifiers}), and where it is.
 */
export interface Placement {
  tag: PlacementTag;
  ref: string;
  instance?: string;
  /** Offset and length of the placeholder's text in the source. */
  index: number;
  length: number;
}

/**
 * The placeholder syntax of each format. LaTeX names the instance in the
 * optional argument (`\plus[instance=ch3]{image}{graph}`), which the
 * converter turns into the same attribute the other two write directly.
 */
const PLACEMENT_SOURCE: Record<SourceFormat, string> = {
  pretext: `<plus:(image|snippet)\\b([^>]*?)\\/?>`,
  markdown: `::(image|snippet)(?:\\[[^\\]]*\\])?\\{([^}]*)\\}`,
  latex: `\\\\plus(?:\\[([^\\]]*)\\])?\\{(image|snippet)\\}\\{([^}]+)\\}`,
};

const quotedAttr = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];

/**
 * Every image and snippet placement in `content`, in document order, ignoring
 * examples inside verbatim spans — the same placeholders {@link parseAssetRefs}
 * and {@link parseSnippetRefs} find, with their position and instance name.
 */
export function parsePlacements(content: string, sourceFormat: SourceFormat): Placement[] {
  const re = new RegExp(PLACEMENT_SOURCE[sourceFormat], "g");
  const scanned = blankVerbatim(content, sourceFormat);
  const placements: Placement[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    let tag: string, ref: string | undefined, instance: string | undefined;
    if (sourceFormat === "latex") {
      tag = m[2];
      ref = m[3].trim();
      instance = /(?:^|,)\s*instance\s*=\s*\{?([^,}]*)\}?/.exec(m[1] ?? "")?.[1];
    } else {
      tag = m[1];
      ref = quotedAttr(m[2], "ref");
      instance = quotedAttr(m[2], "instance");
    }
    if (!ref) continue;
    placements.push({
      tag: tag as PlacementTag,
      ref,
      instance: instance?.trim() || undefined,
      index: m.index,
      length: m[0].length,
    });
  }
  return placements;
}

/**
 * `placeholder` — the text of one placement, in `sourceFormat`'s syntax — with
 * `instance` named on it, everything else as written.
 */
export function addPlacementInstance(
  placeholder: string,
  sourceFormat: SourceFormat,
  instance: string,
): string {
  if (sourceFormat === "markdown") return placeholder.replace(/\}$/, ` instance="${instance}"}`);
  if (sourceFormat === "latex") {
    return /^\\plus\[/.test(placeholder)
      ? placeholder.replace(/^\\plus\[([^\]]*)\]/, (_m, opts: string) =>
        `\\plus[${opts}${opts.trim() ? "," : ""}instance=${instance}]`)
      : placeholder.replace(/^\\plus/, `\\plus[instance=${instance}]`);
  }
  return placeholder.replace(/(\s*\/?>)$/, ` instance="${instance}"$1`);
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
  const source = createDivisionContent(sourceFormat);
  return { id: xmlId, xmlId, title, type, sourceFormat, source };
}

/**
 * The blank body a new division starts with in `sourceFormat` — its
 * element (type, title, id) is built from the record, so the body holds only
 * an empty paragraph to type into for PreTeXt, and nothing at all for LaTeX
 * and Markdown, where a blank line already is one.
 */
export function createDivisionContent(sourceFormat: SourceFormat): string {
  return sourceFormat === "pretext" ? "<p>\n\n</p>" : "";
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

  let out = "";
  let cursor = 0;
  for (const { index, length } of spans) {
    const placeholder = content.slice(index, index + length);
    out +=
      content.slice(cursor, index) +
      retagDivisionRef(placeholder, newType, newXmlId, sourceFormat);
    cursor = index + length;
  }
  return out + content.slice(cursor);
}

/**
 * Rewrite one already-located division-ref placeholder in place, changing only
 * its tag name and its `ref` value and leaving every other character alone.
 *
 * Editing the placeholder rather than rebuilding it from
 * {@link divisionRefTag} is what keeps the pass-through attributes: a
 * `<plus:section ref="old" component="teacher"/>` rebuilt from its type and id
 * comes back as a bare `<plus:section ref="new"/>`, so renaming a division's
 * `xml:id` would silently drop the `@component` the author put on the include
 * — no error, just a division that quietly starts appearing in every build.
 */
function retagDivisionRef(
  placeholder: string,
  newType: DivisionType,
  newXmlId: string,
  sourceFormat: SourceFormat,
): string {
  switch (sourceFormat) {
    case "pretext":
      // Both the start tag and, in the expanded-empty shape, the end tag.
      return replaceRefAttr(
        placeholder.replace(/<(\/?)plus:[A-Za-z][\w-]*/g, (_m, slash: string) =>
          `<${slash}plus:${newType}`,
        ),
        newXmlId,
      );
    case "markdown":
      return replaceRefAttr(
        placeholder.replace(/^::[A-Za-z][\w-]*/, () => `::${newType}`),
        newXmlId,
      );
    case "latex":
      // Group 1 holds `\plus` together with any optional argument, so the
      // author's `[component=teacher]` survives the rename untouched.
      return placeholder.replace(
        /^(\\plus(?:\[[^\]]*\])?)\{[^}]*\}\{[^}]*\}$/,
        (_whole, head: string) => `${head}{${newType}}{${newXmlId}}`,
      );
  }
}

/**
 * `text` with the value of its first `ref` attribute set to `newRef`.
 *
 * Located with the shared {@link ATTR_RE} scan rather than a bare `ref="…"`
 * search so that a `ref=` sitting inside another attribute's value, or the
 * tail of a `data-ref`/`xref`, cannot be rewritten by mistake.
 */
function replaceRefAttr(text: string, newRef: string): string {
  for (const m of text.matchAll(ATTR_RE)) {
    if (m[1] !== "ref" || m.index === undefined) continue;
    return (
      text.slice(0, m.index) +
      `ref="${newRef}"` +
      text.slice(m.index + m[0].length)
    );
  }
  return text;
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
// A division's element: split out of source, and wrapped back around it
// ---------------------------------------------------------------------------
//
// A division record stores its *body* only. Its type, `xml:id` (its ref, which
// is also its `@label`), title and any other attributes are fields of the
// record, and everything that needs
// the division as PreTeXt — assembly, the code editor's read-only wrapper
// lines, the converters — builds the element from those fields here.
//
// `splitDivisionSource` is the inverse, for source that still carries its
// element: data stored before the fields existed, and anything an importer
// produces. Both directions live together so they cannot drift apart.

/**
 * LaTeX division types with no header command: `@pretextbook/latex-pretext`
 * has no `\introduction{…}`, so their LaTeX source is the body alone and the
 * element is added around the *converted* body instead.
 */
const LATEX_HEADERLESS_TYPES: ReadonlySet<DivisionType> = new Set([
  "introduction",
  "conclusion",
]);

/** The metadata fields of a division — what its element is built from. */
export type DivisionElementFields = Pick<
  Division,
  "type" | "xmlId" | "title" | "sourceFormat" | "attrs"
>;

/** A division's source taken apart into its element's fields and its body. */
export interface DivisionSourceSplit {
  type: DivisionType;
  /** Title markup in the source's own format; `""` when there is none. */
  title: string;
  /** The `xml:id` (LaTeX: header `\label`) the source names; `""` if none. */
  xmlId: string;
  attrs: Record<string, string>;
  body: string;
  /** Whether the source carried an element/header/frontmatter at all. */
  wrapped: boolean;
  /**
   * Whether the fields and body together account for the whole source: the
   * element built back from them (see {@link wrapDivisionSource}) reads the
   * same as the source apart from what a split is defined to change — blank
   * lines at the seams, a `label`, a header's `*`. False means a migration
   * should hold the source up for review rather than overwrite it.
   */
  lossless: boolean;
  /** Anything the split had to guess at or move, for a migration to report. */
  warnings: string[];
}

/** What to assume for a source that names no type or title of its own. */
export interface DivisionSplitFallback {
  type?: DivisionType;
  title?: string;
  /**
   * Whether the source is the project's root division's. A root's own element
   * can only be a root element (`article`/`book`/`slideshow`): a `<section>` or
   * `\section` at the head of a root's source is the first thing in its body,
   * which is how the editor always read it (the pre-migration root shape was a
   * bare fragment that the editor wrapped on load).
   */
  root?: boolean;
  /**
   * The ref the division is known by. A source that opens with an element of
   * the division's own -- a wrapper its standing allows, carrying this id --
   * and that still comes back unsplit is reported as not lossless: the element
   * is the division's, and whatever kept it from being taken apart (content
   * after its close, a close tag that never comes) wants looking at, since
   * assembly would otherwise wrap the element in a second copy of itself.
   */
  ref?: string;
}

/** Everything but the `lossless` verdict, which {@link splitDivisionSource} adds. */
type RawSplit = Omit<DivisionSourceSplit, "lossless">;

/** The closing tag matching an element whose start tag ends at `from`. */
function matchingCloseTag(xml: string, from: number): StartTag | undefined {
  let depth = 1;
  let i = from;
  for (;;) {
    const tag = nextTag(xml, i);
    if (!tag) return undefined;
    i = tag.close;
    if (tag.closing) {
      if (--depth === 0) return tag;
    } else if (!tag.selfClosing) {
      depth++;
    }
  }
}

/** Every attribute of `startTag`, unescaped. */
function readAttributes(startTag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of startTag.matchAll(ATTR_RE)) {
    if (!(m[1] in out)) out[m[1]] = unescapeAttribute(m[2] ?? m[3] ?? "");
  }
  return out;
}

/**
 * Remove a leading `<title>` element from `inner`, returning its inner markup
 * verbatim. A `<title>` that is not the first element stays where it is: it
 * may be a title of something else (a later `<p>` cannot contain one, but a
 * comment between may hide anything), and a guess here would move content.
 */
function takeLeadingTitle(inner: string): { title: string; body: string } | null {
  const first = nextTag(inner, 0);
  if (!first || first.closing || first.name !== "title") return null;
  const lead = inner.slice(0, first.open);
  const keepLead = /\S/.test(lead) ? lead : "";
  if (first.selfClosing) {
    return { title: "", body: keepLead + inner.slice(first.close) };
  }
  const end = matchingCloseTag(inner, first.close);
  if (!end) return null;
  return {
    title: inner.slice(first.close, end.open).trim(),
    body: keepLead + inner.slice(end.close),
  };
}

const XML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const XML_DECLARATION_RE = /<\?xml[\s\S]*?\?>/;

/** Whether `xml` holds anything besides comments, an XML declaration and whitespace. */
function hasContentOutsideMarkup(xml: string): boolean {
  return /\S/.test(xml.replace(XML_COMMENT_RE, "").replace(XML_DECLARATION_RE, ""));
}

/** The element names that may be a division's own wrapper, by whether it is the root. */
function wrapperTypesFor(root: boolean): ReadonlySet<string> {
  return root ? (ROOT_DIVISION_TYPES as ReadonlySet<string>) : ALL_DIVISION_TYPES;
}

function splitPretextDivisionSource(source: string, root: boolean): RawSplit {
  const warnings: string[] = [];
  const start = nextTag(source, 0);

  // The whole source is body — the pre-migration root shape — though it may
  // still lead with its own <title>.
  const fragment = (): RawSplit => {
    const titled = takeLeadingTitle(source);
    return {
      type: "section",
      title: titled?.title ?? "",
      xmlId: "",
      attrs: {},
      body: trimBoundaryBlankLines(titled?.body ?? source),
      wrapped: false,
      warnings,
    };
  };

  if (!start || start.closing || !wrapperTypesFor(root).has(start.name)) {
    if (start && !start.closing && ALL_DIVISION_TYPES.has(start.name)) {
      warnings.push(`a root's element is a root element; its leading <${start.name}> is body`);
    }
    return fragment();
  }

  let inner: string;
  let after: string;
  if (start.selfClosing) {
    inner = "";
    after = source.slice(start.close);
  } else {
    // A source that is not well formed inside -- an unclosed <p>, a bare <br>,
    // a stray </p> -- throws the depth count off, so the scan ends on another
    // element's close tag or none. The element's own close is then the last
    // </name> in the source, with nothing but whitespace and comments after it;
    // taking everything to the end as body instead would leave that close tag
    // in the body, and assembly would write a second one after it.
    let end = matchingCloseTag(source, start.close);
    if (!end || end.name !== start.name) {
      const last = trailingCloseTag(source, start);
      if (last) {
        warnings.push(`<${start.name}> is not well formed inside; closed it at its last </${start.name}>`);
        end = last;
      }
    }
    if (end) {
      inner = source.slice(start.close, end.open);
      after = source.slice(end.close);
    } else {
      warnings.push(`<${start.name}> is never closed; kept everything after it as body`);
      inner = source.slice(start.close);
      after = "";
    }
  }

  // An element with content beside it — a second <section>, loose text — is
  // not the division's wrapper but the first of several things in its body:
  // that is how the old reading (a parse, which such a source fails) saw it,
  // and moving the rest inside the element would change what contains what.
  const before = source.slice(0, start.open);
  if (hasContentOutsideMarkup(before) || hasContentOutsideMarkup(after)) {
    warnings.push(`<${start.name}> is not the whole source; kept all of it as body`);
    return fragment();
  }

  const { "xml:id": xmlId = "", label, ...attrs } = readAttributes(
    source.slice(start.open, start.close),
  );
  if (label !== undefined) warnings.push(droppedLabelWarning(label));

  const titled = takeLeadingTitle(inner);
  let body = titled ? titled.body : inner;

  // Comments outside the element are kept by moving them into the body; an
  // XML declaration has no place in a fragment and is dropped.
  const beforeComments = before.replace(XML_DECLARATION_RE, "");
  if (/\S/.test(beforeComments)) {
    warnings.push("a comment before the division element was moved into its body");
    body = `${beforeComments.trim()}\n${body}`;
  }
  if (/\S/.test(after)) {
    warnings.push("a comment after the division element was moved into its body");
    body = `${body}\n${after.trim()}`;
  }

  return {
    type: start.name as DivisionType,
    title: titled?.title ?? "",
    xmlId,
    attrs,
    body: trimBoundaryBlankLines(body),
    wrapped: true,
    warnings,
  };
}

/**
 * The last `</name>` in `xml` after `start`, provided nothing but whitespace
 * and comments follow it -- the close tag of an element that fills the source
 * but is not well formed inside. Undefined when there is none, or when content
 * follows the last one (the element is then one of several things in the
 * source, not its wrapper).
 */
function trailingCloseTag(xml: string, start: StartTag): StartTag | undefined {
  let last: RegExpExecArray | undefined;
  for (const m of xml.matchAll(new RegExp(`</${escapeRegex(start.name)}\\s*>`, "g"))) {
    if (m.index >= start.close) last = m;
  }
  if (!last) return undefined;
  const close = last.index + last[0].length;
  if (hasContentOutsideMarkup(xml.slice(close))) return undefined;
  return { name: start.name, open: last.index, close, selfClosing: false, closing: true };
}

const LATEX_ENV_HEADER_RE = /^\s*\\begin\{([A-Za-z][A-Za-z-]*)\}/;

function splitLatexDivisionSource(source: string, root: boolean): RawSplit {
  const warnings: string[] = [];
  const wrapperTypes = wrapperTypesFor(root);
  const fragment = (): RawSplit => ({
    type: "section",
    title: "",
    xmlId: "",
    attrs: {},
    body: trimBoundaryBlankLines(source),
    wrapped: false,
    warnings,
  });
  const notARoot = (macro: string): RawSplit => {
    warnings.push(`a root's element is a root element; its leading \\${macro} is body`);
    return fragment();
  };

  const header = parseLatexDivisionHeader(source);
  if (header && ALL_DIVISION_TYPES.has(header.macro)) {
    if (!wrapperTypes.has(header.macro)) return notARoot(header.macro);
    if (header.starred) warnings.push(`dropped the * of \\${header.macro}*`);
    return {
      type: header.macro as DivisionType,
      title: header.title,
      xmlId: header.label,
      attrs: {},
      body: trimBoundaryBlankLines(source.slice(header.length)),
      wrapped: true,
      warnings,
    };
  }

  // The environment style: \begin{section} \title{…} … \end{section}.
  const env = LATEX_ENV_HEADER_RE.exec(source);
  if (env && ALL_DIVISION_TYPES.has(env[1])) {
    if (!wrapperTypes.has(env[1])) return notARoot(`begin{${env[1]}}`);
    const endRe = new RegExp(`\\\\end\\{${escapeRegex(env[1])}\\}\\s*$`);
    const end = endRe.exec(source);
    if (end) {
      let inner = source.slice(env[0].length, end.index);
      let title = "";
      const titleMatch = /^\s*\\title\{([^}]*)\}/.exec(inner);
      if (titleMatch) {
        title = titleMatch[1].trim();
        inner = inner.slice(titleMatch[0].length);
      }
      let xmlId = "";
      const labelMatch = /^\s*\\label\{([^}]*)\}/.exec(inner);
      if (labelMatch) {
        xmlId = labelMatch[1].trim();
        inner = inner.slice(labelMatch[0].length);
      }
      return {
        type: env[1] as DivisionType,
        title,
        xmlId,
        attrs: {},
        body: trimBoundaryBlankLines(inner),
        wrapped: true,
        warnings,
      };
    }
  }

  return fragment();
}

/**
 * A source's own `@label` has nowhere to go: a division's label is its ref,
 * written by assembly, so one named in source is dropped -- and said so.
 */
function droppedLabelWarning(label: string): string {
  return `dropped label ${JSON.stringify(label)}; a division's label is its ref`;
}

/**
 * Frontmatter keys that are fields of the record rather than attributes --
 * `label` among them, so that it is dropped rather than kept as one.
 */
const MARKDOWN_FIELD_KEYS: ReadonlySet<string> = new Set([
  "division",
  "id",
  "xmlid",
  "xml:id",
  "title",
  "label",
]);

/** A frontmatter line's key and raw value; comments and blank lines are not one. */
const FRONTMATTER_KEY_VALUE_RE = /^[ \t]*([A-Za-z_][\w.:-]*)[ \t]*:[ \t]*(.*)$/;

function splitMarkdownDivisionSource(source: string): RawSplit {
  const parsed = parseMarkdownFrontmatter(source);
  if (!parsed) {
    return {
      type: "section",
      title: "",
      xmlId: "",
      attrs: {},
      body: trimBoundaryBlankLines(source),
      wrapped: false,
      warnings: [],
    };
  }
  const attrs: Record<string, string> = {};
  const block = MARKDOWN_FRONTMATTER_RE.exec(source)![1];
  for (const line of block.split(/\r?\n/)) {
    const kv = FRONTMATTER_KEY_VALUE_RE.exec(line);
    if (kv && !MARKDOWN_FIELD_KEYS.has(kv[1])) attrs[kv[1]] = unquoteYamlValue(kv[2]);
  }
  return {
    type: parsed.type,
    title: parsed.title,
    xmlId: parsed.xmlId,
    attrs,
    body: trimBoundaryBlankLines(parsed.body),
    wrapped: true,
    warnings: parsed.label ? [droppedLabelWarning(parsed.label)] : [],
  };
}

/**
 * Take a division's source apart into the fields of its element and its body,
 * in whichever way its format spells the element: a PreTeXt wrapper element
 * (`<section xml:id="…" label="…"><title>…</title>…</section>`), a LaTeX
 * header (`\section{…}\label{…}`, or the `\begin{section}` environment), or
 * Markdown frontmatter. The inverse of {@link wrapDivisionSource}.
 *
 * Source with no element of its own (a LaTeX introduction, a bare fragment)
 * comes back as all body, with `fallback`'s type and title. A root's element
 * can only be a root element (`fallback.root`): anything else at the head of
 * its source is body too, except Markdown frontmatter, which can only ever be
 * the division's own metadata and so has its type corrected instead. The body
 * is kept byte for byte apart from blank lines at its ends — a PreTeXt wrapper
 * is located with the same tolerant scanner assembly uses, never parsed and
 * reserialized, so an author's formatting survives — and `lossless` says
 * whether the whole source is accounted for.
 */
export function splitDivisionSource(
  source: string,
  sourceFormat: SourceFormat,
  fallback: DivisionSplitFallback = {},
): DivisionSourceSplit {
  const root = fallback.root ?? false;
  const raw =
    sourceFormat === "latex"
      ? splitLatexDivisionSource(source, root)
      : sourceFormat === "markdown"
        ? splitMarkdownDivisionSource(source)
        : splitPretextDivisionSource(source, root);
  // Judged on what the source itself says, before anything is assumed for it.
  let lossless = splitAccountsForSource(source, sourceFormat, raw);
  if (!raw.wrapped && fallback.ref && opensWithOwnElement(source, sourceFormat, fallback.ref, root)) {
    raw.warnings.push(
      `source opens with the division's own element (${fallback.ref}) but was not split around it`,
    );
    lossless = false;
  }
  const split: DivisionSourceSplit = { ...raw, lossless };

  if (!split.wrapped) {
    return {
      ...split,
      type: fallback.type ?? split.type,
      title: split.title || fallback.title || "",
    };
  }
  if (!ALL_DIVISION_TYPES.has(split.type)) {
    // Only frontmatter can name a type that is no division at all; a PreTeXt
    // or LaTeX element that is not one is never taken for the wrapper.
    const type = fallback.type ?? "section";
    split.warnings.push(`${JSON.stringify(split.type)} is not a division type; typed it ${type}`);
    split.type = type;
    lossless = false;
  } else if (root && !(ROOT_DIVISION_TYPES as ReadonlySet<string>).has(split.type)) {
    const type = fallback.type ?? "article";
    split.warnings.push(`frontmatter names ${split.type}, which cannot be a root; typed it ${type}`);
    split.type = type;
  }
  return { ...split, lossless };
}

/**
 * Whether `source` opens with an element that is the division's own: one of
 * the wrappers a division of its standing may have (`root`, see
 * {@link wrapperTypesFor}), carrying `ref` as its id -- `xml:id` on a PreTeXt
 * start tag, `\\label` after a LaTeX header or inside its environment.
 * Markdown frontmatter is always split, so never asked about.
 */
function opensWithOwnElement(
  source: string,
  sourceFormat: SourceFormat,
  ref: string,
  root: boolean,
): boolean {
  const types = wrapperTypesFor(root);
  if (sourceFormat === "pretext") {
    const start = nextTag(source, 0);
    if (!start || start.closing || !types.has(start.name)) return false;
    return readAttributes(source.slice(start.open, start.close))["xml:id"] === ref;
  }
  if (sourceFormat === "latex") {
    const header = parseLatexDivisionHeader(source);
    if (header) return types.has(header.macro) && header.label === ref;
    const env = LATEX_ENV_HEADER_RE.exec(source);
    if (!env || !types.has(env[1])) return false;
    const opening = source.slice(env[0].length, env[0].length + 512);
    return /^\s*(?:\\title\{[^}]*\}\s*)?\\label\{([^}]*)\}/.exec(opening)?.[1]?.trim() === ref;
  }
  return false;
}

/**
 * Whether `split` accounts for all of `source`: the element built back from
 * its fields around its body ({@link wrapDivisionSource}) reads the same as the
 * source once both are put in the canonical form of
 * {@link canonicalDivisionSource}, and no comment went missing between them.
 * For a source with no element, the body (and a PreTeXt fragment's leading
 * `<title>`) must read as the source.
 */
function splitAccountsForSource(
  source: string,
  sourceFormat: SourceFormat,
  split: RawSplit,
): boolean {
  let rebuilt: string;
  if (split.wrapped) {
    rebuilt = wrapDivisionSource({
      xmlId: split.xmlId,
      type: split.type,
      title: split.title,
      attrs: split.attrs,
      sourceFormat,
      source: split.body,
    });
  } else if (sourceFormat === "pretext" && split.title) {
    rebuilt = `<title>${split.title}</title>\n${split.body}`;
  } else {
    rebuilt = split.body;
  }
  if (canonicalDivisionSource(rebuilt, sourceFormat) !== canonicalDivisionSource(source, sourceFormat)) {
    return false;
  }
  if (sourceFormat !== "pretext") return true;
  // Comments are compared apart because a split may move one (from outside the
  // element to inside it) but must never lose one.
  const comments = (xml: string) => (xml.match(XML_COMMENT_RE) ?? []).map((c) => c.trim()).sort();
  const before = comments(source);
  const after = comments(rebuilt);
  return before.length === after.length && before.every((c, i) => c === after[i]);
}

/**
 * A PreTeXt start tag with its attributes read and written back in a fixed
 * order and quoting, less any `label`. Attribute values may not hold `>`, so a
 * tag is the run from `<` to the next `>`.
 */
const START_TAG_RE = /<([A-Za-z_][\w.:-]*)([^<>]*?)(\/?)>/g;

/** A LaTeX division written as an environment, to rewrite in the header style. */
const LATEX_ENV_DIVISION_RE =
  /^\s*\\begin\{([A-Za-z][A-Za-z-]*)\}\s*(?:\\title\{([^}]*)\}\s*)?(?:\\label\{([^}]*)\}\s*)?([\s\S]*?)\\end\{\1\}\s*$/;

/**
 * `text` with everything a split is allowed to change taken out, so that a
 * source and the element rebuilt from its split can be compared for anything
 * else: whitespace runs (and whitespace against markup) collapse; a PreTeXt
 * start tag has its attributes sorted and requoted and its `label` dropped,
 * and comments, an XML declaration and empty `<title>`s go; a LaTeX division
 * environment is written as its header; Markdown frontmatter is reduced to its
 * sorted `key: value` lines, unquoted, with `label` and empty values dropped.
 */
function canonicalDivisionSource(text: string, sourceFormat: SourceFormat): string {
  let s = text;
  if (sourceFormat === "pretext") {
    s = s
      .replace(XML_COMMENT_RE, "")
      .replace(XML_DECLARATION_RE, "")
      .replace(/<title\s*\/>|<title>\s*<\/title>/g, "")
      .replace(START_TAG_RE, (whole, name: string, attrText: string, slash: string) => {
        if (name.startsWith("/") || name.startsWith("?") || name.startsWith("!")) return whole;
        const pairs = [...attrText.matchAll(ATTR_RE)]
          .filter((m) => m[1] !== "label")
          .map((m): [string, string] => [m[1], unescapeAttribute(m[2] ?? m[3] ?? "")])
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const attrs = pairs.map(([n, v]) => ` ${n}="${escapeAttribute(v)}"`).join("");
        return `<${name}${attrs}${slash}>`;
      });
  } else if (sourceFormat === "latex") {
    s = s.replace(
      LATEX_ENV_DIVISION_RE,
      (_whole, env: string, title = "", label: string | undefined, body: string) =>
        `\\${env}{${title}}${label ? `\\label{${label}}` : ""}\n${body}`,
    );
  } else {
    const m = MARKDOWN_FRONTMATTER_RE.exec(s);
    if (m) {
      const lines = m[1]
        .split(/\r?\n/)
        .filter((line) => /\S/.test(line))
        .map((line) => {
          const kv = FRONTMATTER_KEY_VALUE_RE.exec(line);
          if (!kv) return line.trim();
          const key = kv[1] === "xmlid" || kv[1] === "xml:id" ? "id" : kv[1];
          const value = unquoteYamlValue(kv[2]);
          return key === "label" || value === "" ? "" : `${key}: ${value}`;
        })
        .filter((line) => line !== "")
        .sort();
      s = `---\n${lines.join("\n")}\n---\n${s.slice(m[0].length)}`;
    }
  }
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*([<>])\s*/g, "$1")
    .trim();
}
/**
 * `xml:id`, `label` and every other attribute, as a start tag writes them.
 * Both of the first two are the division's ref: it is the one name a division
 * has, so its `@label` (PreTeXt's stable name for it across builds) is the
 * same.
 */
function divisionAttributeString(d: DivisionElementFields): string {
  const pairs: [string, string][] = [];
  if (d.xmlId) pairs.push(["xml:id", d.xmlId], ["label", d.xmlId]);
  for (const [name, value] of Object.entries(d.attrs ?? {})) {
    if (name !== "xml:id" && name !== "label") pairs.push([name, value]);
  }
  return pairs.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
}

/**
 * The text a division's element adds around its body, in its own format:
 * `before` is the PreTeXt start tag and `<title>`, the LaTeX header line, or
 * the Markdown frontmatter; `after` is the PreTeXt end tag (empty otherwise).
 * {@link wrapDivisionSource} joins them to the body; the code editor shows
 * them as read-only lines around it.
 */
export function divisionHeaderParts(d: DivisionElementFields): {
  before: string;
  after: string;
} {
  switch (d.sourceFormat) {
    case "latex":
      if (LATEX_HEADERLESS_TYPES.has(d.type)) return { before: "", after: "" };
      return {
        before: `${buildLatexDivisionHeader({ macro: d.type, title: d.title, label: d.xmlId })}\n\n`,
        after: "",
      };
    case "markdown":
      return {
        before: `${buildMarkdownFrontmatter({
          type: d.type,
          xmlId: d.xmlId,
          title: d.title,
          attrs: d.attrs,
        })}\n\n`,
        after: "",
      };
    default: {
      const title = d.title ? `<title>${d.title}</title>\n` : "";
      return {
        before: `<${d.type}${divisionAttributeString(d)}>\n${title}`,
        after: `\n</${d.type}>`,
      };
    }
  }
}

/**
 * {@link divisionHeaderParts} as the lines the code editor draws, read-only,
 * around a division's body — without the blank separator lines, which are
 * the converter's business rather than anything to show.
 */
export function divisionWrapperLines(d: DivisionElementFields): {
  before: string[];
  after: string[];
} {
  const { before, after } = divisionHeaderParts(d);
  const lines = (text: string) =>
    text.split("\n").filter((line) => line.trim() !== "");
  return { before: lines(before), after: lines(after) };
}

/**
 * A division's complete source in its own format — its body with the element
 * built from its fields around it (see {@link divisionHeaderParts}). This is
 * what the converters are handed: a Markdown division's frontmatter decides
 * more than its wrapper (a slideshow's `##` means a slide; a title shifts every
 * heading down a level), so converting the bare body would not be the same
 * document.
 */
export function wrapDivisionSource(d: Division): string {
  const { before, after } = divisionHeaderParts(d);
  const body =
    d.sourceFormat === "pretext" ? d.source : d.source.replace(/^(?:[ \t]*\r?\n)+/, "");
  return `${before}${body}${after}`;
}

/**
 * A division's title as plain text, for the TOC and the title bar: markup
 * stripped from a PreTeXt title, LaTeX/Markdown titles shown as written.
 */
export function displayTitle(d: Pick<Division, "title" | "sourceFormat">): string {
  if (d.sourceFormat !== "pretext") return d.title.trim();
  return unescapeAttribute(d.title.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
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
    if (!name) {
      // A `<` that opens no tag -- `x < y` in prose -- is text, not the end of
      // the markup.
      i = open + 1;
      continue;
    }
    const close = tagEnd(xml, open);
    if (close === -1) return undefined;
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
 * wrong answer: the stored source — the division *wrapped*, so a title or type
 * edit counts as a change too — must equal the division's current one for the
 * entry to be used at all.
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

/** A LaTeX/Markdown fragment converted to PreTeXt, or the failure as a comment. */
function convertFragment(source: string, sourceFormat: SourceFormat, what: string): string {
  const { pretextSource, pretextError } = derivePretextContent(source, sourceFormat);
  return pretextSource ?? `<!-- conversion error: ${what}: ${pretextError} -->`;
}

/**
 * A LaTeX title converted to PreTeXt inline markup: the converter makes a
 * paragraph of anything it is given, so the `<p>` around it is taken off.
 */
function convertLatexTitle(title: string): string {
  const xml = derivePretextContent(title, "latex").pretextSource ?? title;
  return /^\s*<p>\s*([\s\S]*?)\s*<\/p>\s*$/.exec(xml)?.[1] ?? xml.trim();
}

/**
 * `xml` with the division's own attributes set on its first element — the
 * converters' output carries whatever the synthesized header could say, and
 * neither header spells the `@label` (LaTeX's `\label` is the `xml:id`), so
 * the record's values -- its ref as both -- are written over it here.
 */
function setDivisionAttributes(xml: string, d: DivisionElementFields): string {
  const tag = nextTag(xml, 0);
  if (!tag || tag.closing) return xml;
  const attrs: PlaceholderAttr[] = [];
  if (d.xmlId) {
    attrs.push(
      { name: "xml:id", value: escapeAttribute(d.xmlId) },
      { name: "label", value: escapeAttribute(d.xmlId) },
    );
  }
  for (const [name, value] of Object.entries(d.attrs ?? {})) {
    if (name !== "xml:id" && name !== "label") {
      attrs.push({ name, value: escapeAttribute(value) });
    }
  }
  return (
    xml.slice(0, tag.open) +
    setAttributes(xml.slice(tag.open, tag.close), tag.selfClosing, attrs) +
    xml.slice(tag.close)
  );
}

/**
 * A LaTeX division's PreTeXt. Its header (`\section{…}\label{…}`) is
 * converted along with the body, exactly as the author's own LaTeX would be,
 * so the title's math and macros come out as the converter writes them. A
 * type with no header command (an introduction), or one the converter does not
 * recognise as a header, instead has its body converted alone and the element
 * built around that.
 */
function latexDivisionToPretext(d: Division): string {
  if (!LATEX_HEADERLESS_TYPES.has(d.type)) {
    const xml = convertFragment(wrapDivisionSource(d), "latex", d.xmlId);
    if (nextTag(xml, 0)?.name === d.type) return setDivisionAttributes(xml, d);
  }
  const body = convertFragment(d.source, "latex", d.xmlId);
  const title = d.title ? `<title>${convertLatexTitle(d.title)}</title>\n` : "";
  return `<${d.type}${divisionAttributeString(d)}>\n${title}${body}\n</${d.type}>`;
}

/**
 * A division's own PreTeXt XML, its element included: built from its fields
 * around its body when it is PreTeXt, and the converter's output for its
 * wrapped source when it is LaTeX or Markdown. Conversion failures come back
 * as an XML comment, so one bad division never takes the surrounding document
 * down with it.
 *
 * Conversions are cached because assembly walks the *whole* project on every
 * keystroke, while only the division being typed in has actually changed.
 * Re-converting the other divisions each time cost 18s per keystroke on an
 * 870KB LaTeX book; with the cache it is the ~25ms of converting the one that
 * changed.
 */
export function divisionToPretext(division: Division): string {
  if (division.sourceFormat === "pretext") return wrapDivisionSource(division);

  const wrapped = wrapDivisionSource(division);
  const cached = conversionCache.get(division.xmlId);
  if (cached && cached.source === wrapped) return cached.xml;

  const xml =
    division.sourceFormat === "markdown"
      ? setDivisionAttributes(convertFragment(wrapped, "markdown", division.xmlId), division)
      : latexDivisionToPretext(division);

  if (conversionCache.size >= CONVERSION_CACHE_LIMIT) conversionCache.clear();
  conversionCache.set(division.xmlId, { source: wrapped, xml });
  return xml;
}

// ---------------------------------------------------------------------------
// Placeholder attribute pass-through
// ---------------------------------------------------------------------------

/**
 * One XML attribute, as written in the source.
 *
 * `value` is the raw text between the quotes — already XML-escaped, since it
 * came out of an attribute in real markup — so it is copied through verbatim
 * rather than re-escaped, which is what preserves an authored `&amp;`.
 */
interface PlaceholderAttr {
  name: string;
  value: string;
}

/**
 * A single `name="value"` (or `name='value'`) attribute. Scanned linearly, so
 * a `foo="..."` sequence sitting *inside* another attribute's value is
 * consumed as part of that value and can never be mistaken for an attribute
 * of its own.
 */
const ATTR_RE = /([A-Za-z_:][-\w.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Attribute names a `<plus:*>` placeholder consumes itself, and which
 * therefore must not be copied onto the element that replaces it. `ref` names
 * the record being included, and `instance` names this placement of it (see
 * {@link qualifyIdentifiers}); neither has a meaning in real PreTeXt.
 */
const PLACEHOLDER_OWN_ATTRS: ReadonlySet<string> = new Set(["ref", "instance"]);

/**
 * Every attribute of a `<plus:*>` placeholder that belongs to the *element it
 * resolves to* rather than to the placeholder itself — i.e. all of them but
 * `ref` and `instance`.
 *
 * This is deliberately a blanket rule rather than a list of known attributes.
 * `@component`, `@width`, `@xml:lang` and whatever PreTeXt adds next are all
 * the same kind of fact: a property of *this inclusion*, not of the included
 * record, which is exactly what cannot be stored on the record itself when
 * one division/asset/snippet is embedded in more than one place.
 */
function parsePlaceholderAttrs(attrs: string): PlaceholderAttr[] {
  const out: PlaceholderAttr[] = [];
  for (const m of attrs.matchAll(ATTR_RE)) {
    const name = m[1];
    if (PLACEHOLDER_OWN_ATTRS.has(name)) continue;
    out.push({ name, value: m[2] ?? m[3] ?? "" });
  }
  return out;
}

/** The placeholder's `instance` name, or undefined when it has none. */
function placeholderInstance(attrs: string): string | undefined {
  for (const m of attrs.matchAll(ATTR_RE)) {
    if (m[1] === "instance") return (m[2] ?? m[3] ?? "").trim() || undefined;
  }
  return undefined;
}

/**
 * `name="value"`, falling back to single quotes for a value that came from a
 * single-quoted attribute and contains a `"` of its own.
 */
function renderAttr({ name, value }: PlaceholderAttr): string {
  return value.includes('"') ? `${name}='${value}'` : `${name}="${value}"`;
}

/**
 * `startTag` with each of `attrs` set on it: an attribute the tag already
 * carries has its value replaced, one it doesn't is appended before the tag's
 * own `>` or `/>`.
 *
 * Replacing rather than appending matters — a duplicated attribute is not
 * well-formed XML and would fail the build rather than being ignored. The
 * placeholder wins the collision: it is the more local statement, written at
 * the point of inclusion by an author who can see the context, where the
 * attribute on the record applies to every other inclusion too.
 */
function setAttributes(
  startTag: string,
  selfClosing: boolean,
  attrs: PlaceholderAttr[],
): string {
  const existing = new Map<string, { start: number; end: number }>();
  for (const m of startTag.matchAll(ATTR_RE)) {
    if (m.index === undefined) continue;
    if (!existing.has(m[1])) {
      existing.set(m[1], { start: m.index, end: m.index + m[0].length });
    }
  }

  const appended: PlaceholderAttr[] = [];
  const replaced: { start: number; end: number; text: string }[] = [];
  for (const attr of attrs) {
    const span = existing.get(attr.name);
    if (span) replaced.push({ ...span, text: renderAttr(attr) });
    else appended.push(attr);
  }

  // Right-to-left, so each splice leaves the offsets of the ones still to come
  // pointing at the same characters they did before.
  let tag = startTag;
  for (const { start, end, text } of replaced.sort((a, b) => b.start - a.start)) {
    tag = tag.slice(0, start) + text + tag.slice(end);
  }
  if (appended.length === 0) return tag;

  const insertAt = tag.length - (selfClosing ? 2 : 1);
  const extra = appended.map((a) => ` ${renderAttr(a)}`).join("");
  return tag.slice(0, insertAt) + extra + tag.slice(insertAt);
}

/**
 * Copy `attrs` onto every *top-level* element of `xml` — the general form of
 * "pass a placeholder's attributes to the thing that replaces it".
 *
 * A division or an asset always resolves to exactly one element, so for those
 * "every top-level element" is just its root. A snippet is the case that
 * makes the plural necessary: it resolves to a fragment that may have several
 * siblings at the top, and there is no single tag to hang the attribute on.
 * Applying to each is right for `@component` — the author means "leave all of
 * this out" — and merely redundant for anything else, which is a better
 * failure than silently dropping the attribute.
 *
 * Nested elements are skipped over wholesale, so a `@component` on an include
 * lands on the division and not on every paragraph inside it.
 *
 * A resolution failure comes back as an XML comment (`<!-- missing division:
 * x -->`) with no element in it at all. {@link nextTag} skips comments, so
 * that case falls out as an untouched pass-through rather than needing a
 * guard of its own.
 */
function applyPlaceholderAttrs(xml: string, attrs: PlaceholderAttr[]): string {
  if (attrs.length === 0) return xml;

  let out = "";
  let copied = 0; // everything before this index is already in `out`
  let i = 0;
  for (;;) {
    const tag = nextTag(xml, i);
    if (!tag || tag.closing) break;

    out +=
      xml.slice(copied, tag.open) +
      setAttributes(xml.slice(tag.open, tag.close), tag.selfClosing, attrs);
    copied = tag.close;
    i = tag.close;
    if (tag.selfClosing) continue;

    // Skip this element's whole subtree to reach its next sibling.
    let depth = 1;
    while (depth > 0) {
      const inner = nextTag(xml, i);
      if (!inner) return out + xml.slice(copied); // unbalanced: stop rewriting
      i = inner.close;
      if (inner.closing) depth--;
      else if (!inner.selfClosing) depth++;
    }
  }
  return out + xml.slice(copied);
}

/**
 * Elements whose content is not PreTeXt — a generator's input (`<diagram>` and
 * its own vocabulary) or drawing code. Their start tag is PreTeXt and carries
 * the image's `@label`, but nothing inside them is an identifier of the
 * document's, so {@link qualifyIdentifiers} leaves their insides alone.
 */
const OPAQUE_ELEMENTS: ReadonlySet<string> = new Set([
  "prefigure",
  "latex-image",
  "sageplot",
  "asymptote",
  "mermaid",
]);

/** Attributes that give an element an identity PreTeXt requires to be unique. */
const IDENTIFIER_ATTRS: ReadonlySet<string> = new Set(["xml:id", "label"]);

/** Attributes that point at an identity: an `<xref>`'s `@ref`, `@first`, `@last`. */
const REFERENCE_ATTRS: ReadonlySet<string> = new Set(["ref", "first", "last"]);

/**
 * The identifier `id` takes inside the placement named `instance`. Refs never
 * contain anything but letters, digits, `-` and `_`, and neither may an
 * instance name, so the result is itself a valid ref-shaped label.
 */
export function qualifiedIdentifier(id: string, instance: string): string {
  return `${id}-${instance}`;
}

/**
 * `xml` with `rewrite` applied to every start tag, in document order, except
 * those inside an {@link OPAQUE_ELEMENTS} element (whose own start tag is
 * still rewritten). An opaque element's end is found by its closing tag's
 * text rather than by counting tags: its contents may be LaTeX, where `a<b`
 * is no tag at all.
 */
function rewriteStartTags(xml: string, rewrite: (startTag: string) => string): string {
  let out = "";
  let copied = 0;
  let i = 0;
  for (;;) {
    const tag = nextTag(xml, i);
    if (!tag) break;
    i = tag.close;
    if (tag.closing) continue;
    out += xml.slice(copied, tag.open) + rewrite(xml.slice(tag.open, tag.close));
    copied = tag.close;
    const localName = tag.name.slice(tag.name.indexOf(":") + 1);
    if (tag.selfClosing || !OPAQUE_ELEMENTS.has(localName)) continue;
    const end = xml.indexOf(`</${tag.name}`, tag.close);
    if (end === -1) break; // unbalanced: leave the rest as it is
    i = end;
  }
  return out + xml.slice(copied);
}

/** `startTag` with the value of each attribute named in `names` mapped through `map`. */
function rewriteAttrValues(
  startTag: string,
  names: ReadonlySet<string>,
  map: (value: string) => string,
): string {
  return startTag.replace(ATTR_RE, (whole, name: string, dq?: string, sq?: string) => {
    if (!names.has(name)) return whole;
    const value = map(dq ?? sq ?? "");
    return renderAttr({ name, value });
  });
}

/**
 * Make one placement of an included record's identifiers its own, for a
 * placeholder that names its `instance`: every `@xml:id` and `@label` in the
 * resolved markup becomes {@link qualifiedIdentifier}`(id, instance)`, and
 * every `@ref`/`@first`/`@last` inside it that pointed at one of those follows
 * — so a snippet's xref to its own theorem stays inside the same placement,
 * while one pointing outside is untouched.
 *
 * PreTeXt requires both attributes to be unique across the document (its
 * assembly reports a duplicate as an error), and a generated image's `@label`
 * is also its output filename, so a record placed twice must not carry the
 * same ones twice. Its unnamed placement keeps the record's own identifiers;
 * every other placement is named in the source, which is what keeps these
 * stable: a label never changes because something was placed earlier.
 *
 * Applied to fully resolved markup, so identifiers of records nested inside
 * (an image in a snippet) are qualified too, by every enclosing instance.
 */
export function qualifyIdentifiers(xml: string, instance: string): string {
  const renamed = new Set<string>();
  const qualified = rewriteStartTags(xml, (tag) =>
    rewriteAttrValues(tag, IDENTIFIER_ATTRS, (id) => {
      renamed.add(id);
      return qualifiedIdentifier(id, instance);
    }),
  );
  if (renamed.size === 0) return qualified;
  // A reference may name several targets, separated by commas or spaces.
  return rewriteStartTags(qualified, (tag) =>
    rewriteAttrValues(tag, REFERENCE_ATTRS, (value) =>
      value.replace(/[^\s,]+/g, (id) => (renamed.has(id) ? qualifiedIdentifier(id, instance) : id)),
    ),
  );
}

/**
 * Scan `xml` for every `<plus:* ref="..."/>` placeholder and expand each one:
 * `image` resolves against `assets`, `snippet` resolves (recursively —
 * see {@link resolveSnippetRef}) against `snippets`, and anything else is
 * treated as a division ref and resolved via {@link resolveDivisionXml}.
 *
 * A placeholder naming its `instance` then has the identifiers in that markup
 * made its own (see {@link qualifyIdentifiers}), and every other attribute of
 * the placeholder *except* `ref` is copied onto the markup that replaces it
 * (see {@link applyPlaceholderAttrs}) — that is how a `@component` reaches a
 * division that is included by reference rather than written inline, and how
 * an `<image>` gets its per-embedding `@width`.
 *
 * The copy happens here, on the resolved output, rather than anywhere inside
 * resolution: `divisionToPretext` caches its conversion per `xml:id`, so
 * attributes baked in before that point would be shared by every reference to
 * the same division instead of belonging to one include.
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
      const resolved =
        tag === "image"
          ? resolveAssetRef(ref, assets)
          : tag === "snippet"
            ? resolveSnippetRef(ref, snippets, divisions, assets, ancestors)
            : resolveDivisionXml(ref, divisions, snippets, assets, ancestors);
      const instance = placeholderInstance(attrs);
      const placed = instance ? qualifyIdentifiers(resolved, instance) : resolved;
      return applyPlaceholderAttrs(placed, parsePlaceholderAttrs(attrs));
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
 * The line every build's `<latex-image-preamble>` starts with, so a TikZ
 * `<latex-image>` builds without its author first having to find the docinfo
 * editor and load the package there. An author who loads it anyway loses
 * nothing: a second `\usepackage` of the same package is a no-op.
 */
export const DEFAULT_LATEX_IMAGE_PREAMBLE = "\\usepackage{tikz, pgf}";

const SYNTAX_ATTR_RE = /\ssyntax\s*=/;

/**
 * `docinfo` with {@link DEFAULT_LATEX_IMAGE_PREAMBLE} as the first line of its
 * `<latex-image-preamble>`, adding that element — or the whole `<docinfo>` —
 * when there isn't one.
 *
 * PreTeXt reads only the first `<latex-image-preamble>` without `@syntax`
 * (the `latex-image-preamble` variable in pretext-common.xsl), so that is the
 * one written to; one with `@syntax` belongs to some other image language.
 * Prepended rather than appended so the author's own `\usetikzlibrary` and
 * `\tikzset` lines find TikZ already loaded.
 *
 * A splice rather than a parse, like {@link ensureRootLabel}, so the author's
 * docinfo reaches the build unchanged apart from the one line. A docinfo the
 * scanner cannot make sense of is returned as it came: it will fail the build
 * on its own terms, and this should not be what reports it.
 */
function withDefaultLatexImagePreamble(docinfo: string): string {
  const element = `<latex-image-preamble>\n${DEFAULT_LATEX_IMAGE_PREAMBLE}\n</latex-image-preamble>`;
  if (!docinfo.trim()) return `<docinfo>\n  ${element}\n</docinfo>`;

  const root = nextTag(docinfo, 0);
  if (!root || root.closing || root.name !== "docinfo") return docinfo;
  if (root.selfClosing) {
    const openTag = `${docinfo.slice(root.open, root.close - 2).trimEnd()}>`;
    return (
      docinfo.slice(0, root.open) +
      `${openTag}\n  ${element}\n</docinfo>` +
      docinfo.slice(root.close)
    );
  }

  // Walk <docinfo>'s direct children, skipping each one's whole subtree.
  let i = root.close;
  for (;;) {
    const tag = nextTag(docinfo, i);
    if (!tag) return docinfo;
    if (tag.closing) {
      // </docinfo>, with no preamble in it: add one.
      const lead = docinfo[tag.open - 1] === "\n" ? "" : "\n";
      return docinfo.slice(0, tag.open) + `${lead}  ${element}\n` + docinfo.slice(tag.open);
    }
    const startTag = docinfo.slice(tag.open, tag.close);
    if (tag.name === "latex-image-preamble" && !SYNTAX_ATTR_RE.test(startTag)) {
      if (tag.selfClosing) {
        const openTag = `${startTag.slice(0, -2).trimEnd()}>`;
        return (
          docinfo.slice(0, tag.open) +
          `${openTag}\n${DEFAULT_LATEX_IMAGE_PREAMBLE}\n</latex-image-preamble>` +
          docinfo.slice(tag.close)
        );
      }
      return (
        docinfo.slice(0, tag.close) +
        `\n${DEFAULT_LATEX_IMAGE_PREAMBLE}\n` +
        docinfo.slice(tag.close)
      );
    }
    i = tag.close;
    if (tag.selfClosing) continue;
    let depth = 1;
    while (depth > 0) {
      const inner = nextTag(docinfo, i);
      if (!inner) return docinfo;
      i = inner.close;
      if (inner.closing) depth--;
      else if (!inner.selfClosing) depth++;
    }
  }
}

/**
 * Wrap a resolved document body in the outer `<pretext>` element with
 * `<docinfo>` inserted as its sibling, matching real PreTeXt document shape.
 * The docinfo always carries {@link DEFAULT_LATEX_IMAGE_PREAMBLE}, so every
 * document a build is handed has one even when the author wrote none.
 * `lang`, when provided (a BCP-47 code like `"en-US"`), is written as
 * `@xml:lang` on the root `<pretext>` element.
 */
function wrapInPretextDocument(body: string, docinfo: string, lang?: string): string {
  const docinfoBlock = `${withDefaultLatexImagePreamble(docinfo.trim())}\n`;
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

/** The `<title>` of the article an untitled snippet is previewed inside of. */
export const SNIPPET_PREVIEW_TITLE = "snippet preview";

/** The title a snippet's preview article carries: its own, or the default. */
export function snippetPreviewTitle(snippet: Pick<Snippet, "title"> | undefined): string {
  return snippet?.title?.trim() || SNIPPET_PREVIEW_TITLE;
}

/**
 * A complete PreTeXt document for previewing one snippet on its own: the
 * snippet resolved exactly as an embed of it would be (converted from
 * LaTeX/Markdown, its own `<plus:* ref/>` placeholders expanded — see
 * {@link resolveSnippetRef}), injected into a plain `<article>` titled after
 * the snippet ({@link snippetPreviewTitle}), and wrapped in `<pretext>` with `docinfo`,
 * like a division preview.
 */
export function assembleSnippetPreviewSource(
  snippetRef: string,
  divisions: Division[],
  snippets: Snippet[],
  assets: Asset[],
  docinfo: string,
  lang?: string,
): string {
  const body = resolveSnippetRef(snippetRef, snippets, divisions, assets, new Set());
  // A snippet's title is plain text, so it is escaped into the element.
  const title = escapeText(snippetPreviewTitle(snippets.find((s) => s.ref === snippetRef)));
  return wrapInPretextDocument(
    `<article>\n<title>${title}</title>\n${body}\n</article>`,
    docinfo,
    lang,
  );
}

// ---------------------------------------------------------------------------
// Initial-load normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a division pool right after it arrives from the host, before it's
 * seeded into the store as the editing buffer.
 *
 * A division's type and title are fields of its record, but a host need not
 * have stored a type for every division — so one that arrives without gets
 * the root's `projectType` (an `"article"` if that is unknown too) or, for any
 * other division, `"section"`. Nothing is read out of, or written into, a
 * division's source.
 */
export function normalizeDivisionsOnLoad(
  divisions: Division[],
  rootDivisionId: string | undefined,
  projectType: RootDivisionType | undefined,
): Division[] {
  return divisions.map((division) => {
    if (division.type && typeof division.title === "string") return division;
    const isRoot = division.xmlId === rootDivisionId;
    // Checked rather than cast: `projectType` comes from the host, which may be
    // untyped JavaScript, and this value is written straight into a tag name.
    const fallback: DivisionType = isRoot
      ? isRootDivisionType(projectType)
        ? projectType
        : "article"
      : "section";
    return {
      ...division,
      type: division.type || fallback,
      title: division.title ?? "",
    };
  });
}

