/**
 * Synthetic project generator for the preview-cost benchmarks.
 *
 * Builds a `book` whose shape is controlled by chapter/section counts and a
 * per-section body size, in either PreTeXt or LaTeX, so the two halves of the
 * preview cost (JS assembly + conversion, WASM render) can be measured against
 * project size rather than against one particular document.
 */
import type { Division } from "../src/types/sections";

/** One "paragraph unit" of PreTeXt body content, ~430 chars. */
function pretextBodyUnit(n: number): string {
  return `  <p>
    Paragraph ${n} of this section discusses the convergence of the sequence
    <m>a_n = \\frac{n^2 + ${n}}{2n^2 - 1}</m> and its relationship to the
    limit laws established earlier, which is the statement we appeal to here.
  </p>
  <example xml:id="ex-${n}-\${SUFFIX}">
    <title>Worked Example ${n}</title>
    <p>Evaluate <m>\\int_0^1 x^{${n}} \\, dx</m>.</p>
    <p>By the power rule, the value is <m>\\frac{1}{${n + 1}}</m>.</p>
  </example>
`;
}

/** One "paragraph unit" of LaTeX body content, ~430 chars. */
function latexBodyUnit(n: number): string {
  return `Paragraph ${n} of this section discusses the convergence of the sequence
$a_n = \\frac{n^2 + ${n}}{2n^2 - 1}$ and its relationship to the limit laws
established earlier, which is the statement we appeal to here.

\\begin{example}
  Evaluate $\\int_0^1 x^{${n}} \\, dx$. By the power rule, the value is
  $\\frac{1}{${n + 1}}$.
\\end{example}

\\begin{itemize}
  \\item First observation about paragraph ${n}.
  \\item \\textbf{Second} observation, with \\emph{emphasis}.
\\end{itemize}
`;
}

function body(format: "pretext" | "latex", units: number, suffix: string): string {
  const unit = format === "pretext" ? pretextBodyUnit : latexBodyUnit;
  return Array.from({ length: units }, (_, i) => unit(i + 1))
    .join("\n")
    .replaceAll("${SUFFIX}", suffix);
}

export interface ProjectShape {
  /** Number of chapters. */
  chapters: number;
  /** Sections per chapter. */
  sectionsPerChapter: number;
  /** Body "units" (~430 chars each) per section. */
  unitsPerSection: number;
  /** Source format for every non-root division. */
  format: "pretext" | "latex";
}

export interface SyntheticProject {
  divisions: Division[];
  rootXmlId: string;
  /** A representative leaf the author would be editing: mid-document. */
  activeXmlId: string;
  /** Total source characters across all divisions. */
  totalChars: number;
  shape: ProjectShape;
}

export function makeProject(shape: ProjectShape): SyntheticProject {
  const { chapters, sectionsPerChapter, unitsPerSection, format } = shape;
  const divisions: Division[] = [];

  const chapterRefs = Array.from(
    { length: chapters },
    (_, c) => `ch-${c + 1}`,
  );

  divisions.push({
    id: "root",
    xmlId: "book-root",
    title: "A Synthetic Benchmark Book",
    type: "book",
    sourceFormat: "pretext",
    source: `<book xml:id="book-root">
<title>A Synthetic Benchmark Book</title>
${chapterRefs.map((ref) => `<plus:chapter ref="${ref}"/>`).join("\n")}
</book>`,
  });

  for (let c = 0; c < chapters; c++) {
    const chRef = chapterRefs[c];
    const sectionRefs = Array.from(
      { length: sectionsPerChapter },
      (_, s) => `${chRef}-sec-${s + 1}`,
    );

    if (format === "pretext") {
      divisions.push({
        id: chRef,
        xmlId: chRef,
        title: `Chapter ${c + 1}`,
        type: "chapter",
        sourceFormat: "pretext",
        source: `<chapter xml:id="${chRef}">
<title>Chapter ${c + 1}</title>
<introduction>
  <p>An introduction to chapter ${c + 1}.</p>
</introduction>
${sectionRefs.map((ref) => `<plus:section ref="${ref}"/>`).join("\n")}
</chapter>`,
      });
    } else {
      divisions.push({
        id: chRef,
        xmlId: chRef,
        title: `Chapter ${c + 1}`,
        type: "chapter",
        sourceFormat: "latex",
        source: `\\chapter{Chapter ${c + 1}}\\label{${chRef}}

An introduction to chapter ${c + 1}.

${sectionRefs.map((ref) => `\\plus{section}{${ref}}`).join("\n")}`,
      });
    }

    for (let s = 0; s < sectionsPerChapter; s++) {
      const ref = sectionRefs[s];
      const content = body(format, unitsPerSection, ref);
      divisions.push({
        id: ref,
        xmlId: ref,
        title: `Section ${c + 1}.${s + 1}`,
        type: "section",
        sourceFormat: format,
        source:
          format === "pretext"
            ? `<section xml:id="${ref}">
<title>Section ${c + 1}.${s + 1}</title>
${content}</section>`
            : `\\section{Section ${c + 1}.${s + 1}}\\label{${ref}}

${content}`,
      });
    }
  }

  const midChapter = Math.max(1, Math.ceil(chapters / 2));
  const activeXmlId =
    sectionsPerChapter > 0
      ? `ch-${midChapter}-sec-1`
      : `ch-${midChapter}`;

  return {
    divisions,
    rootXmlId: "book-root",
    activeXmlId,
    totalChars: divisions.reduce((sum, d) => sum + d.source.length, 0),
    shape,
  };
}

export const DOCINFO = `<docinfo>
  <macros>
    \\newcommand{\\R}{\\mathbb{R}}
    \\newcommand{\\Z}{\\mathbb{Z}}
  </macros>
</docinfo>`;

/** Median of a sample, in ms. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Time `fn` `runs` times after `warmup` untimed runs; returns median ms. */
export function timeIt(fn: () => unknown, runs = 5, warmup = 1): number {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

export async function timeItAsync(
  fn: () => Promise<unknown>,
  runs = 3,
  warmup = 1,
): Promise<number> {
  for (let i = 0; i < warmup; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}
