/**
 * The LaTeX document the TikZ worker compiles: the one core writes for a
 * `<latex-image>` (`extract-latex-image.xsl`), so the preview fails where the
 * build would, an `&` that wants `\amp` or a macro the preamble lacks, and not
 * where it would not.
 *
 * It differs in one way. Core sets the image on an `article` page and crops the
 * PDF to the ink; here `standalone` makes the page and the SVG is that page. The
 * border is what keeps classic arrow tips (`>=latex`, `stealth`): PGF leaves them
 * out of its bounding box, so a page without one cuts them off where the crop
 * would not.
 */
import { unescapeAttribute } from "../../xmlUtils";

/**
 * The line every build's `<latex-image-preamble>` starts with, so a TikZ
 * `<latex-image>` builds without its author first having to find the docinfo
 * editor and load the package there. An author who loads it anyway loses
 * nothing: a second `\usepackage` of the same package is a no-op.
 */
export const DEFAULT_LATEX_IMAGE_PREAMBLE = "\\usepackage{tikz, pgf}";

const CDATA_OPEN = "<![CDATA[";

/**
 * What TeX sees of a docinfo element's raw inner text, which is XML: core reads
 * its text value, so references are resolved and comments are gone.
 */
export function docinfoTextToTex(inner: string): string {
  return inner
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/)
    .map((part, index) => {
      if (index % 2 === 0) return unescapeAttribute(part);
      return part.startsWith(CDATA_OPEN) ? part.slice(CDATA_OPEN.length, -3) : "";
    })
    .join("");
}

export interface TikzDocumentInput {
  /** The asset's source: TeX, as the buffer holds it. */
  source: string;
  /** The docinfo's `<latex-image-preamble>`, raw. Assembly's default line goes before it. */
  preamble: string;
  /** The docinfo's `<macros>`, raw. */
  macros: string;
}

export interface TikzDocument {
  document: string;
  /** The document's line the source starts on, which TeX's `l.<n>` counts from. */
  sourceLine: number;
}

export function buildTikzDocument({ source, preamble, macros }: TikzDocumentInput): TikzDocument {
  const head = [
    "\\documentclass[border=2pt]{standalone}",
    "\\usepackage{amsmath,amssymb}",
    DEFAULT_LATEX_IMAGE_PREAMBLE,
    docinfoTextToTex(preamble),
    "\\ifdefined\\tikzset \\tikzset{ampersand replacement = \\amp}\\fi",
    docinfoTextToTex(macros),
    "\\begin{document}",
  ].join("\n");
  return {
    document: `${head}\n${source}\n\\end{document}\n`,
    sourceLine: head.split("\n").length + 1,
  };
}
