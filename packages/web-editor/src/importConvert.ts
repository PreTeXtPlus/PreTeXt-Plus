/**
 * Converting outside material for the division being edited — the pure half of
 * the Import dialog (`components/ImportDialog.tsx`).
 *
 * There are two ways in. Text — typed, pasted, or read from a `.tex`, `.md` or
 * `.ptx` file — is converted by this package's own converters, the same ones
 * behind LaTeX and Markdown divisions. Any other file goes whole to one of the
 * host's `ImportEngine`s (Word, EPUB, an archive of LaTeX…), falling back to
 * `@pretextbook/import`'s built-in one when the host supplied none.
 *
 * The two come back in different shapes — the local converters return body
 * markup, an engine a whole `<pretext>` document with its `<docinfo>` — and
 * neither knows where the result is going. `fitImportForDivision` is the last
 * step both share: it cuts the result down to the body, moves its divisions to
 * sit one level below the receiving division, renames ids the project already
 * uses, and gives loose text its `<p>`. The result is meant to be pasted
 * *inside* a division, so it never carries a division wrapper of its own.
 */
import { formatPretext } from "@pretextbook/format";
import {
  LADDER_OVERFLOW_TAG,
  PRETEXT_DIVISION_TAGS,
  allAcceptExtensions,
  alternateFor,
  dedupeXmlIds,
  detectSnippetFormat,
  handleImportUploadFile,
  ladderDepth,
  matchesExtension,
  retargetFragmentToDepth,
  routeEngine,
  shiftLadderTag,
  unsupportedFileMessage,
  wrapLooseParagraphs,
} from "@pretextbook/import";
import type { ImportEngine } from "@pretextbook/import/react";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import type { CleanFinding } from "./cleanFindings";
import { cleanLatexSource, detectSourceFormat } from "./contentConversion";
import { isRootDivisionType } from "./sectionUtils";
import type { SourceFormat } from "./types/editor";
import type { DivisionType } from "./types/sections";
import { defaultChildDivisionType } from "./components/toc/types";

/** A conversion before it is fitted to a division. */
export interface ConvertedImport {
  /** PreTeXt as the converter produced it — a body, or a whole document. */
  pretext: string;
  /** What the LaTeX cleaner changed on the way in; empty for other sources. */
  findings: CleanFinding[];
  /** Anything else the author should know about this conversion. */
  notes: string[];
}

/** A conversion ready to paste into a division. */
export interface FittedImport {
  source: string;
  /** What fitting changed — divisions moved, ids renamed. */
  notes: string[];
}

// ── Where a file goes ────────────────────────────────────────────────────────

/**
 * Files read into the source pane as text rather than handed to an engine.
 * Exactly the formats the local converters speak: what the author sees on the
 * left is then what gets converted, and they can trim it first.
 */
const TEXT_FILE_FORMATS: [extension: string, format: SourceFormat][] = [
  [".tex", "latex"],
  [".ltx", "latex"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".ptx", "pretext"],
  [".xml", "pretext"],
];

/** The source format of a file read as text, or `undefined` for any other file. */
export function textFormatForFileName(fileName: string): SourceFormat | undefined {
  const name = fileName.toLowerCase();
  return TEXT_FILE_FORMATS.find(([extension]) =>
    matchesExtension(name, [extension]),
  )?.[1];
}

/** How the dialog should treat a file the author chose. */
export type ImportFileRoute =
  | { kind: "text"; format: SourceFormat }
  | { kind: "engine"; engine: ImportEngine }
  | { kind: "unsupported"; message: string };

export function routeImportFile(
  fileName: string,
  engines: ImportEngine[],
): ImportFileRoute {
  const format = textFormatForFileName(fileName);
  if (format) return { kind: "text", format };
  const engine = routeEngine(engines, fileName);
  return engine
    ? { kind: "engine", engine }
    : { kind: "unsupported", message: unsupportedFileMessage(fileName, engines) };
}

/** Everything the file picker should offer: the text formats, then every engine's. */
export function acceptedImportExtensions(engines: ImportEngine[]): string[] {
  return [
    ...new Set([
      ...TEXT_FILE_FORMATS.map(([extension]) => extension),
      ...allAcceptExtensions(engines),
    ]),
  ];
}

/**
 * The importer's own in-browser converter, for a host that supplied no engines.
 * It reads LaTeX, Markdown and PreTeXt, loose or in an archive — so the dialog
 * still opens a `.zip` of LaTeX with nothing wired up.
 */
