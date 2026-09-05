import { suppressedElements, type SpellCheckScope } from "./scopes";
import type { TextRegion } from "./regions";
import { findTagEnd, isNameStart, readName } from "../xmlTags";

export type { TextRegion };

/**
 * Scans PreTeXt (XML) source and returns the slices whose words are worth
 * checking, honouring {@link SpellCheckScope}.  The LaTeX and Markdown flavors
 * have finders of their own (`latexRegions.ts`, `markdownRegions.ts`) built on
 * the same scopes; this is the only part of spell checking that differs
 * between formats.
 *
 * This is a purpose-built scanner rather than a pass over Monaco's tokens, for
 * two reasons.  The PreTeXt flavor renders with Monaco's *built-in* `xml`
 * grammar (see `pretextConfig.ts`), whose token names are an implementation
 * detail we don't own and can't rely on.  And the scopes that matter most are
 * element-shaped — everything inside `<m>`, inside `<latex-image>` — which
 * needs an element stack that a flat token stream doesn't give us anyway.
 *
 * It is deliberately tolerant of malformed input: the source is mid-edit most
 * of the time, so an unterminated comment or a stray `<` must degrade into
 * "check less" rather than throw.
 */
export const findCheckableRegions = (
  source: string,
  scopes: SpellCheckScope,
): TextRegion[] => {
  const suppressing = suppressedElements(scopes);
  const regions: TextRegion[] = [];
  // Open elements, innermost last. Only used to find the depth a suppressing
  // element started at, so its end tag can lift the suppression.
  const stack: string[] = [];
  // Stack depth at which the current suppression began, or null when nothing is
  // being suppressed. A single marker (rather than a counter) is enough: nested
  // suppressing elements don't stack, the outermost one already hides them.
  let suppressFrom: number | null = null;
  const isSuppressed = () => suppressFrom !== null;

  let index = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (!isSuppressed() && end > textStart) {
      regions.push({ start: textStart, end });
    }
  };

  while (index < source.length) {
    const lt = source.indexOf("<", index);
    if (lt === -1) {
      flushText(source.length);
      break;
    }
    flushText(lt);

    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      const end = close === -1 ? source.length : close;
      if (scopes.comments === "Check" && !isSuppressed()) {
        regions.push({ start: lt + 4, end });
      }
      index = close === -1 ? source.length : close + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      // Verbatim by definition — never checked, whatever the scopes say.
      const close = source.indexOf("]]>", lt + 9);
      index = close === -1 ? source.length : close + 3;
    } else if (source.startsWith("<?", lt)) {
      const close = source.indexOf("?>", lt + 2);
      index = close === -1 ? source.length : close + 2;
    } else if (source.startsWith("<!", lt)) {
      // Doctype and other declarations.
      const close = source.indexOf(">", lt + 2);
      index = close === -1 ? source.length : close + 1;
    } else if (source.startsWith("</", lt)) {
      const end = findTagEnd(source, lt);
      const name = readName(source, lt + 2);
      // Close the *nearest* matching open element. Unbalanced markup (common
      // mid-edit) then costs at most the elements between them, instead of
      // desynchronising the stack for the rest of the document.
      const opened = stack.lastIndexOf(name);
      if (opened !== -1) {
        stack.length = opened;
        if (suppressFrom !== null && stack.length <= suppressFrom) {
          suppressFrom = null;
        }
      }
      index = end;
    } else if (isNameStart(source[lt + 1])) {
      const end = findTagEnd(source, lt);
      const name = readName(source, lt + 1);
      // `<foo/>`: the `/` sits immediately before the closing `>`.
      const selfClosing = source[end - 2] === "/";
      if (scopes.tags === "Check" && !isSuppressed()) {
        regions.push(...attributeValueRegions(source, lt, end));
      }
      if (!selfClosing) {
        if (suppressFrom === null && suppressing.has(name)) {
          suppressFrom = stack.length;
        }
        stack.push(name);
      }
      index = end;
    } else {
      // A `<` that doesn't open a tag — "if a < b", or a tag the author is
      // halfway through typing. Treat it as ordinary text and resume scanning
      // just past it, so the rest of the line still gets checked.
      textStart = lt;
      index = lt + 1;
      continue;
    }

    textStart = index;
  }

  return regions;
};

/**
 * Attributes whose values are prose an author writes and would want checked.
 *
 * An allowlist rather than a denylist, because the overwhelming majority of
 * PreTeXt attributes hold identifiers and references — `xml:id="sec-intro"`,
 * `ref="thm-main"`, `source="images/graph.png"` — which are not misspelled,
 * cannot be corrected from a dictionary, and would drown the real findings.
 * PreTeXt keeps nearly all prose in elements (`<title>` is an element, not an
 * attribute), so this list is short by nature, and `tags: "Check"` is
 * correspondingly a narrow setting.
 */
const PROSE_ATTRIBUTES = new Set(["alt", "title", "description"]);

/**
 * The prose-bearing attribute *values* in a tag — never the tag name, never
 * attribute names. Those are markup vocabulary the author doesn't choose and
 * can't correct, so flagging them is pure noise.
 *
 * This is finer-grained than the `tags` scope can be in the VS Code extension,
 * where cSpell's `ignoreRegExpList` can only drop a whole tag at a time.
 */
const attributeValueRegions = (
  source: string,
  tagStart: number,
  tagEnd: number,
): TextRegion[] => {
  const regions: TextRegion[] = [];
  let i = tagStart + 1;
  // Step over the element name; attributes can only follow it.
  while (i < tagEnd && !/[\s>/]/.test(source[i])) i++;

  while (i < tagEnd) {
    while (i < tagEnd && /\s/.test(source[i])) i++;
    if (i >= tagEnd) break;

    const nameStart = i;
    while (i < tagEnd && !/[\s=>/]/.test(source[i])) i++;
    // No name characters here — a stray `=` or `/`. Step over it so the loop
    // always makes progress on malformed input.
    if (i === nameStart) {
      i++;
      continue;
    }
    const name = source.slice(nameStart, i);

    while (i < tagEnd && /\s/.test(source[i])) i++;
    if (source[i] !== "=") continue;
    i++;
    while (i < tagEnd && /\s/.test(source[i])) i++;

    const quote = source[i];
    if (quote !== '"' && quote !== "'") continue;
    const close = source.indexOf(quote, i + 1);
    if (close === -1 || close >= tagEnd) break;
    if (PROSE_ATTRIBUTES.has(name.toLowerCase()) && close > i + 1) {
      regions.push({ start: i + 1, end: close });
    }
    i = close + 1;
  }

  return regions;
};
