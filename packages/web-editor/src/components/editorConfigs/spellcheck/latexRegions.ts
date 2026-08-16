import {
  KATEX_ENVIRONMENTS,
  scanDocument,
  VERBATIM_ENVIRONMENTS,
  type MacroOccurrence,
} from "@pretextbook/latex-style-pretext";
import {
  checkableRegions,
  mathDelimiterRegions,
  mathScopeAt,
  type TextRegion,
} from "./regions";
import type { SpellCheckScope } from "./scopes";

/**
 * Scans LaTeX-style PreTeXt source and returns the slices whose words are worth
 * checking, honouring the same {@link SpellCheckScope} the XML scanner does.
 *
 * The scopes are matched to LaTeX constructs by **what the converter turns them
 * into**: `\begin{program}` becomes `<program>`, so it answers to `blockCode`
 * exactly as the element does; `$…$` becomes `<m>`, so it answers to
 * `inlineMath`.  An author who switches a division from PreTeXt to LaTeX
 * therefore keeps the spelling behaviour their settings describe.
 *
 * The structural work is done by `scanDocument` from the language package —
 * the same scanner that backs completions and lint — so this module only has to
 * decide which of the constructs it reports to hide, and never has to know how
 * to find a `\begin` or where a math delimiter closes.  Everything it does not
 * hide is prose, which is why an environment's `[title]` argument is checked:
 * the converter emits it as a `<title>` element, and element content is checked.
 */
export const findCheckableLatexRegions = (
  source: string,
  scopes: SpellCheckScope,
): TextRegion[] => {
  const scan = scanDocument(source);
  const suppressed: TextRegion[] = [];

  if (scopes.comments === "Ignore") suppressed.push(...scan.commentRegions);

  for (const region of scan.mathRegions) {
    suppressed.push(
      ...(scopes[mathScopeAt(source, region.start)] === "Ignore"
        ? [region]
        : mathDelimiterRegions(source, region)),
    );
  }

  suppressed.push(...environmentRegions(source, scan.environments, scopes));

  // `\label{sec-intro}` — the scanner captures these apart from other macros.
  for (const label of scan.labels) {
    suppressed.push({
      start: label.offset,
      end: label.offset + label.name.length,
    });
  }

  for (const macro of scan.macros) {
    suppressed.push(...macroRegions(source, macro, scopes));
  }

  return checkableRegions(source.length, suppressed);
};

/**
 * The environments each element-shaped scope covers.
 *
 * `blockCode` and `displayMath` read their sets from the language package
 * (`VERBATIM_ENVIRONMENTS`, `KATEX_ENVIRONMENTS`), so an environment the
 * converter learns about later is honoured here without a second list to keep
 * in step.  Only `latexImage` needs one of its own: a `latex-image` is drawn
 * with TikZ, which is neither verbatim nor math to the scanner.
 */
const LATEX_IMAGE_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "latex-image",
  "tikzpicture",
  "tikzcd",
]);

type ElementScope = "displayMath" | "blockCode" | "latexImage";

const environmentScope = (name: string): ElementScope | null => {
  if (VERBATIM_ENVIRONMENTS.has(name)) return "blockCode";
  if (LATEX_IMAGE_ENVIRONMENTS.has(name)) return "latexImage";
  if (KATEX_ENVIRONMENTS.has(name)) return "displayMath";
  return null;
};

type EnvironmentOccurrence = ReturnType<
  typeof scanDocument
>["environments"][number];

/**
 * Hides the `\begin{…}`/`\end{…}` markers themselves — the environment name is
 * markup vocabulary, like a tag name — plus the whole body of any environment
 * whose scope is `"Ignore"`.
 */
const environmentRegions = (
  source: string,
  environments: readonly EnvironmentOccurrence[],
  scopes: SpellCheckScope,
): TextRegion[] => {
  const regions: TextRegion[] = [];
  // Open environments, innermost last. Only used to find the depth a suppressed
  // environment started at, so its `\end` can lift the suppression.
  const stack: string[] = [];
  // Where the current suppression began, or null when nothing is suppressed. A
  // single marker (rather than a counter) is enough: nested suppressed
  // environments don't stack, the outermost one already hides them.
  let suppressStart: number | null = null;
  let suppressDepth = 0;

  for (const occurrence of environments) {
    regions.push({ start: occurrence.start, end: occurrence.end });

    if (occurrence.type === "begin") {
      if (suppressStart === null) {
        const scope = environmentScope(occurrence.name);
        if (scope && scopes[scope] === "Ignore") {
          suppressStart = occurrence.start;
          suppressDepth = stack.length;
        }
      }
      stack.push(occurrence.name);
      continue;
    }

    // Close the *nearest* matching open environment. Unbalanced markup (common
    // mid-edit) then costs at most the environments between them, instead of
    // desynchronising the stack for the rest of the document.
    const opened = stack.lastIndexOf(occurrence.name);
    if (opened === -1) continue;
    stack.length = opened;
    if (suppressStart !== null && stack.length <= suppressDepth) {
      regions.push({ start: suppressStart, end: occurrence.end });
      suppressStart = null;
    }
  }

  // An environment left open mid-edit suppresses to the end of the source
  // rather than reverting to checking its body as prose.
  if (suppressStart !== null) {
    regions.push({ start: suppressStart, end: source.length });
  }

  return regions;
};

