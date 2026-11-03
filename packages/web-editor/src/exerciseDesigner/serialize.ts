/**
 * Write an {@link ExerciseDesign} out as what an exercise record stores: the
 * children of its `<exercise>` (`source`) and the element's attributes
 * (`attrs`). The element itself, with its `xml:id`, `label` and `<title>`, is
 * built from the record at assembly — see `wrapExerciseSource`.
 */
import type {
  Blank,
  ExerciseBody,
  ExerciseDesign,
  FillInTest,
  Matching,
  ParsonsBlock,
} from "./model";

type Attrs = Record<string, string | false | undefined>;
interface XElement {
  tag: string;
  attrs: Attrs;
  children: XNode[];
}
interface XRaw {
  raw: string;
}
type XNode = XElement | XRaw;

const raw = (s: string): XRaw => ({ raw: s });
const el = (tag: string, attrs: Attrs = {}, ...children: (XNode | null | false)[]): XElement => ({
  tag,
  attrs,
  children: children.filter((c): c is XNode => !!c),
});

export const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** Content that starts with one of these is already block-level and is not wrapped in `<p>`. */
export const BLOCK_START =
  /^<(p|md|mdn|me|men|ol|ul|dl|pre|blockquote|figure|image|tabular|table|program|console|sidebyside|sbsgroup|listing|cd|sage|video|interactive|plus:image)\b/;

/** A PreTeXt markup field as children: block content passes through, plain text becomes `<p>`s. */
function markup(s: string): XNode[] {
  const t = s.trim();
  if (!t) return [];
  if (BLOCK_START.test(t)) return [raw(t)];
  return t
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .map((chunk) => (BLOCK_START.test(chunk) ? raw(chunk) : el("p", {}, raw(chunk))));
}

const optMarkup = (tag: string, s: string) => (s.trim() ? el(tag, {}, ...markup(s)) : null);
const inline = (tag: string, s: string, attrs: Attrs = {}) => el(tag, attrs, raw(s.trim()));
const codeLines = (s: string) => s.replace(/\s+$/, "").split("\n");
const clines = (s: string) => codeLines(s).map((line) => el("cline", {}, raw(escapeText(line))));

export const FILLIN_RE = /<fillin\b[^>]*?\/>/g;
const AREA_TAG_RE = /(<area\b[^>]*>|<\/area>)/;

/** Escape a line of code while keeping its `<area>` tags. */
const escapeExceptAreas = (line: string) =>
  line
    .split(AREA_TAG_RE)
    .map((part) => (AREA_TAG_RE.test(part) ? part : escapeText(part)))
    .join("");

const nonEmpty = (s: string) => s.trim() || undefined;

/**
 * The `order` attribute values for n items: the order a static (print) version
 * shows them in. A fixed, non-identity permutation, so print never shows the
 * solution, and the same for the same n, so re-serializing never churns it.
 */
