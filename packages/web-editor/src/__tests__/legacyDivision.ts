/**
 * Build division fixtures the way tests find easiest to write them: as the
 * whole source a division used to store, wrapper element included. Not a test
 * file itself (no `.test` suffix), so Vitest doesn't collect it.
 */
import { splitDivisionSource } from "../sectionUtils";
import type { Division } from "../types/sections";

/**
 * `division` with its `source` taken apart into the record's fields and its
 * body (see `splitDivisionSource`). Fields the split finds override the
 * record's; an `xmlId` the source doesn't name is kept from the record.
 */
export function legacyDivision(division: Division): Division {
  const split = splitDivisionSource(division.source, division.sourceFormat, {
    type: division.type,
    title: division.title,
  });
  if (!split.wrapped) return division;
  return {
    ...division,
    xmlId: division.xmlId || split.xmlId,
    type: split.type,
    title: split.title,
    ...(split.label && { label: split.label }),
    ...(Object.keys(split.attrs).length > 0 && { attrs: split.attrs }),
    source: split.body,
  };
}

/** {@link legacyDivision} over a whole pool. */
export const legacyDivisions = (divisions: Division[]): Division[] =>
  divisions.map(legacyDivision);