/**
 * Macros whose arguments are identifiers, paths or URLs rather than prose.
 * Suppressed whatever the scopes say, exactly as an `xml:id` is: nothing in them
 * can be misspelled, and nothing in them could be corrected from a dictionary.
 *
 * The value is how many mandatory `{}` arguments to hide — `\href{url}{text}`
 * and `\hyperref[label]{text}` both carry prose in an argument the reader sees,
 * so the count is what keeps that text checked.  A leading optional `[…]`
 * argument is hidden with them either way, since it holds options
 * (`\includegraphics[width=2in]{…}`), never prose.
 */
const IDENTIFIER_MACRO_ARGUMENTS: ReadonlyMap<string, number> = new Map([
  ["ref", 1],
  ["eqref", 1],
  ["cref", 1],
  ["Cref", 1],
  ["cite", 1],
  ["index", 1],
  ["url", 1],
  ["input", 1],
  ["include", 1],
  ["usepackage", 1],
  ["includegraphics", 1],
  ["xmltag", 1],
  ["xmlattr", 1],
  ["href", 1],
  ["hyperref", 0],
  ["plus", 2],
]);

/** Macros whose argument the converter emits as `<c>`. */
const INLINE_CODE_MACROS: ReadonlySet<string> = new Set([
  "code",
  "lstinline",
  "texttt",
  "kbd",
]);

/**
 * What to hide for one macro: always its name, and for the macros above their
 * arguments too.  A macro that isn't listed — `\emph{…}`, `\term{…}`,
 * `\section{…}` — wraps prose the author wrote, which stays checked, matching
 * the `<em>`/`<term>`/`<title>` content it becomes.
 */
const macroRegions = (
  source: string,
  macro: MacroOccurrence,
  scopes: SpellCheckScope,
): TextRegion[] => {
  const regions: TextRegion[] = [{ start: macro.start, end: macro.end }];

  if (macro.name === "verb") {
    if (scopes.inlineCode === "Ignore") {
      const span = verbRegion(source, macro);
      if (span) regions.push(span);
    }
    return regions;
  }

  const mandatory = IDENTIFIER_MACRO_ARGUMENTS.get(macro.name);
  if (mandatory !== undefined) {
    let cursor = macro.end;
    const optional = readGroup(source, cursor, "[");
    if (optional) {
      regions.push(optional);
      cursor = optional.end;
    }
    for (let taken = 0; taken < mandatory; taken++) {
      const group = readGroup(source, cursor, "{");
      if (!group) break;
      regions.push(group);
      cursor = group.end;
    }
    return regions;
  }

  if (scopes.inlineCode === "Ignore" && INLINE_CODE_MACROS.has(macro.name)) {
    const group = readGroup(source, macro.end, "{");
    if (group) regions.push(group);
  }

  return regions;
};

/**
 * The `{…}` or `[…]` group starting at `from` (spaces allowed before it), or
 * null if there isn't one.  Like the language package's own reader, this stops
 * at the first closing brace rather than tracking nesting: a `\ref` argument
 * never contains one, and over-reading someone else's prose would be worse than
 * under-reading an unusual argument.
 */
const readGroup = (
  source: string,
  from: number,
  open: "{" | "[",
): TextRegion | null => {
  let i = from;
  while (source[i] === " " || source[i] === "\t") i++;
  if (source[i] !== open) return null;
  const close = source.indexOf(open === "{" ? "}" : "]", i + 1);
  if (close === -1) return null;
  return { start: i, end: close + 1 };
};

/**
 * `\verb|…|` takes its delimiter from whatever character follows the macro
 * name, so it can't be read as a group.
 */
const verbRegion = (
  source: string,
  macro: MacroOccurrence,
): TextRegion | null => {
  // `\verb*|…|` — the starred form shows spaces; the delimiter follows the `*`.
  const start = source[macro.end] === "*" ? macro.end + 1 : macro.end;
  const delimiter = source[start];
  if (!delimiter || /[\sA-Za-z]/.test(delimiter)) return null;
  const close = source.indexOf(delimiter, start + 1);
  return { start, end: close === -1 ? source.length : close + 1 };
};
