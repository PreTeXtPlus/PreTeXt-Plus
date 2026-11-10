/**
 * Read a stored exercise — the children of its `<exercise>` plus that
 * element's attributes — into an {@link ExerciseDesign} for the designer.
 * The inverse of `serialize.ts`: what one writes, the other reads back the
 * same (see `__tests__/exerciseDesigner.test.ts`).
 */
import {
  emptyBody,
  emptyCommon,
  emptyTest,
  newItemId,
  type Blank,
  type ExerciseBody,
  type ExerciseDesign,
  type ExerciseKind,
  type FillInTest,
} from "./model";
import { BLOCK_START, FILLIN_RE } from "./serialize";

/**
 * The namespace the scratch root declares for `plus:`, so a field holding a
 * `<plus:image ref/>` placeholder parses. Stripped again wherever markup is
 * serialized back out.
 */
const PLUS_NS = "urn:pretext-plus:placeholder";
const PLUS_NS_DECL = new RegExp(`\\s+xmlns:plus="${PLUS_NS}"`, "g");

/** Elements every exercise type understands; the rest belong to its body. */
const COMMON_TAGS = ["title", "statement", "hint", "answer", "solution"];

const elements = (node: Element, tag?: string) =>
  Array.from(node.children).filter((c) => !tag || c.tagName === tag);
const child = (node: Element, tag: string) => elements(node, tag)[0] as Element | undefined;
const yes = (node: Element | undefined, attr: string) => node?.getAttribute(attr) === "yes";

/** Remove surrounding blank lines and the indentation common to the content's lines. */
function dedent(s: string) {
  const lines = s.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
  // A first line that starts right after the opening tag carries no source indentation.
  const measured = /^\s/.test(lines[0] ?? "") ? lines : lines.slice(1);
  const indents = measured.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const n = indents.length ? Math.min(...indents) : 0;
  return lines.map((l, i) => (i === 0 && measured !== lines ? l : l.slice(n))).join("\n");
}

function inner(node: Element, skip: string[] = []) {
  const s = new XMLSerializer();
  return dedent(
    Array.from(node.childNodes)
      .filter((n) => !(n.nodeType === 1 && skip.includes((n as Element).tagName)))
      .map((n) => s.serializeToString(n).replace(PLUS_NS_DECL, ""))
      .join(""),
  ).trim();
}

