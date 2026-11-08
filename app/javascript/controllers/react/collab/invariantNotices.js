// What the editor's write boundary reports (the web-editor's
// CollabInvariantViolation), turned into the incident the server records and,
// when the author should hear about it, the sentence they see.

/** The CollabIncidentsController kind for a violation. */
export function incidentKindFor(violation) {
  return violation.kind === "duplicate_ref" ? "duplicate_ref" : "malformed_record";
}

/**
 * The report's free-text detail: everything but the stack, which goes on the
 * end so the server's truncation cuts the least useful part first.
 */
export function incidentDetailFor(violation) {
  const { stack, ...rest } = violation;
  return stack ? `${JSON.stringify(rest)}\n${stack}` : JSON.stringify(rest);
}

/**
 * The notice an author sees for a repair that moved one of their records, or
 * null for a violation that only concerns us (a refused write changed nothing
 * they can see).
 */
export function describeInvariantViolation(violation) {
  if (violation.kind !== "duplicate_ref") return null;
  return (
    `Two sections were given the reference ID “${violation.ref}” at the same time. ` +
    `The one created second was renamed to “${violation.renamedTo}” and is listed under ` +
    "Unplaced divisions, where you can place it or remove it."
  );
}
