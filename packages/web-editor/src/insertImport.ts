/**
 * Bringing an imported document *into* a project that already exists.
 *
 * `@pretextbook/import` does the conversion and hands back records: new
 * division rows, and the `<plus:TYPE ref="…"/>` placeholders that should point
 * at the top-level ones. What is left — and what lives here — is turning those
 * into the two edits this editor actually makes: divisions added to the pool,
 * and one rewrite of the division receiving them.
 *
 * Both have to happen in a single collaborative transaction (see
 * `Editors.tsx`), or peers briefly see a parent referring to divisions they do
 * not have. That is why this is a *plan* rather than a sequence of calls: it
 * computes everything up front so the caller can apply it in one go.
 */
import type {
  DivisionRecord,
  SerializedInsertRecords,
} from "@pretextbook/import";
import type { Division } from "./types/sections";
import {
  extractDivisionMetadata,
  insertDivisionRef,
  parseDivisionRefsWithTypes,
} from "./sectionUtils";

/** The two edits an insert makes, ready to apply together. */
export interface InsertImportPlan {
  /** New divisions for the pool, in import order. */
  divisions: Division[];
  /** The receiving division's source with the new placeholders written in. */
  parentSource: string;
}

/**
 * One imported record as a division this editor can hold.
 *
 * Title and type are read back out of the source rather than carried
 * alongside it, which is the same rule the rest of the editor follows: a
 * PreTeXt division's type *is* its wrapper element's tag name, and hosts do not
 * store either (see `normalizeDivisionsOnLoad`). Deriving them here keeps a
 * division imported into a project indistinguishable from one loaded into it.
 *
 * No record id is set. `applyDivisionAdd` mints one for every division it
 * takes, and it is the single place that owns record identity — an id set here
 * would be replaced, and two mints would only invite them to diverge. An
 * id-less division is exactly the editor's signal for "new".
 */
function divisionFromRecord(record: DivisionRecord): Division {
  const meta = extractDivisionMetadata(record.source);
  return {
    xmlId: record.ref,
    title: meta?.title ?? "",
    // `section` is the fallback the rest of the editor uses for an untyped
    // division, and reaching it means the source had no readable wrapper —
    // which the import should not produce.
    type: meta?.type ?? "section",
    source: record.source,
    sourceFormat: record.sourceFormat,
  };
}

/**
 * Work out the divisions to add and the parent source to write.
 *
 * The placeholders arrive in PreTeXt syntax whatever the receiving division is
 * authored in, so they are parsed for their refs and re-emitted through
 * `insertDivisionRef` in the parent's own format — `\plus{section}{…}` for a
 * LaTeX division, `::section{ref="…"}` for Markdown. Writing the strings
 * through verbatim would put PreTeXt markup in a LaTeX file, where it is text
 * rather than a reference and the division it names would show as orphaned.
 *
 * Each placeholder is anchored after the one before it, so several imported
 * divisions keep the order the document had rather than arriving reversed.
 */
export function planInsertImport(
  records: SerializedInsertRecords,
  parent: Division,
): InsertImportPlan {
  const divisions = records.divisions.map(divisionFromRecord);

  const topLevel = parseDivisionRefsWithTypes(
    records.placeholders.join("\n"),
    "pretext",
  );

  let parentSource = parent.source;
  let after: string | null = null;
  for (const ref of topLevel) {
    parentSource = insertDivisionRef(
      parentSource,
      ref.xmlId,
      ref.type,
      after,
      parent.sourceFormat,
    );
    after = ref.xmlId;
  }

  return { divisions, parentSource };
}

/**
 * Every `ref` already spoken for in this project.
 *
 * Handed to the importer as `takenIds` so a division it mints cannot collide
 * with one that exists. It spans all three record kinds deliberately: the host
 * enforces a single `ref` namespace across divisions, assets and snippets (a
 * `<plus:* ref="x"/>` placeholder is resolved by tag name, not by ref), so a
 * division named after an existing image is rejected on save.
 */
export function takenRefs(
  divisions: readonly { xmlId?: string }[],
  assets: readonly { ref?: string }[] = [],
  snippets: readonly { ref?: string }[] = [],
): string[] {
  // A record with no ref yet — an asset mid-upload — holds no name, so there is
  // nothing for an import to collide with.
  return [
    ...divisions.map((d) => d.xmlId),
    ...assets.map((a) => a.ref),
    ...snippets.map((s) => s.ref),
  ].filter((ref): ref is string => Boolean(ref));
}