/** Inner markup, turning plain `<p>`s back into blank-line-separated text where that round-trips. */
function innerMarkup(node: Element | undefined, skip: string[] = []) {
  if (!node) return "";
  const content = inner(node, skip);
  const kids = elements(node).filter((c) => !skip.includes(c.tagName));
  const strayText = Array.from(node.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
  if (!kids.length || strayText || kids.some((k) => k.tagName !== "p" || k.attributes.length)) {
    return content;
  }
  const paragraphs = kids.map((p) => inner(p));
  if (paragraphs.some((p) => !p || BLOCK_START.test(p) || /\n\s*\n/.test(p))) return content;
  return paragraphs.join("\n\n");
}

const codeText = (node: Element | undefined) => (node ? dedent(node.textContent ?? "") : "");

/** A Parsons block (or one of its choices): code lines joined, or markup. */
function blockContent(node: Element) {
  const lines = elements(node, "cline");
  return lines.length ? lines.map((c) => c.textContent ?? "").join("\n") : innerMarkup(node);
}

/** A horizontal Parsons block's content, unwrapping a lone `<c>` or `<m>`. */
function inlineBlockContent(node: Element) {
  const kids = elements(node);
  const onlyChild =
    kids.length === 1 &&
    Array.from(node.childNodes).every(
      (n) => n === kids[0] || (n.nodeType === 3 && !n.textContent!.trim()),
    );
  if (onlyChild && (kids[0].tagName === "c" || kids[0].tagName === "m")) {
    return kids[0].textContent?.trim() ?? "";
  }
  return inner(node);
}

/** Rebuild a `<cline>` as text, keeping its `<area>` tags. */
function clineWithAreas(cline: Element) {
  return Array.from(cline.childNodes)
    .map((n) => {
      if (n.nodeType === 3) return n.textContent ?? "";
      const e = n as Element;
      if (e.tagName !== "area") return e.textContent ?? "";
      const correct = e.getAttribute("correct");
      return `<area${correct ? ` correct="${correct}"` : ""}>${e.textContent ?? ""}</area>`;
    })
    .join("");
}

function parseTest(test: Element): FillInTest {
  const t: FillInTest = { ...emptyTest(), correct: yes(test, "correct") };
  const num = child(test, "numcmp");
  const str = child(test, "strcmp");
  if (num) {
    Object.assign(t, {
      comparison: "numcmp",
      useAnswer: yes(num, "use-answer"),
      value: num.getAttribute("value") ?? "",
      tolerance: num.getAttribute("tolerance") ?? "",
      min: num.getAttribute("min") ?? "",
      max: num.getAttribute("max") ?? "",
    });
  } else if (str) {
    Object.assign(t, {
      comparison: "strcmp",
      useAnswer: yes(str, "use-answer"),
      pattern: str.textContent ?? "",
      caseInsensitive: str.getAttribute("case") === "insensitive",
      literal: yes(str, "literal"),
      strip: str.getAttribute("strip") !== "no",
    });
  }
  t.feedback = innerMarkup(child(test, "feedback"));
  return t;
}

/** Which kind of exercise `ex` is, read off the elements it holds. */
export function detectKind(ex: Element): ExerciseKind {
  if (child(ex, "statement")?.hasAttribute("correct")) return "truefalse";
  if (child(ex, "choices")) return "multiplechoice";
  const blocks = child(ex, "blocks");
  if (blocks) return blocks.getAttribute("layout") === "horizontal" ? "horizontalparsons" : "parsons";
  if (child(ex, "cardsort") || child(ex, "matches")) return "cardsort";
  if (child(ex, "matching")) return "matching";
  if (child(ex, "areas")) return "clickable";
  if (child(ex, "evaluation") || child(ex, "statement")?.getElementsByTagName("fillin").length) {
    return "fillin";
  }
  if (child(ex, "program")) return "coding";
  return "shortanswer";
}

function parseBody(
  ex: Element,
  kind: ExerciseKind,
  warn: (msg: string) => void,
): { body: ExerciseBody; tags: string[] } {
  switch (kind) {
    case "truefalse":
      return {
        body: {
          kind,
          correct: yes(child(ex, "statement"), "correct"),
          feedback: innerMarkup(child(ex, "feedback")),
        },
        tags: ["feedback"],
      };
    case "multiplechoice": {
      const choices = child(ex, "choices")!;
      return {
        body: {
          kind,
          randomize: yes(choices, "randomize"),
          multipleCorrect: yes(choices, "multiple-correct"),
          cols: choices.getAttribute("cols") ?? "",
          choices: elements(choices, "choice").map((c) => {
            const statement = child(c, "statement");
            return {
              id: newItemId(),
              correct: yes(c, "correct"),
              statement: statement ? innerMarkup(statement) : innerMarkup(c, ["feedback"]),
              feedback: innerMarkup(child(c, "feedback")),
            };
          }),
        },
        tags: ["choices"],
      };
    }
    case "parsons": {
      const blocks = child(ex, "blocks")!;
      const numbered = blocks.getAttribute("numbered") ?? ex.getAttribute("numbered");
      const parsed = elements(blocks, "block").map((block) => {
        const choices = elements(block, "choice");
        const correct = choices.find((c) => yes(c, "correct")) ?? choices[0];
        return {
          id: newItemId(),
          distractor: block.getAttribute("correct") === "no",
          content: blockContent(correct ?? block),
          alternatives: choices
            .filter((c) => c !== correct)
            .map((c) => ({ id: newItemId(), content: blockContent(c) })),
          name: block.getAttribute("name") ?? "",
          depends: (block.getAttribute("depends") ?? "").split(/\s+/).filter(Boolean),
        };
      });
      return {
        body: {
          ...emptyBody("parsons"),
          language: ex.getAttribute("language") ?? "natural",
          numbered: numbered === "left" || numbered === "right" ? numbered : "no",
          indentation: ex.getAttribute("indentation") === "hide" ? "hide" : "show",
          adaptive: yes(ex, "adaptive"),
          shuffle: blocks.getAttribute("randomize") !== "no",
          partialOrder: parsed.some((b) => b.name || b.depends.length),
          blocks: parsed,
        },
        tags: ["blocks"],
      };
    }
    case "horizontalparsons": {
      const blocks = child(ex, "blocks")!;
      const all = elements(blocks, "block");
      const byId = new Map(
        all.filter((b) => b.hasAttribute("xml:id")).map((b) => [b.getAttribute("xml:id")!, b]),
      );
      return {
        body: {
          kind,
          language: ex.getAttribute("language") ?? "natural",
          randomize: blocks.getAttribute("randomize") !== "no",
          reuse: yes(blocks, "reuse"),
          blocks: all.map((block) => {
            const ref = block.getAttribute("ref");
            const source = (ref && byId.get(ref)) || block;
            return {
              id: newItemId(),
              distractor: block.getAttribute("correct") === "no",
              content: inlineBlockContent(source),
            };
          }),
          tests: codeText(child(ex, "tests")),
          database: ex.getAttribute("database") ?? "",
        },
        tags: ["blocks", "tests"],
      };
    }
    case "cardsort": {
      const container = child(ex, "cardsort") ?? child(ex, "matches")!;
      return {
        body: {
          kind,
          groups: elements(container, "match").map((m) => ({
            id: newItemId(),
            response: innerMarkup(child(m, "response")),
            premises: elements(m, "premise").map((p) => ({ id: newItemId(), text: innerMarkup(p) })),
          })),
        },
        tags: ["cardsort", "matches"],
      };
    }
    case "matching": {
      const container = child(ex, "matching")!;
      const responses = elements(container, "response").map((r) => ({
        xmlId: r.getAttribute("xml:id") ?? "",
        response: { id: newItemId(), text: innerMarkup(r) },
      }));
      const idFor = new Map(responses.map((r) => [r.xmlId, r.response.id]));
      return {
        body: {
          kind,
          responses: responses.map((r) => r.response),
          premises: elements(container, "premise").map((p) => {
            const refs = (p.getAttribute("ref") ?? "").split(/\s+/).filter(Boolean);
            if (refs.some((ref) => !idFor.has(ref))) {
              warn("Some premises refer to responses that do not exist.");
            }
            return {
              id: newItemId(),
              text: innerMarkup(p),
              refs: refs.map((ref) => idFor.get(ref)).filter((id): id is string => !!id),
            };
          }),
        },
        tags: ["matching"],
      };
    }
    case "clickable": {
      const areas = child(ex, "areas")!;
      const lines = elements(areas, "cline");
      return {
        body: {
          kind,
          code: lines.length > 0,
          language: areas.getAttribute("language") ?? "",
          content: lines.length ? lines.map(clineWithAreas).join("\n") : innerMarkup(areas),
          feedback: innerMarkup(child(ex, "feedback")),
        },
        tags: ["areas", "feedback"],
      };
    }
    case "fillin": {
      const statement = child(ex, "statement");
      const evaluation = child(ex, "evaluation");
      if (child(ex, "setup")) warn("Dynamic fill-ins (<setup>) can't be edited here, so the setup was removed.");
      const evaluates = evaluation ? elements(evaluation, "evaluate") : [];
      const fillins = statement ? Array.from(statement.getElementsByTagName("fillin")) : [];
      const blanks = fillins.map((f, i): Blank => {
        const name = f.getAttribute("name") ?? "";
        const evaluate = (name && evaluates.find((e) => e.getAttribute("name") === name)) || evaluates[i];
        const tests = evaluate ? elements(evaluate, "test") : [];
        if (tests.some((t) => !child(t, "strcmp") && !child(t, "numcmp"))) {
          warn("Only text and number comparisons can be edited here; other comparisons were reset.");
        }
        return {
          id: newItemId(),
          answer: f.getAttribute("answer") ?? "",
          mode: f.getAttribute("mode") === "number" ? "number" : "string",
          width: f.getAttribute("width") ?? "",
          name,
          tests: tests.map(parseTest),
        };
      });
      return { body: { kind, blanks }, tags: ["evaluation", "setup"] };
    }
    case "coding": {
      const program = child(ex, "program")!;
      const tests = child(program, "tests");
      if (tests && child(tests, "iotest")) warn("Input/output tests can't be edited here and were removed.");
      return {
        body: {
          kind,
          language: program.getAttribute("language") ?? "",
          code: codeText(child(program, "code") ?? (elements(program).length ? undefined : program)),
          tests: tests && !child(tests, "iotest") ? codeText(tests) : "",
        },
        tags: ["program"],
      };
    }
    case "shortanswer":
      return { body: { kind, attachment: yes(ex, "attachment") }, tags: ["response"] };
  }
}

/** What reading a stored exercise produced, and what it had to leave out. */
export interface ParsedExercise {
  design: ExerciseDesign;
  warnings: string[];
}

/**
 * Read a stored exercise. `source` is the children of its `<exercise>` and
 * `attrs` the element's attributes, exactly as the record holds them. Throws
 * if the source is not well-formed XML.
 */
export function designFromSource(
  source: string,
  attrs: Record<string, string> = {},
): ParsedExercise {
  const doc = new DOMParser().parseFromString(
    `<exercise xmlns:plus="${PLUS_NS}">${source}</exercise>`,
    "application/xml",
  );
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) {
    throw new Error(`The exercise is not well-formed XML: ${(error.textContent ?? "").trim().split("\n")[0]}`);
  }
  const ex = doc.documentElement;
  for (const [name, value] of Object.entries(attrs)) ex.setAttribute(name, value);

  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };

  const answers = elements(ex, "answer");
  const solutions = elements(ex, "solution");
  if (answers.length > 1) warn("Only the first <answer> was kept.");
  if (solutions.length > 1) warn("Only the first <solution> was kept.");

  const kind = detectKind(ex);
  let statement = innerMarkup(child(ex, "statement"));
  if (kind === "fillin") statement = statement.replace(FILLIN_RE, "<fillin/>");

  const common = {
    ...emptyCommon(),
    statement,
    hints: elements(ex, "hint").map((h) => ({ id: newItemId(), text: innerMarkup(h) })),
    answer: innerMarkup(answers[0]),
    solution: innerMarkup(solutions[0]),
  };

  const { body, tags } = parseBody(ex, kind, warn);
  const known = [...COMMON_TAGS, ...tags];
  for (const e of elements(ex)) {
    if (!known.includes(e.tagName)) warn(`Removed <${e.tagName}>, which can't be edited here.`);
  }
  if (child(ex, "title")) warn("An exercise's title is set in its settings (⚙), not in its source.");
  return { design: { common, body }, warnings };
}
