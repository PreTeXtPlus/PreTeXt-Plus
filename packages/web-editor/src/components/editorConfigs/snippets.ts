/**
 * The Insert menu's catalog: one list of constructs an author actually reaches
 * for, written out in each source format.
 *
 * The catalog is deliberately *shared*. A construct has one key, one label and
 * one description no matter which format is open, and only its `body` changes —
 * so "Theorem" means the same thing, sits in the same group and reads the same
 * way whether the buffer is PreTeXt, LaTeX or Markdown. That is the whole point
 * of the structure: consistency is enforced by construction rather than by
 * three menus that have to be kept in step by hand.
 *
 * A format simply omits a key its converter cannot handle, and the menu drops
 * the row. Markdown has no table, image or link support in
 * `@pretextbook/remark-pretext` yet (they convert to `<TODO>` placeholders), so
 * Markdown offers no Table, Figure, Cross-reference or Link — offering them
 * would hand the author markup that silently fails to convert. The tests in
 * `__tests__/snippets.test.ts` run every body through the real converter (and
 * the real schema, for PreTeXt) so this file cannot drift away from what the
 * pipeline accepts.
 *
 * Bodies are Monaco snippet text: `$1`, `${1:placeholder}` and `$0` are tab
 * stops, numbered top to bottom with `$0` on the field the author fills in
 * last. Monaco's snippet parser treats a backslash as an escape only before
 * `$`, `\` and `}`, so ordinary LaTeX macros (`\begin`, `\emph`) need no
 * quoting — but a literal `$` or a LaTeX `\\` line break does, hence the two
 * constants below.
 */
import type { SourceFormat } from "../../types/editor";

/** A literal `$`; a bare one would open a tab stop. */
const DOLLAR = "\\$";

/** A literal LaTeX `\\` row break: Monaco unescapes each `\\` to one `\`. */
const ROW_BREAK = "\\\\\\\\";

/** Joins body lines, so the snippets below read as the text they insert. */
const lines = (...parts: string[]): string => parts.join("\n");

/**
 * Where a construct may sit relative to a `<p>`.
 *
 * PreTeXt is strict in both directions: every inline element, every list and
 * displayed math must be *inside* a paragraph, while a theorem, a figure or a
 * `<p>` itself must not be. A body is therefore written bare — no wrapper — and
 * the wrapper (or the escape from one) is decided against the cursor's actual
 * surroundings at insert time; see `insertContext.ts`.
 *
 * This describes the construct in PreTeXt's content model, which is what the
 * other two formats convert *into*, so it is a property of the catalog entry
 * rather than of one format's body. It is only consulted while the buffer being
 * edited is PreTeXt: LaTeX and Markdown have no `<p>` to be inside or outside
 * of, and their bodies are inserted as written.
 */
export type SnippetPlacement = "in-paragraph" | "block";

/** One insertable construct, in one format. */
export interface EditorSnippet {
  /** Stable identity — the same construct carries the same key in every format. */
  key: string;
  /** Menu label. Format-independent, on purpose. */
  label: string;
  /** One-line description, shown as the item's tooltip. */
  detail: string;
  /** Monaco snippet text for the active format. */
  body: string;
  /** Whether this construct belongs inside a paragraph or beside one. */
  placement: SnippetPlacement;
}

/** A labelled section of the Insert menu. */
export interface SnippetGroup {
  key: string;
  label: string;
  snippets: EditorSnippet[];
}