export const BUILTIN_IMPORT_ENGINE: ImportEngine = {
  id: "builtin",
  label: "Built-in converter",
  convertFile: (file, options) => handleImportUploadFile(file, options),
};

export function resolveImportEngines(engines?: ImportEngine[]): ImportEngine[] {
  return engines && engines.length > 0 ? engines : [BUILTIN_IMPORT_ENGINE];
}

// ── Converting ───────────────────────────────────────────────────────────────

/**
 * The format of text typed or pasted into the source pane.
 *
 * The document-level detector goes first, since it keys on furniture
 * (`\documentclass`, a `# heading`, a leading `<`) that settles the question
 * outright. It answers "pretext" for anything else, though — including a LaTeX
 * fragment with no environments in it — so that answer is only trusted for
 * text that actually starts with markup, and everything else gets the snippet
 * scorer the paste converter uses (see `pasteConvert.ts`). Prose that scores
 * as neither stays PreTeXt, which just wraps it in a `<p>`.
 */
export function detectImportFormat(text: string): SourceFormat {
  const byDocument = detectSourceFormat(text);
  if (byDocument !== "pretext" || text.trimStart().startsWith("<")) {
    return byDocument;
  }
  return detectSnippetFormat(text) ?? "pretext";
}

/**
 * Convert source-pane text. Throws when the converter does, so the dialog can
 * report the error rather than show an empty result.
 *
 * The converters are called raw, not through `contentConversion`'s wrappers,
 * which format as they go. The LaTeX converter leaves a lone paragraph
 * unwrapped, and formatting bare text puts each inline element on lines of its
 * own — a layout the `<p>` added afterwards would keep. `fitImportForDivision`
 * wraps first and formats once.
 */
export function convertImportText(
  text: string,
  format: SourceFormat,
  { clean }: { clean: boolean },
): ConvertedImport {
  if (format === "latex") {
    const cleaned = clean
      ? cleanLatexSource(text)
      : { latex: text, findings: [] };
    const latex = cleaned.latex.trim();
    return {
      pretext: latex ? String(latexToPretext(latex)).trim() : "",
      findings: cleaned.findings,
      notes: [],
    };
  }
  if (format === "markdown") {
    const markdown = text.trim();
    return {
      pretext: markdown ? String(markdownToPretext(markdown)).trim() : "",
      findings: [],
      notes: [],
    };
  }
  return { pretext: text, findings: [], notes: [] };
}

/** A file name that tells an engine which reader text of `format` needs. */
const TEXT_FILE_NAMES: Partial<Record<SourceFormat, string>> = {
  latex: "import.tex",
  markdown: "import.md",
};

/**
 * The engine an author may send source-pane text through instead of this
 * package's own converter — pandoc, where the host wired it — or `undefined`
 * when there is none, and so nothing to offer.
 *
 * It is the same engine the import wizard offers as its override for a `.tex`
 * or `.md` upload (`alternateFor`): the host lists its in-browser converter
 * first, so that one owns these formats and the next engine reading them is
 * the alternative. PreTeXt has none — there is nothing to convert.
 */
export function alternateTextEngine(
  format: SourceFormat,
  engines: ImportEngine[],
): ImportEngine | undefined {
  const fileName = TEXT_FILE_NAMES[format];
  return fileName ? alternateFor(engines, fileName) : undefined;
}

/**
 * Convert source-pane text through `engine` rather than the local converters.
 * The text travels as a file named for its format, which is how an engine
 * picks its reader. LaTeX is cleaned first when asked, exactly as it is on the
 * local path: the cleaner rewrites source, so it serves any converter.
 */
export async function convertImportTextWithEngine(
  text: string,
  format: SourceFormat,
  engine: ImportEngine,
  { clean }: { clean: boolean },
): Promise<ConvertedImport> {
  const fileName = TEXT_FILE_NAMES[format];
  if (!fileName) return convertImportText(text, format, { clean });
  const cleaned =
    format === "latex" && clean
      ? cleanLatexSource(text)
      : { latex: text, findings: [] };
  const source = cleaned.latex.trim();
  if (!source) return { pretext: "", findings: cleaned.findings, notes: [] };

  const converted = await convertWithEngine(
    new File([source], fileName, { type: "text/plain" }),
    engine,
  );
  return { ...converted, findings: cleaned.findings };
}

