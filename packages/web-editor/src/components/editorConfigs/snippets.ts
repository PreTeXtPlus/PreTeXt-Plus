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
 * last. `${1|yes,no|}` is a stop that offers a choice, and a stop repeated
 * later in a body (`$3` after `${3:id}`) mirrors whatever is typed into the
 * first. Monaco's snippet parser treats a backslash as an escape only before
 * `$`, `\` and `}`, so ordinary LaTeX macros (`\begin`, `\emph`) need no
 * quoting — but a literal `$` or a LaTeX `\\` line break does, hence the two
 * constants below.
 */
import type { EditorLanguage } from "../../types/editor";
import type { RootDivisionType } from "../../types/sections";

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

/** A category of the Insert menu: one submenu. */
export interface SnippetGroup {
  key: string;
  label: string;
  /**
   * Which run of related groups this one belongs to. The menu draws a rule
   * wherever the section changes from one group to the next.
   */
  section: string;
  snippets: EditorSnippet[];
}

/** The groups, in menu order. */
const GROUPS = [
  // First because it is the structural container a deck is built out of, and
  // the one thing an author of one cannot get any other way — see the `slide`
  // entry below. Empty (and so dropped) for every non-slideshow project.
  { key: "slides", label: "Slides", section: "structure" },
  { key: "text", label: "Text", section: "prose" },
  { key: "lists", label: "Lists", section: "prose" },
  { key: "math", label: "Math", section: "prose" },
  // PreTeXt's families of blocks, under the names its documentation uses.
  { key: "definitions", label: "Definition-like", section: "blocks" },
  { key: "theorems", label: "Theorem-like", section: "blocks" },
  { key: "axioms", label: "Axiom-like", section: "blocks" },
  { key: "examples", label: "Example-like", section: "blocks" },
  { key: "remarks", label: "Remark-like", section: "blocks" },
  { key: "projects", label: "Project-like", section: "blocks" },
  { key: "exercises", label: "Exercises", section: "exercises" },
  { key: "interactive", label: "Interactive Exercises", section: "exercises" },
  { key: "figures", label: "Figures & Code", section: "figures" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

/** What a construct is, independent of how any one format spells it. */
interface SnippetSpec {
  key: string;
  label: string;
  detail: string;
  group: GroupKey;
  placement: SnippetPlacement;
  /**
   * Root elements this construct is legal under. Omitted means "any" — which is
   * true of everything except a slide, whose element only exists inside a
   * `<slideshow>`. Offering one in an article would hand the author markup the
   * schema rejects, for a menu item we put in front of them.
   */
  rootTypes?: RootDivisionType[];
}

/**
 * One member of a family of blocks that all take the same shape — a theorem
 * and a lemma differ only in their element's name. A member's key *is* that
 * name, in all three formats, which is what lets one writer per format
 * (`ptxStatement`, `texStatement`, …) produce the whole family's bodies.
 */
interface FamilyMember {
  key: string;
  label: string;
  detail: string;
  /** The stem of the `xml:id` (or label) the snippet suggests: `thm` → `thm-name`. */
  id: string;
}

const DEFINITION_LIKE: FamilyMember[] = [
  { key: "definition", label: "Definition", id: "def", detail: "A definition with a statement." },
];

const THEOREM_LIKE: FamilyMember[] = [
  { key: "theorem", label: "Theorem", id: "thm", detail: "A theorem with a statement and a proof." },
  { key: "lemma", label: "Lemma", id: "lem", detail: "A lemma with a statement and a proof." },
  { key: "corollary", label: "Corollary", id: "cor", detail: "A corollary with a statement and a proof." },
  { key: "proposition", label: "Proposition", id: "prop", detail: "A proposition with a statement and a proof." },
  { key: "claim", label: "Claim", id: "claim", detail: "A claim with a statement and a proof." },
  { key: "fact", label: "Fact", id: "fact", detail: "A fact with a statement and a proof." },
  { key: "identity", label: "Identity", id: "ident", detail: "An identity with a statement and a proof." },
  { key: "algorithm", label: "Algorithm", id: "alg", detail: "An algorithm with a statement and a proof of correctness." },
];

const AXIOM_LIKE: FamilyMember[] = [
  { key: "axiom", label: "Axiom", id: "ax", detail: "An axiom: a statement taken without proof." },
  { key: "conjecture", label: "Conjecture", id: "conj", detail: "A conjecture: a statement not yet proved." },
  { key: "principle", label: "Principle", id: "princ", detail: "A principle, stated without proof." },
  { key: "heuristic", label: "Heuristic", id: "heur", detail: "A heuristic, stated without proof." },
  { key: "hypothesis", label: "Hypothesis", id: "hyp", detail: "A hypothesis, stated without proof." },
  { key: "assumption", label: "Assumption", id: "assum", detail: "An assumption, stated without proof." },
];

const EXAMPLE_LIKE: FamilyMember[] = [
  { key: "example", label: "Example", id: "ex", detail: "An example with a statement and a solution." },
  { key: "problem", label: "Problem", id: "prob", detail: "A worked problem with a statement and a solution." },
  { key: "question", label: "Question", id: "quest", detail: "A question with a statement and a solution." },
];

const REMARK_LIKE: FamilyMember[] = [
  { key: "remark", label: "Remark", id: "rem", detail: "A short aside." },
  { key: "note", label: "Note", id: "note", detail: "A note to the reader." },
  { key: "observation", label: "Observation", id: "obs", detail: "An observation worth pointing out." },
  { key: "warning", label: "Warning", id: "warn", detail: "A warning about a common pitfall." },
  { key: "insight", label: "Insight", id: "insight", detail: "An insight into the material." },
  { key: "convention", label: "Convention", id: "conv", detail: "A convention the text follows." },
];

const PROJECT_LIKE: FamilyMember[] = [
  { key: "activity", label: "Activity", id: "act", detail: "An activity for the reader to work through." },
  { key: "exploration", label: "Exploration", id: "explor", detail: "An open-ended exploration for the reader." },
  { key: "investigation", label: "Investigation", id: "invest", detail: "An investigation for the reader." },
  { key: "project", label: "Project", id: "proj", detail: "A longer project for the reader." },
];

/** Catalog entries for block constructs that share `group`. */
const blocks = (
  group: GroupKey,
  members: Pick<SnippetSpec, "key" | "label" | "detail">[],
): SnippetSpec[] =>
  members.map(({ key, label, detail }) => ({
    key,
    label,
    detail,
    group,
    placement: "block",
  }));

const CATALOG: SnippetSpec[] = [
  {
    // Slides are not divisions -- a <slide> is a block inside a <slideshow> or
    // one of its <section>s -- so the TOC can never offer to add one, and
    // without this the only way to write a slide is to type it by hand.
    key: "slide",
    label: "Slide",
    detail: "One slide of a presentation.",
    group: "slides",
    placement: "block",
    rootTypes: [ "slideshow" ],
  },
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
  ...blocks("definitions", DEFINITION_LIKE),
  ...blocks("theorems", THEOREM_LIKE),
  ...blocks("axioms", AXIOM_LIKE),
  ...blocks("examples", EXAMPLE_LIKE),
  ...blocks("remarks", REMARK_LIKE),
  ...blocks("projects", PROJECT_LIKE),
  ...blocks("exercises", [
    { key: "exercise", label: "Exercise", detail: "An exercise with a hint and a solution." },
  ]),
  // Runestone's interactive exercises, which the preview renders live. Only
  // PreTeXt has bodies for them: neither converter has a spelling for any.
  ...blocks("interactive", [
    { key: "true-false", label: "True/false", detail: "A statement the reader marks true or false." },
    { key: "multiple-choice", label: "Multiple choice", detail: "A question with choices, each with its own feedback." },
    { key: "multiple-select", label: "Multiple select", detail: "A question with multiple correct answers." },
    { key: "cardsort", label: "Drag and drop", detail: "Cards the reader drags onto the responses they match (cardsort matching)." },
    { key: "matching", label: "Matching", detail: "Premises the reader connects to the responses they match." },
    { key: "parsons", label: "Parsons problem", detail: "Blocks the reader drags into the right order." },
    { key: "clickable-area", label: "Clickable area", detail: "Text in which the reader clicks the parts that are correct." },
    { key: "fill-in", label: "Fill in the blank", detail: "A sentence with a blank the reader fills in." },
    { key: "short-answer", label: "Short answer", detail: "A question the reader answers in their own words." },
  ]),
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

/** A family's bodies in one format: `write(element, suggestedId)` per member. */
const family = (
  members: FamilyMember[],
  write: (element: string, id: string) => string,
): Record<string, string> =>
  Object.fromEntries(
    members.map(({ key, id }) => [key, write(key, `${id}-name`)]),
  );

/**
 * What a block may carry after its statement: theorem-like blocks a proof,
 * example-like ones a solution.
 */
type Sequel = "proof" | "solution";

// In the writers below, `\${` is a literal `${`: the start of a tab stop in the
// snippet, not an interpolation in the template string.

/** A titled PreTeXt block with a statement, and its sequel if it has one. */
const ptxStatement = (element: string, id: string, sequel?: Sequel): string =>
  lines(
    `<${element} xml:id="\${1:${id}}">`,
    "\t<title>${2:Title}</title>",
    "\t<statement>",
    sequel ? "\t\t<p>$3</p>" : "\t\t<p>$0</p>",
    "\t</statement>",
    ...(sequel ? [`\t<${sequel}>`, "\t\t<p>$0</p>", `\t</${sequel}>`] : []),
    `</${element}>`,
  );

/** A titled PreTeXt block of bare prose — the remark-like shape, no statement. */
const ptxProse = (element: string, id: string): string =>
  lines(
    `<${element} xml:id="\${1:${id}}">`,
    "\t<title>${2:Title}</title>",
    "\t<p>$0</p>",
    `</${element}>`,
  );

/** The LaTeX environment for a block, its sequel nested inside. */
const texStatement = (env: string, id: string, sequel?: Sequel): string =>
  lines(
    `\\begin{${env}}[\${1:Title}]\\label{\${2:${id}}}`,
    ...(sequel
      ? ["\t$3", `\t\\begin{${sequel}}`, "\t\t$0", `\t\\end{${sequel}}`]
      : ["\t$0"]),
    `\\end{${env}}`,
  );

/**
 * The Markdown directive for a block. Nested directives are fenced with one
 * more colon than their children, so a block that seeds a sequel uses four.
 */
const mdStatement = (directive: string, id: string, sequel?: Sequel): string =>
  sequel
    ? lines(
        `::::${directive}[\${1:Title}]{#\${2:${id}}}`,
        "$3",
        "",
        `:::${sequel}`,
        "$0",
        ":::",
        "::::",
      )
    : lines(`:::${directive}[\${1:Title}]{#\${2:${id}}}`, "$0", ":::");

const PRETEXT_BODIES: Record<string, string> = {
  slide: lines("<slide>", "\t<title>${1:Title}</title>", "\t<p>$0</p>", "</slide>"),
  paragraph: "<p>$0</p>",
  emphasis: "<em>$0</em>",
  term: "<term>$0</term>",
  "code-inline": "<c>$0</c>",
  xref: '<xref ref="${1:xml-id}"/>',
  link: '<url href="${1:https://example.com}">$0</url>',
  ...family(DEFINITION_LIKE, (element, id) => ptxStatement(element, id)),
  ...family(THEOREM_LIKE, (element, id) => ptxStatement(element, id, "proof")),
  ...family(AXIOM_LIKE, (element, id) => ptxStatement(element, id)),
  ...family(EXAMPLE_LIKE, (element, id) => ptxStatement(element, id, "solution")),
  ...family(REMARK_LIKE, ptxProse),
  ...family(PROJECT_LIKE, (element, id) => ptxStatement(element, id)),
  // The interactive exercises are an `<exercise>` whose shape says which one
  // it is; see "Interactive exercises" in the PreTeXt Guide. They validate
  // against the schema's development grammar only — see `pretextSchema.ts`.
  "true-false": lines(
    '<exercise label="${1:tf-label}">',
    '\t<statement correct="${2|yes,no|}">',
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<feedback>",
    "\t\t<p>$0</p>",
    "\t</feedback>",
    "</exercise>",
  ),
  "multiple-choice": lines(
    '<exercise label="${1:mc-label}">',
    "\t<statement>",
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<choices randomize=\"${3|yes,no|}\">",
    '\t\t<choice correct="yes">',
    "\t\t\t<statement>",
    "\t\t\t\t<p>$4</p>",
    "\t\t\t</statement>",
    "\t\t\t<feedback>",
    "\t\t\t\t<p>$5</p>",
    "\t\t\t</feedback>",
    "\t\t</choice>",
    "\t\t<choice>",
    "\t\t\t<statement>",
    "\t\t\t\t<p>$6</p>",
    "\t\t\t</statement>",
    "\t\t\t<feedback>",
    "\t\t\t\t<p>$0</p>",
    "\t\t\t</feedback>",
    "\t\t</choice>",
    "\t</choices>",
    "</exercise>",
  ),
  "multiple-select": lines(
    '<exercise label="${1:ms-label}">',
    "\t<statement>",
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<choices randomize=\"${3|yes,no|}\" multiple-correct=\"yes\">",
    '\t\t<choice correct="yes">',
    "\t\t\t<statement>",
    "\t\t\t\t<p>$4</p>",
    "\t\t\t</statement>",
    "\t\t\t<feedback>",
    "\t\t\t\t<p>$5</p>",
    "\t\t\t</feedback>",
    "\t\t</choice>",
    '\t\t<choice correct="yes">',
    "\t\t\t<statement>",
    "\t\t\t\t<p>$6</p>",
    "\t\t\t</statement>",
    "\t\t\t<feedback>",
    "\t\t\t\t<p>$7</p>",
    "\t\t\t</feedback>",
    "\t\t</choice>",
    '\t\t<choice>',
    "\t\t\t<statement>",
    "\t\t\t\t<p>$8</p>",
    "\t\t\t</statement>",
    "\t\t\t<feedback>",
    "\t\t\t\t<p>$0</p>",
    "\t\t\t</feedback>",
    "\t\t</choice>",
    "\t</choices>",
    "</exercise>",
  ),
  // A premise names the response it matches by that response's `xml:id`, so
  // each id is one tab stop, mirrored onto the response that carries it.
  matching: lines(
    '<exercise label="${1:match-label}">',
    "\t<statement>",
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<matching>",
    '\t\t<premise ref="${3:match-a}">$4</premise>',
    '\t\t<premise ref="${5:match-b}">$6</premise>',
    '\t\t<response xml:id="$3">$7</response>',
    '\t\t<response xml:id="$4">$0</response>',
    "\t</matching>",
    "</exercise>",
  ),
  // Runestone's drag-and-drop: each `<match>` pairs the cards (premises) with
  // the response they are dropped on.
  cardsort: lines(
    '<exercise label="${1:cardsort-label}">',
    "\t<statement>",
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<cardsort>",
    "\t\t<match>",
    "\t\t\t<premise>${3:a}</premise>",
    "\t\t\t<response>${4:A}</response>",
    "\t\t</match>",
    "\t\t<match>",
    "\t\t\t<premise>${5:b}</premise>",
    "\t\t\t<response>${0:B}</response>",
    "\t\t</match>",
    "\t</cardsort>",
    "</exercise>",
  ),
  // The blocks are written in their correct order; Runestone shuffles them.
  parsons: lines(
    '<exercise label="${1:parsons-label}">',
    "\t<statement>",
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<blocks>",
    "\t\t<block>",
    "\t\t\t<p>$3</p>",
    "\t\t</block>",
    "\t\t<block>",
    "\t\t\t<p>$0</p>",
    "\t\t</block>",
    "\t</blocks>",
    "</exercise>",
  ),
  "clickable-area": lines(
    '<exercise label="${1:clickable-area-label}">',
    "\t<statement>",
    "\t\t<p>$2</p>",
    "\t</statement>",
    "\t<areas>",
    '\t\t<p>$3 <area correct="yes">$4</area> $5 <area>$0</area></p>',
    "\t</areas>",
    "</exercise>",
  ),
  "fill-in": lines(
    '<exercise label="${1:fill-in-label}">',
    "\t<statement>",
    '\t\t<p>$2 <fillin answer="${3:answer}"/> $0</p>',
    "\t</statement>",
    "</exercise>",
  ),
  "short-answer": lines(
    '<exercise label="${1:short-answer-label}">',
    "\t<statement>",
    "\t\t<p>$0</p>",
    "\t</statement>",
    "\t<response/>",
    "</exercise>",
  ),
  exercise: lines(
    '<exercise>',
    "\t<statement>",
    "\t\t<p>$1</p>",
    "\t</statement>",
    "\t<hint>",
    "\t\t<p>$2</p>",
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
  // Beamer's `frame` environment, which is what the LaTeX converter recognises.
  // There is no `\slide` macro -- writing one produces a TODO placeholder for an
  // unknown macro -- so this is exactly the spelling an author cannot guess.
  slide: lines("\\begin{frame}{${1:Title}}", "$0", "\\end{frame}"),
  // No `paragraph`: a paragraph in LaTeX-style source is just prose between
  // blank lines, so there is nothing to insert.
  emphasis: "\\emph{$0}",
  term: "\\term{$0}",
  "code-inline": "\\code{$0}",
  xref: "\\ref{${1:label}}",
  link: "\\href{${1:https://example.com}}{$0}",
  ...family(DEFINITION_LIKE, (env, id) => texStatement(env, id)),
  ...family(THEOREM_LIKE, (env, id) => texStatement(env, id, "proof")),
  ...family(AXIOM_LIKE, (env, id) => texStatement(env, id)),
  ...family(EXAMPLE_LIKE, (env, id) => texStatement(env, id, "solution")),
  ...family(REMARK_LIKE, (env, id) => texStatement(env, id)),
  ...family(PROJECT_LIKE, (env, id) => texStatement(env, id)),
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

/**
 * Family members with no Markdown directive in `@pretextbook/remark-pretext`
 * yet: each converts to a `<TODO>` placeholder, so Markdown leaves them out.
 */
const MARKDOWN_UNSUPPORTED = new Set(["identity", "heuristic", "assumption", "convention"]);

/** {@link family}, minus the members Markdown cannot write. */
const markdownFamily = (
  members: FamilyMember[],
  write: (directive: string, id: string) => string,
): Record<string, string> =>
  family(
    members.filter(({ key }) => !MARKDOWN_UNSUPPORTED.has(key)),
    write,
  );

const MARKDOWN_BODIES: Record<string, string> = {
  // Inside a slideshow the heading levels shift down a step: `#` is a section
  // and `##` a slide, where in an article `#` would be the root's own title.
  slide: lines("## ${1:Title}", "", "$0"),
  // No `paragraph` (prose is prose), and no `term`, `xref`, `link`, `figure` or
  // `table`: the Markdown converter has no handler for those yet, and emits a
  // `<TODO>` placeholder instead of the element.
  emphasis: "*$0*",
  "code-inline": "`$0`",
  ...markdownFamily(DEFINITION_LIKE, (directive, id) => mdStatement(directive, id)),
  ...markdownFamily(THEOREM_LIKE, (directive, id) => mdStatement(directive, id, "proof")),
  ...markdownFamily(AXIOM_LIKE, (directive, id) => mdStatement(directive, id)),
  ...markdownFamily(EXAMPLE_LIKE, (directive, id) => mdStatement(directive, id, "solution")),
  ...markdownFamily(REMARK_LIKE, (directive, id) => mdStatement(directive, id)),
  ...markdownFamily(PROJECT_LIKE, (directive, id) => mdStatement(directive, id)),
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

const BODIES: Record<EditorLanguage, Record<string, string>> = {
  pretext: PRETEXT_BODIES,
  latex: LATEX_BODIES,
  markdown: MARKDOWN_BODIES,
  // Drawing code: the catalog is document constructs, none of which it can hold.
  tex: {},
};

/**
 * The Insert menu's contents for `format`: the shared catalog, in catalog
 * order, minus the constructs this format has no body for and the ones illegal
 * under `rootType`. Groups left empty are dropped, so a non-slideshow project
 * never sees a Slides group at all.
 */
export const snippetGroupsFor = (
  format: EditorLanguage,
  rootType: RootDivisionType = "article",
): SnippetGroup[] => {
  const bodies = BODIES[format];
  return GROUPS.map(({ key, label, section }) => ({
    key,
    label,
    section,
    snippets: CATALOG.filter(
      (spec) =>
        spec.group === key &&
        bodies[spec.key] !== undefined &&
        (spec.rootTypes === undefined || spec.rootTypes.includes(rootType)),
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
 * A snippet body as plain text, the way Monaco would leave it if the author
 * tabbed straight through: each tab stop written as its default — a
 * placeholder's text, a choice's first option, and the same again wherever
 * the stop is mirrored — and escapes unescaped. A stop with no default is
 * written as `emptyStop`.
 *
 * This is what the fallback insertion path writes when Monaco's snippet
 * controller is unavailable, and (with `emptyStop` filled in) what the tests
 * feed to the converters.
 */
export const snippetPlainText = (body: string, emptyStop = ""): string => {
  // Every lookbehind here is what keeps an escaped `\$` from reading as a
  // tab stop.
  const defaults = new Map<string, string>();
  for (const [, stop, text] of body.matchAll(/(?<!\\)\$\{(\d+):([^}]*)\}/g)) {
    defaults.set(stop, text);
  }
  for (const [, stop, first] of body.matchAll(/(?<!\\)\$\{(\d+)\|([^,|]*)[^}]*\}/g)) {
    defaults.set(stop, first);
  }
  const writeStop = (_match: string, stop: string) =>
    defaults.get(stop) ?? emptyStop;
  return body
    .replace(/(?<!\\)\$\{(\d+)[:|][^}]*\}/g, writeStop)
    .replace(/(?<!\\)\$\{(\d+)\}/g, writeStop)
    .replace(/(?<!\\)\$(\d+)/g, writeStop)
    .replace(/\\([$\\}])/g, "$1");
};