/** The groups, in menu order. */
const GROUPS = [
  { key: "text", label: "Text" },
  { key: "blocks", label: "Blocks" },
  { key: "lists", label: "Lists" },
  { key: "math", label: "Math" },
  { key: "figures", label: "Figures & Code" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

/** What a construct is, independent of how any one format spells it. */
interface SnippetSpec {
  key: string;
  label: string;
  detail: string;
  group: GroupKey;
  placement: SnippetPlacement;
}

const CATALOG: SnippetSpec[] = [
  {
    key: "paragraph",
    label: "Paragraph",
    detail: "A paragraph of prose.",
    group: "text",
    placement: "block",
  },
  {
    key: "emphasis",
    label: "Emphasis",
    detail: "Emphasized text — converts to <em>.",
    group: "text",
    placement: "in-paragraph",
  },
  {
    key: "term",
    label: "Term",
    detail: "A term being defined — converts to <term>.",
    group: "text",
    placement: "in-paragraph",
  },
  {
    key: "code-inline",
    label: "Inline code",
    detail: "Code inside a sentence — converts to <c>.",
    group: "text",
    placement: "in-paragraph",
  },
  {
    key: "xref",
    label: "Cross-reference",
    detail: "A reference to another numbered item — converts to <xref>.",
    group: "text",
    placement: "in-paragraph",
  },
  {
    key: "link",
    label: "Link",
    detail: "A link to an external page — converts to <url>.",
    group: "text",
    placement: "in-paragraph",
  },
  {
    key: "theorem",
    label: "Theorem",
    detail: "A theorem with a statement and a proof.",
    group: "blocks",
    placement: "block",
  },
  {
    key: "definition",
    label: "Definition",
    detail: "A definition with a statement.",
    group: "blocks",
    placement: "block",
  },
  {
    key: "example",
    label: "Example",
    detail: "An example with a statement and a solution.",
    group: "blocks",
    placement: "block",
  },
  {
    key: "remark",
    label: "Remark",
    detail: "A short aside.",
    group: "blocks",
    placement: "block",
  },
  {
    key: "exercise",
    label: "Exercise",
    detail: "An exercise with a hint and a solution.",
    group: "blocks",
    placement: "block",
  },
  {
    key: "list-bulleted",
    label: "Bulleted list",
    detail: "An unordered list — converts to <ul>.",
    group: "lists",
    placement: "in-paragraph",
  },
  {
    key: "list-numbered",
    label: "Numbered list",
    detail: "An ordered list — converts to <ol>.",
    group: "lists",
    placement: "in-paragraph",
  },
  {
    key: "list-description",
    label: "Description list",
    detail: "A list of titled items — converts to <dl>.",
    group: "lists",
    placement: "in-paragraph",
  },
  {
    key: "math-inline",
    label: "Inline math",
    detail: "Mathematics inside a sentence — converts to <m>.",
    group: "math",
    placement: "in-paragraph",
  },
  {
    key: "math-display",
    label: "Displayed math",
    detail: "A displayed equation on its own line.",
    group: "math",
    placement: "in-paragraph",
  },
  {
    key: "math-aligned",
    label: "Aligned math",
    detail: "Several equations aligned on a relation.",
    group: "math",
    placement: "in-paragraph",
  },
  {
    key: "figure",
    label: "Figure",
    detail: "A captioned image.",
    group: "figures",
    placement: "block",
  },
  {
    key: "table",
    label: "Table",
    detail: "A titled table with a header row.",
    group: "figures",
    placement: "block",
  },
  {
    key: "program",
    label: "Code listing",
    detail: "A block of displayed code.",
    group: "figures",
    placement: "block",
  },
];

const PRETEXT_BODIES: Record<string, string> = {
  paragraph: "<p>$0</p>",
  emphasis: "<em>$0</em>",
  term: "<term>$0</term>",
  "code-inline": "<c>$0</c>",
  xref: '<xref ref="${1:xml-id}"/>',
  link: '<url href="${1:https://example.com}">$0</url>',
  theorem: lines(
    '<theorem xml:id="${1:thm-name}">',
    "\t<title>${2:Title}</title>",
    "\t<statement>",
    "\t\t<p>$3</p>",
    "\t</statement>",
    "\t<proof>",
    "\t\t<p>$0</p>",
    "\t</proof>",
    "</theorem>",
  ),
  definition: lines(
    '<definition xml:id="${1:def-name}">',
    "\t<title>${2:Title}</title>",
    "\t<statement>",
    "\t\t<p>$0</p>",
    "\t</statement>",
    "</definition>",
  ),
  example: lines(
    '<example xml:id="${1:ex-name}">',
    "\t<title>${2:Title}</title>",
    "\t<statement>",
    "\t\t<p>$3</p>",
    "\t</statement>",
    "\t<solution>",
    "\t\t<p>$0</p>",
    "\t</solution>",
    "</example>",
  ),
  remark: lines(
    '<remark xml:id="${1:rem-name}">',
    "\t<title>${2:Title}</title>",
    "\t<p>$0</p>",
    "</remark>",
  ),
  exercise: lines(
    '<exercise xml:id="${1:exer-name}">',
    "\t<statement>",
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<hint>",
    "\t\t<p>$3</p>",
    "\t</hint>",
    "\t<solution>",
    "\t\t<p>$0</p>",
    "\t</solution>",
    "</exercise>",
  ),
  // Lists and displayed math live *inside* a paragraph in PreTeXt — the schema
  // rejects them as a division's direct children — so they are written bare
  // here and {@link wrapInParagraph} supplies the `<p>` when the cursor isn't
  // already in one.
  "list-bulleted": lines(
    "<ul>",
    "\t<li>",
    "\t\t<p>$0</p>",
    "\t</li>",
    "</ul>",
  ),
  "list-numbered": lines(
    '<ol marker="1.">',
    "\t<li>",
    "\t\t<p>$0</p>",
    "\t</li>",
    "</ol>",
  ),
  "list-description": lines(
    "<dl>",
    "\t<li>",
    "\t\t<title>${1:Term}</title>",
    "\t\t<p>$0</p>",
    "\t</li>",
    "</dl>",
  ),
  "math-inline": "<m>$0</m>",
  // `<md>`, not `<me>`: the schema deprecates `<me>` in favour of an
  // `<mrow>`-less `<md>`, and the editor's own linter would flag it.
  "math-display": lines("<md>", "\t$0", "</md>"),
  // `\amp` rather than `&`, which XML would read as an entity start.
  "math-aligned": lines(
    "<md>",
    "\t<mrow>$1 \\amp= $2</mrow>",
    "\t<mrow>$0</mrow>",
    "</md>",
  ),
  figure: lines(
    '<figure xml:id="${1:fig-name}">',
    "\t<caption>${2:Caption}</caption>",
    '\t<plus:image ref="${3:image-ref}"/>',
    "</figure>",
  ),
  table: lines(
    '<table xml:id="${1:tab-name}">',
    "\t<title>${2:Title}</title>",
    "\t<tabular>",
    '\t\t<row header="yes">',
    "\t\t\t<cell>$3</cell>",
    "\t\t\t<cell>$4</cell>",
    "\t\t</row>",
    "\t\t<row>",
    "\t\t\t<cell>$5</cell>",
    "\t\t\t<cell>$0</cell>",
    "\t\t</row>",
    "\t</tabular>",
    "</table>",
  ),
  // `<code>` holds the source verbatim, so its content is not indented.
  program: lines(
    '<program language="${1:python}">',
    "\t<code>",
    "$0",
    "\t</code>",
    "</program>",
  ),
};

const LATEX_BODIES: Record<string, string> = {
  // No `paragraph`: a paragraph in LaTeX-style source is just prose between
  // blank lines, so there is nothing to insert.
  emphasis: "\\emph{$0}",
  term: "\\term{$0}",
  "code-inline": "\\code{$0}",
  xref: "\\ref{${1:label}}",
  link: "\\href{${1:https://example.com}}{$0}",
  theorem: lines(
    "\\begin{theorem}[${1:Title}]\\label{${2:thm-name}}",
    "\t$3",
    "\t\\begin{proof}",
    "\t\t$0",
    "\t\\end{proof}",
    "\\end{theorem}",
  ),
  definition: lines(
    "\\begin{definition}[${1:Title}]\\label{${2:def-name}}",
    "\t$0",
    "\\end{definition}",
  ),
  example: lines(
    "\\begin{example}[${1:Title}]\\label{${2:ex-name}}",
    "\t$3",
    "\t\\begin{solution}",
    "\t\t$0",
    "\t\\end{solution}",
    "\\end{example}",
  ),
  remark: lines(
    "\\begin{remark}[${1:Title}]\\label{${2:rem-name}}",
    "\t$0",
    "\\end{remark}",
  ),
  // No `[title]`: the converter reads a bracketed argument on an exercise as
  // body text rather than a title, so the title goes unset here.
  exercise: lines(
    "\\begin{exercise}\\label{${1:exer-name}}",
    "\t$2",
    "\t\\begin{hint}",
    "\t\t$3",
    "\t\\end{hint}",
    "\t\\begin{solution}",
    "\t\t$0",
    "\t\\end{solution}",
    "\\end{exercise}",
  ),
  "list-bulleted": lines("\\begin{itemize}", "\t\\item $0", "\\end{itemize}"),
  "list-numbered": lines("\\begin{enumerate}", "\t\\item $0", "\\end{enumerate}"),
  "math-inline": `${DOLLAR}$0${DOLLAR}`,
  "math-display": lines("\\[", "\t$0", "\\]"),
  "math-aligned": lines(
    "\\begin{align}",
    `\t$1 &= $2 ${ROW_BREAK}`,
    "\t$0",
    "\\end{align}",
  ),
  figure: lines(
    "\\begin{figure}",
    "\t\\plus{image}{${1:images/figure.png}}",
    "\t\\caption{$0}",
    "\\end{figure}",
  ),
  table: lines(
    "\\begin{table}",
    "\t\\caption{${1:Title}}",
    "\t\\begin{tabular}{${2:cc}}",
    `\t\t$3 & $4 ${ROW_BREAK}`,
    `\t\t$5 & $0 ${ROW_BREAK}`,
    "\t\\end{tabular}",
    "\\end{table}",
  ),
  // Verbatim: the body is emitted as written, so it is not indented.
  program: lines("\\begin{program}[${1:python}]", "$0", "\\end{program}"),
};

const MARKDOWN_BODIES: Record<string, string> = {
  // No `paragraph` (prose is prose), and no `term`, `xref`, `link`, `figure` or
  // `table`: the Markdown converter has no handler for those yet, and emits a
  // `<TODO>` placeholder instead of the element.
  emphasis: "*$0*",
  "code-inline": "`$0`",
  // Nested directives are fenced with one more colon than their children, so
  // the outer fence of a block that seeds a child uses four.
  theorem: lines(
    "::::theorem[${1:Title}]{#${2:thm-name}}",
    "$3",
    "",
    ":::proof",
    "$0",
    ":::",
    "::::",
  ),
  definition: lines(
    ":::definition[${1:Title}]{#${2:def-name}}",
    "$0",
    ":::",
  ),
  example: lines(
    "::::example[${1:Title}]{#${2:ex-name}}",
    "$3",
    "",
    ":::solution",
    "$0",
    ":::",
    "::::",
  ),
  remark: lines(":::remark[${1:Title}]", "$0", ":::"),
  exercise: lines(
    "::::exercise[${1:Title}]{#${2:exer-name}}",
    "$3",
    "",
    ":::hint",
    "$4",
    ":::",
    "",
    ":::solution",
    "$0",
    ":::",
    "::::",
  ),
  "list-bulleted": "- $0",
  "list-numbered": "1. $0",
  "math-inline": `${DOLLAR}$0${DOLLAR}`,
  "math-display": lines(`${DOLLAR}${DOLLAR}`, "$0", `${DOLLAR}${DOLLAR}`),
  "math-aligned": lines(
    `${DOLLAR}${DOLLAR}`,
    `$1 &= $2 ${ROW_BREAK}`,
    "$0",
    `${DOLLAR}${DOLLAR}`,
  ),
  program: lines("```${1:python}", "$0", "```"),
};

const BODIES: Record<SourceFormat, Record<string, string>> = {
  pretext: PRETEXT_BODIES,
  latex: LATEX_BODIES,
  markdown: MARKDOWN_BODIES,
};

/**
 * The Insert menu's contents for `format`: the shared catalog, in catalog
 * order, minus the constructs this format has no body for. Groups left empty
 * are dropped.
 */
export const snippetGroupsFor = (format: SourceFormat): SnippetGroup[] => {
  const bodies = BODIES[format];
  return GROUPS.map(({ key, label }) => ({
    key,
    label,
    snippets: CATALOG.filter(
      (spec) => spec.group === key && bodies[spec.key] !== undefined,
    ).map((spec) => ({
      key: spec.key,
      label: spec.label,
      detail: spec.detail,
      body: bodies[spec.key],
      placement: spec.placement,
    })),
  })).filter((group) => group.snippets.length > 0);
};

/**
 * An `in-paragraph` body as it has to be written when the cursor is *not*
 * already inside a paragraph: wrapped in a `<p>` of its own.
 *
 * A one-line body — every inline construct — stays on its line, so inserting an
 * emphasis into empty space gives `<p><em>…</em></p>` rather than three lines
 * for one phrase. A multiline body is indented inside the wrapper, matching how
 * the bodies above are written by hand.
 */
export const wrapInParagraph = (body: string): string =>
  body.includes("\n")
    ? lines("<p>", ...body.split("\n").map((line) => `\t${line}`), "</p>")
    : `<p>${body}</p>`;

/**
 * A snippet body as plain text: tab stops removed, placeholders reduced to
 * their default text, escapes unescaped. This is what the fallback insertion
 * path writes when Monaco's snippet controller is unavailable, and what the
 * tests feed to the converters.
 */
export const snippetPlainText = (body: string): string =>
  body
    // `${1:default}` → `default`, before the bare-tab-stop pass below. The
    // lookbehind is what keeps an escaped `\$` from reading as a tab stop.
    .replace(/(?<!\\)\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/(?<!\\)\$\{\d+\}/g, "")
    .replace(/(?<!\\)\$\d+/g, "")
    .replace(/\\([$\\}])/g, "$1");
