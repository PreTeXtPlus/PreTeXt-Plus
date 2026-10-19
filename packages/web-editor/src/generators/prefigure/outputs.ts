/**
 * What a PreFigure render produces, as pure string functions shared by the
 * definition (which names the files) and the runtime (which fills them).
 */

/** Whether the author wrote `<annotations>`: those diagrams ship two extra files. */
export const hasAnnotations = (source: string): boolean => /<annotations\b/.test(source);

/**
 * The diagcess copy of a diagram: the SVG with `width`/`height` moved into an
 * `aspect-ratio` style on the root, which is exactly what `prefig` writes as
 * `<label>-diagcess.svg` for the keyboard-exploration script to size itself
 * from. String surgery on the opening `<svg>` tag only; the body is untouched.
 */
export function diagcessSvg(svg: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return svg;
  const tag = open[0];
  const width = /\swidth="([^"]*)"/.exec(tag)?.[1];
  const height = /\sheight="([^"]*)"/.exec(tag)?.[1];
  if (!width || !height) return svg;
  const stripped = tag.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "");
  const styled = stripped.replace(/>$/, ` style="aspect-ratio: ${width} / ${height};">`);
  return svg.slice(0, open.index) + styled + svg.slice(open.index + tag.length);
}

/** The files a render of `source` for `ref` produces, primary SVG first. */
export const prefigureOutputFilenames = (ref: string, source: string): string[] =>
  hasAnnotations(source)
    ? [`${ref}.svg`, `${ref}-annotations.xml`, `${ref}-diagcess.svg`]
    : [`${ref}.svg`];