export function staticOrder(n: number): number[] {
  const positions = Array.from({ length: n }, (_, i) => i)
    .map((i) => ({ i, k: Math.sin((i + 1) * 12.9898 + n * 78.233) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.i);
  const isIdentity = positions.every((p, i) => p === i);
  const shown = isIdentity && n > 1 ? [...positions.slice(1), positions[0]] : positions;
  const order = new Array<number>(n);
  shown.forEach((item, position) => (order[item] = position + 1));
  return order;
}

export const slug = (s: string): string =>
  s
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

/**
 * `xml:id`s for a matching exercise's responses, unique and derived from the
 * exercise's ref and each response's text. They are written into the source,
 * so they keep the ref the exercise had when they were written; assembly
 * qualifies them per placement like any other id inside it.
 */
export function responseIds(b: Matching, idPrefix: string): Map<string, string> {
  const prefix = slug(idPrefix) || "matching";
  const used = new Set<string>();
  return new Map(
    b.responses.map((r, i) => {
      const base = `${prefix}-${slug(r.text) || i + 1}`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      return [r.id, id];
    })
  );
}

function fillinTag(blank: Blank | undefined) {
  if (!blank) return "<fillin/>";
  return render(
    el("fillin", {
      mode: blank.mode,
      answer: blank.answer,
      width: nonEmpty(blank.width),
      name: nonEmpty(blank.name),
    }),
    ""
  );
}

function testNode(t: FillInTest): XElement {
  let cmp: XElement;
  if (t.comparison === "numcmp") {
    cmp = t.useAnswer
      ? el("numcmp", { "use-answer": "yes" })
      : el("numcmp", {
          value: nonEmpty(t.value),
          tolerance: nonEmpty(t.tolerance),
          min: nonEmpty(t.min),
          max: nonEmpty(t.max),
        });
  } else {
    const attrs: Attrs = {
      "use-answer": t.useAnswer && "yes",
      case: t.caseInsensitive && "insensitive",
      literal: !t.useAnswer && t.literal && "yes",
      strip: !t.strip && "no",
    };
    cmp = t.useAnswer ? el("strcmp", attrs) : el("strcmp", attrs, raw(escapeText(t.pattern)));
  }
  return el("test", { correct: t.correct && "yes" }, cmp, optMarkup("feedback", t.feedback));
}

function parsonsBlock(block: ParsonsBlock, order: number, isCode: boolean, partialOrder: boolean) {
  const content = (s: string) => (isCode ? clines(s) : markup(s));
  const attrs: Attrs = {
    order: String(order),
    correct: block.distractor && "no",
    name: partialOrder && nonEmpty(block.name),
    depends: partialOrder && block.depends.length > 0 && block.depends.join(" "),
  };
  if (!block.alternatives.length) return el("block", attrs, ...content(block.content));
  return el(
    "block",
    attrs,
    el("choice", { correct: "yes" }, ...content(block.content)),
    ...block.alternatives.map((alt) => el("choice", {}, ...content(alt.content)))
  );
}

/** Horizontal Parsons blocks are inline: math in `<m>`, code in `<c>`, natural language as is. */
export function inlineBlockContent(language: string, content: string): string {
  const t = content.trim();
  if (language === "math") return `<m>${escapeText(t)}</m>`;
  if (language !== "natural") return `<c>${escapeText(t)}</c>`;
  return t;
}

/** The `<exercise>`'s attributes and the children that follow its `<statement>`. */
function bodyParts(
  b: ExerciseBody,
  idPrefix: string
): { attrs: Attrs; afterStatement: (XNode | null)[] } {
  switch (b.kind) {
    case "truefalse":
      return { attrs: {}, afterStatement: [optMarkup("feedback", b.feedback)] };
    case "multiplechoice":
      return {
        attrs: {},
        afterStatement: [
          el(
            "choices",
            {
              randomize: b.randomize && "yes",
              "multiple-correct": b.multipleCorrect && "yes",
              cols: nonEmpty(b.cols),
            },
            ...b.choices.map((ch) =>
              el(
                "choice",
                { correct: ch.correct && "yes" },
                el("statement", {}, ...markup(ch.statement)),
                optMarkup("feedback", ch.feedback)
              )
            )
          ),
        ],
      };
    case "parsons": {
      const isCode = b.language !== "natural";
      const order = staticOrder(b.blocks.length);
      return {
        attrs: {
          language: b.language,
          indentation: isCode && b.indentation,
          adaptive: b.adaptive && "yes",
        },
        afterStatement: [
          el(
            "blocks",
            { numbered: b.numbered !== "no" && b.numbered, randomize: !b.shuffle && "no" },
            ...b.blocks.map((block, i) => parsonsBlock(block, order[i], isCode, b.partialOrder))
          ),
        ],
      };
    }
    case "horizontalparsons": {
      const order = staticOrder(b.blocks.length);
      return {
        attrs: { language: b.language, database: b.language === "sql" && nonEmpty(b.database) },
        afterStatement: [
          el(
            "blocks",
            {
              layout: "horizontal",
              randomize: b.randomize ? "yes" : "no",
              reuse: b.reuse && "yes",
            },
            ...b.blocks.map((block, i) =>
              el(
                "block",
                { order: String(order[i]), correct: block.distractor && "no" },
                raw(inlineBlockContent(b.language, block.content))
              )
            )
          ),
          b.tests.trim() ? el("tests", {}, raw(escapeText(b.tests.replace(/\s+$/, "")))) : null,
        ],
      };
    }
    case "cardsort": {
      const order = staticOrder(b.groups.reduce((n, g) => n + g.premises.length, 0));
      let i = 0;
      return {
        attrs: {},
        afterStatement: [
          el(
            "cardsort",
            {},
            ...b.groups.map((g) =>
              el(
                "match",
                {},
                ...g.premises.map((p) => inline("premise", p.text, { order: String(order[i++]) })),
                inline("response", g.response)
              )
            )
          ),
        ],
      };
    }
    case "matching": {
      const ids = responseIds(b, idPrefix);
      const order = staticOrder(b.responses.length);
      return {
        attrs: {},
        afterStatement: [
          el(
            "matching",
            {},
            ...b.premises.map((p) =>
              inline("premise", p.text, {
                ref: nonEmpty(
                  p.refs
                    .map((id) => ids.get(id))
                    .filter(Boolean)
                    .join(" ")
                ),
              })
            ),
            ...b.responses.map((r, i) =>
              inline("response", r.text, { "xml:id": ids.get(r.id), order: String(order[i]) })
            )
          ),
        ],
      };
    }
    case "clickable":
      return {
        attrs: {},
        afterStatement: [
          el(
            "areas",
            { language: b.code && nonEmpty(b.language) },
            ...(b.code
              ? codeLines(b.content).map((line) => el("cline", {}, raw(escapeExceptAreas(line))))
              : markup(b.content))
          ),
          optMarkup("feedback", b.feedback),
        ],
      };
    case "fillin":
      return {
        attrs: {},
        afterStatement: [
          el(
            "evaluation",
            {},
            ...b.blanks.map((blank) =>
              el("evaluate", { name: nonEmpty(blank.name) }, ...blank.tests.map(testNode))
            )
          ),
        ],
      };
    case "coding":
      return {
        attrs: {},
        afterStatement: [
          el(
            "program",
            { language: nonEmpty(b.language), interactive: "activecode" },
            b.code.trim() ? el("code", {}, raw(escapeText(b.code.replace(/\s+$/, "")))) : null,
            b.tests.trim() ? el("tests", {}, raw(escapeText(b.tests.replace(/\s+$/, "")))) : null
          ),
        ],
      };
    case "shortanswer":
      return { attrs: { attachment: b.attachment && "yes" }, afterStatement: [el("response")] };
  }
}

/** Fill in the attributes of each `<fillin/>` in the statement from the matching blank. */
export function applyBlanks(statement: string, blanks: Blank[]): string {
  let i = 0;
  return statement.replace(FILLIN_RE, () => fillinTag(blanks[i++]));
}

/**
 * The stored form of `design`: the `<exercise>`'s children and attributes.
 * `idPrefix` (the exercise's ref) seeds the ids a matching exercise writes.
 */
export function sourceFromDesign(
  { common: c, body: b }: ExerciseDesign,
  idPrefix: string
): { source: string; attrs: Record<string, string> } {
  const { attrs, afterStatement } = bodyParts(b, idPrefix);
  const statementText = b.kind === "fillin" ? applyBlanks(c.statement, b.blanks) : c.statement;
  const statementAttrs: Attrs = b.kind === "truefalse" ? { correct: b.correct ? "yes" : "no" } : {};
  const children = [
    el("statement", statementAttrs, ...markup(statementText)),
    ...afterStatement,
    ...c.hints.map((h) => optMarkup("hint", h.text)),
    optMarkup("answer", c.answer),
    optMarkup("solution", c.solution),
  ].filter((n): n is XElement => !!n);
  return {
    source: children.map((n) => render(n, "")).join("\n"),
    attrs: Object.fromEntries(
      Object.entries(attrs).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
  };
}

function render(node: XNode, indent: string): string {
  if ("raw" in node) {
    return node.raw
      .split("\n")
      .map((line) => (line.trim() ? indent + line : ""))
      .join("\n");
  }
  const attrs = Object.entries(node.attrs)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  const open = `${indent}<${node.tag}${attrs}`;
  const [only] = node.children;
  if (!only) return `${open}/>`;
  if (node.children.length === 1 && "raw" in only && !only.raw.includes("\n")) {
    return `${open}>${only.raw}</${node.tag}>`;
  }
  return [
    `${open}>`,
    ...node.children.map((c) => render(c, indent + "  ")),
    `${indent}</${node.tag}>`,
  ].join("\n");
}

/** A parser error message if the markup fragment is not well-formed XML, else null. */
export function checkWellFormed(fragment: string): string | null {
  if (!fragment.includes("<") && !fragment.includes("&")) return null;
  const doc = new DOMParser().parseFromString(`<root>${fragment}</root>`, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (!error) return null;
  const text = (error.textContent ?? "").trim();
  return (
    text
      .split("\n")
      .find((line) => line.trim() && !/^This page contains/.test(line))
      ?.trim() ?? "Malformed XML"
  );
}