/**
 * Convert a file through whichever engine reads it. Throws with the engine's
 * own explanation when it fails.
 */
export async function convertImportFile(
  file: File,
  engines: ImportEngine[],
): Promise<ConvertedImport> {
  const engine = routeEngine(engines, file.name);
  if (!engine) throw new Error(unsupportedFileMessage(file.name, engines));
  return convertWithEngine(file, engine);
}

async function convertWithEngine(
  file: File,
  engine: ImportEngine,
): Promise<ConvertedImport> {
  const result = await engine.convertFile(file, {});
  if ("pretextError" in result) throw new Error(result.pretextError);

  // A clipboard carries text, so images the document embeds cannot come along;
  // their `<image>` elements arrive pointing at files the project lacks.
  const images = result.project.assets.length;
  const notes =
    images > 0
      ? [
          `${images === 1 ? "1 image" : `${images} images`} in this file could ` +
            "not be copied along with the text. Add them under Assets, then " +
            "embed them where they belong.",
        ]
      : [];
  return { pretext: result.pretextSource, findings: [], notes };
}

// ── Fitting ──────────────────────────────────────────────────────────────────

/** A root element's opening tag; group 2 is `/` when it closes itself. */
const ROOT_OPEN = /<(article|book|slideshow)\b[^>]*?(\/?)>/;
const PRETEXT_OPEN = /<(pretext)\b[^>]*?(\/?)>/;
const DOCINFO = /<docinfo\b[^>]*\/>|<docinfo\b[^>]*>[\s\S]*?<\/docinfo>/;
const LEADING_TITLES =
  /^(?:\s*<(title|subtitle|shorttitle|plaintitle)\b[^>]*>[\s\S]*?<\/\1>)+/;
/** Declarations a fragment with no wrapper may still open with. */
const XML_PROLOGUE = /^(?:\s*(?:<\?[\s\S]*?\?>|<!DOCTYPE\b[^>]*>))+/i;

/**
 * What lies between the opening tag `open` found and the last `</name>` —
 * or the end, for a document that never closes it.
 */
function contentsOf(source: string, open: RegExpExecArray): string {
  if (open[2] === "/") return "";
  const start = open.index + open[0].length;
  const end = source.lastIndexOf(`</${open[1]}>`);
  return source.slice(start, end >= start ? end : undefined);
}

/**
 * The part of a converted document that can go inside a division: everything
 * up to and including the root element's opening tag is dropped, as is
 * everything from its closing tag on, and then the root's own title. A
 * `<pretext>` with no root loses its wrapper and `<docinfo>` the same way; a
 * fragment with neither comes back as it was, less any XML declaration.
 *
 * Cut by position rather than by matching the document's whole shape, because
 * what precedes the root is the converter's business — an XML declaration, a
 * generator comment, a schema processing instruction, `<pretext>` with
 * whatever attributes — and a pattern for the whole document fails silently on
 * any prologue it did not foresee, passing the wrapper straight through.
 */
export function extractDocumentBody(source: string): string {
  const root = ROOT_OPEN.exec(source);
  if (root) return contentsOf(source, root).replace(LEADING_TITLES, "").trim();
  const pretext = PRETEXT_OPEN.exec(source);
  if (pretext) return contentsOf(source, pretext).replace(DOCINFO, "").trim();
  return source.replace(XML_PROLOGUE, "").trim();
}

/**
 * The ladder rung that imported divisions should start on inside a division
 * of `parentType`, or `-1` to leave them alone.
 *
 * One rung below a ladder division (a `<section>` takes `<subsection>`s); a
 * root's usual child for a root. Off-ladder divisions — an `<introduction>`, an
 * `<exercises>` — hold no ladder divisions at all, so there is no right level
 * to move anything to.
 */
export function importTargetDepth(
  parentType: DivisionType | null | undefined,
): number {
  if (!parentType) return -1;
  const own = ladderDepth(parentType);
  if (own >= 0) return own + 1;
  return isRootDivisionType(parentType)
    ? ladderDepth(defaultChildDivisionType(parentType))
    : -1;
}

/** Every tag that opens or closes a division, placeholder-free. */
const DIVISION_BOUNDARY = new RegExp(
  `<\\/?(?:${[...PRETEXT_DIVISION_TAGS, LADDER_OVERFLOW_TAG].join("|")})\\b[^>]*>`,
  "g",
);

