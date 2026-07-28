/**
 * Line translation between the editor buffer and the document that was
 * actually rendered.
 *
 * These are not the same text. Monaco holds one division's own source, while
 * the preview renders `wrapDivisionForPreview(assembleProjectSource(...))` —
 * which adds a `<pretext>`/`<article>` wrapper and `<docinfo>`, and expands
 * every `<plus:* ref="..."/>` placeholder into the referenced division's full
 * content. So the offset between the two is not a constant: it grows at each
 * expansion, by however many lines that child contributed.
 *
 * Rather than reproduce the assembly rules (and re-break every time they
 * change), the mapping is recovered from the two strings themselves. Assembly
 * only ever *inserts* lines around the division's own, in order, so a greedy
 * two-pointer walk that matches lines by content recovers the correspondence
 * without knowing anything about how the text was built.
 *
 * Lines that assembly rewrote (a `<plus:.../>` placeholder replaced by its
 * expansion) simply do not map, and neither do lines belonging to an expanded
 * child — that content is not in this buffer. Callers treat an unmapped line
 * as "nothing to sync to", which is the honest answer.
 */

/**
 * Which division authored the element with this rendered id.
 *
 * Attribution is read straight off the id rather than inferred from the text,
 * because pretext-assembly.xsl builds ids by a rule that already encodes it:
 *
 *     id(el) = @label ?? @xml:id ?? id(parent) + "-" + sibling-position
 *
 * An authored `xml:id` resets the chain, so every id *begins* with its nearest
 * authored ancestor — which, for anything inside a division, is that
 * division's own `xml:id`. Stripping the generated `-<n>` suffixes walks back
 * up to it: `sec-markdown-2-2-4` → `sec-markdown`.
 *
 * The earlier approach — matching each division's source against the rendered
 * text and taking the best score — was wrong in a way worth recording. Every
 * PreTeXt division is mostly generic markup (`<p>`, `</p>`, `</section>`), so
 * an unrelated division can score arbitrarily high against an unrelated
 * document; no threshold separates them reliably, because the ratio depends on
 * how prose-heavy a division happens to be. This rule has no such failure mode:
 * it either finds a known division or reports none.
 *
 * Returns `undefined` for page chrome (`main`, `ptx-content`), and for an
 * element whose nearest authored ancestor is an `xml:id` that is not a
 * division — callers should stay where they are rather than guess.
 */
export function divisionForElementId(
  elementId: string,
  isDivision: (xmlId: string) => boolean,
): string | undefined {
  let candidate = elementId;
  if (isDivision(candidate)) return candidate;
  // Peel one generated suffix at a time; anything left without a `-<n>` tail
  // is an authored id, and if it is not a division there is nothing above it.
  while (/-\d+$/.test(candidate)) {
    candidate = candidate.replace(/-\d+$/, "");
    if (isDivision(candidate)) return candidate;
  }
  return undefined;
}

/** A recovered correspondence between editor lines and assembled lines. */
export interface PreviewLineMap {
  /** Assembled (rendered) line for a 1-based editor line, if it has one. */
  toAssembled(editorLine: number): number | undefined;
  /**
   * Editor line for a 1-based assembled line. Falls back outward to the
   * nearest mapped line *above* it, so clicking a paragraph whose exact start
   * line was not matched still lands on the enclosing element.
   */
  toEditor(assembledLine: number): number | undefined;
  /** How many lines were matched. Zero means sync is unavailable. */
  readonly size: number;
}

/**
 * Recover the line correspondence between one division's source and the
 * assembled document rendered from it.
 *
 * Blank lines are skipped: they carry no identity and would match almost
 * anywhere, dragging the walk out of alignment. Comparison is on trimmed
 * content, since assembly may re-indent what it splices.
 */
export function buildPreviewLineMap(
  editorSource: string,
  assembledSource: string,
): PreviewLineMap {
  const editorLines = editorSource.split("\n");
  const assembledLines = assembledSource.split("\n");

  const editorToAssembled = new Map<number, number>();
  const assembledToEditor = new Map<number, number>();

  // Monotonic: the division's own lines appear in order within the assembled
  // text, so the search never needs to look backwards. That is what keeps this
  // linear in practice and prevents a later line from matching an earlier
  // duplicate (a bare `</p>`, say).
  let cursor = 0;

  for (let i = 0; i < editorLines.length; i++) {
    const needle = editorLines[i].trim();
    if (!needle) continue;

    let probe = cursor;
    while (
      probe < assembledLines.length &&
      assembledLines[probe].trim() !== needle
    ) {
      probe++;
    }
    // Not found ahead: this line was rewritten by assembly. Leave it unmapped
    // and keep the cursor where it was, so following lines can still match.
    if (probe >= assembledLines.length) continue;

    editorToAssembled.set(i + 1, probe + 1);
    assembledToEditor.set(probe + 1, i + 1);
    cursor = probe + 1;
  }

  // Ascending, for the fall-outward lookup below.
  const mappedAssembledLines = [...assembledToEditor.keys()].sort(
    (a, b) => a - b,
  );

  function nearestAt(assembledLine: number): number | undefined {
    let best: number | undefined;
    for (const candidate of mappedAssembledLines) {
      if (candidate > assembledLine) break;
      best = candidate;
    }
    return best;
  }

  return {
    size: editorToAssembled.size,

    toAssembled(editorLine) {
      return editorToAssembled.get(editorLine);
    },

    toEditor(assembledLine) {
      const exact = assembledToEditor.get(assembledLine);
      if (exact !== undefined) return exact;
      // Nearest mapped line at or above — the enclosing element's start.
      const nearest = nearestAt(assembledLine);
      return nearest === undefined ? undefined : assembledToEditor.get(nearest);
    },
  };
}
