/**
 * Ctrl/Cmd+click on a `<plus:* ref="x"/>` placeholder opens the record it
 * names — a division, snippet, exercise or asset — in the code editor.
 *
 * Each placeholder is a Monaco link whose URL is a `command:` URI naming a
 * command the editor registered for itself (see `useRefLinks.ts`), so the link
 * runs in the editor that drew it and nothing is registered globally. Monaco
 * underlines the link while the modifier is held and shows its tooltip on
 * hover.
 *
 * Every placeholder gets a link, whether or not its ref resolves: Monaco only
 * recomputes links when the text changes, so a link left out because its
 * record didn't exist yet (the moment before the missing-division quick fix
 * creates it) would stay missing. What the ref names is settled at click time.
 */

import { parseDivisionRefSpans, parsePlacements } from "../../sectionUtils";
import type { OpenItem } from "../../store/editorStore";
import type { SourceFormat } from "../../types/editor";

export type RefTargetKind = OpenItem["kind"];

export interface RefLink {
  kind: RefTargetKind;
  ref: string;
  /** Offset and length of the whole placeholder in the source. */
  index: number;
  length: number;
  /** The hover text: what a click opens. */
  tooltip: string;
}

/**
 * Every live placeholder in `text`, in document order, with what it names.
 * Commented-out placeholders and examples in verbatim spans are skipped, as
 * everywhere a ref is read as a placement.
 */
export function findRefLinks(text: string, sourceFormat: SourceFormat): RefLink[] {
  const links: RefLink[] = [];
  const placed = new Set<number>();
  for (const { tag, ref, index, length } of parsePlacements(text, sourceFormat)) {
    const kind: RefTargetKind =
      tag === "image" ? "asset" : tag === "snippet" ? "snippet" : "exercise";
    // An exercise placed as a project, activity, … is named by its tag.
    const noun = kind === "exercise" ? tag : kind;
    links.push({ kind, ref, index, length, tooltip: `Open ${noun} "${ref}"` });
    placed.add(index);
  }
  for (const { xmlId, type, generic, index, length } of parseDivisionRefSpans(text, sourceFormat)) {
    // A tag both parsers read is a placement: assembly dispatches those first.
    if (placed.has(index)) continue;
    links.push({
      kind: "division",
      ref: xmlId,
      index,
      length,
      tooltip: `Open ${generic ? "division" : type} "${xmlId}"`,
    });
  }
  return links.sort((a, b) => a.index - b.index);
}

/** The `command:` URI that runs `commandId` with what `link` names. */
export function refLinkUrl(commandId: string, link: Pick<RefLink, "kind" | "ref">): string {
  return `command:${commandId}?${encodeURIComponent(JSON.stringify([link.kind, link.ref]))}`;
}

/** The Monaco links for `links` in `model`, each running `commandId`. */
export function refLinkProviderLinks(model: any, links: readonly RefLink[], commandId: string): any[] {
  return links.map((link) => {
    const start = model.getPositionAt(link.index);
    const end = model.getPositionAt(link.index + link.length);
    return {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      url: refLinkUrl(commandId, link),
      tooltip: link.tooltip,
    };
  });
}