/**
 * `wrapLooseParagraphs` at every level, not just the top.
 *
 * It treats a division as one block and never looks inside, while the LaTeX
 * converter skips the `<p>` for any division holding a single paragraph — the
 * common case for a short section. Cutting the markup at division tags leaves
 * pieces that each sit directly inside one division (or at the top), which is
 * exactly the context it expects. A leading `<title>` rides along untouched,
 * since it cannot go in a `<p>`.
 */
function wrapLooseParagraphsInDivisions(markup: string): string {
  let wrapped = "";
  let last = 0;
  for (const boundary of markup.matchAll(DIVISION_BOUNDARY)) {
    wrapped += wrapLooseParagraphs(markup.slice(last, boundary.index)) + boundary[0];
    last = boundary.index + boundary[0].length;
  }
  return wrapped + wrapLooseParagraphs(markup.slice(last));
}

/**
 * Text-only inline elements the importer's formatter split across lines.
 *
 * It formats before anything wraps a lone paragraph, so `<m>x</m>` arrives as
 * `<m>\n      x\n    </m>` — and the formatter leaves whitespace inside
 * inline elements alone, so that layout would outlive the `<p>` added here.
 * Only whitespace that includes a line break is trimmed, and only in elements
 * holding nothing but text: nobody types that on purpose.
 */
const SPLIT_INLINE_ELEMENT =
  /<(m|em|alert|term|q|sq|c|foreign)(\s[^>]*)?>\s*\n\s*([^<]*?)\s*\n\s*<\/\1>/g;

const tag = (name: string) => `<${name}>`;

/** Fit a conversion to paste into a division of `parentType`. */
export function fitImportForDivision(
  pretext: string,
  {
    parentType,
    takenIds,
  }: { parentType?: DivisionType | null; takenIds: Iterable<string> },
): FittedImport {
  const body = extractDocumentBody(pretext);
  if (!body) return { source: "", notes: [] };
  const notes: string[] = [];

  const retargeted = retargetFragmentToDepth(body, importTargetDepth(parentType));
  if (retargeted.delta !== 0 && retargeted.topTag && parentType) {
    notes.push(
      `${tag(retargeted.topTag)} became ` +
        `${tag(shiftLadderTag(retargeted.topTag, retargeted.delta))} to fit ` +
        `inside this ${tag(parentType)}; deeper divisions moved with it.`,
    );
  }
  if (retargeted.overflowed.length > 0) {
    notes.push(
      `${retargeted.overflowed.map(tag).join(", ")} ran out of levels below ` +
        "<subsubsection> and became <paragraphs>.",
    );
  }

  const deduped = dedupeXmlIds(retargeted.source, {
    takenIds: new Set(takenIds),
  });
  if (deduped.renamed.length > 0) {
    const count = deduped.renamed.length;
    notes.push(
      `Renamed ${count === 1 ? "an id" : `${count} ids`} this project already ` +
        `uses: ${deduped.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}.`,
    );
  }

  const wrapped = wrapLooseParagraphsInDivisions(
    deduped.source.replace(SPLIT_INLINE_ELEMENT, "<$1$2>$3</$1>"),
  );
  let source = wrapped;
  try {
    source = formatPretext(wrapped);
  } catch {
    // Unformatted but correct beats nothing: the author can still copy it.
  }
  return { source: source.trim(), notes };
}

/**
 * Every id an import must not reuse: the project's records (divisions, assets
 * and snippets share one `ref` namespace on the host, since a `<plus:* ref/>`
 * placeholder is resolved by tag name, not by ref) and every `xml:id` written
 * inside a division's source.
 */
export function takenImportIds(
  divisions: readonly { xmlId?: string; source?: string }[],
  assets: readonly { ref?: string }[] = [],
  snippets: readonly { ref?: string }[] = [],
): string[] {
  const ids = new Set<string>();
  // A record with no ref yet — an asset mid-upload — holds no name.
  for (const ref of [
    ...divisions.map((d) => d.xmlId),
    ...assets.map((a) => a.ref),
    ...snippets.map((s) => s.ref),
  ]) {
    if (ref) ids.add(ref);
  }
  for (const division of divisions) {
    for (const match of (division.source ?? "").matchAll(
      /\bxml:id\s*=\s*(["'])([^"']+)\1/g,
    )) {
      ids.add(match[2]);
    }
  }
  return [...ids];
}
