// The records a project's collaborative document holds that its saved copy
// does not, as the server reports them: one `{kind, id, ref, reason}` per
// record the last projection had to leave out (see Rails'
// ProjectDocProjection). They arrive with the project JSON at load, and with
// the answer to every flush. Empty means every record reached the saved copy.

const KIND_LABELS = {
  division: "Section",
  asset: "Asset",
  snippet: "Snippet",
  exercise: "Exercise",
};

/** One sentence for an issue, in the author's words. */
export function describeProjectionIssue(issue) {
  const kind = KIND_LABELS[issue.kind] ?? "Record";
  const name = issue.ref ? `with reference ID “${issue.ref}”` : `(id ${String(issue.id).slice(0, 8)}…)`;
  return `${kind} ${name}: ${issue.reason}.`;
}

/**
 * Whether two reports say the same thing, so a banner the author dismissed
 * stays dismissed until the list actually changes.
 */
export function sameProjectionIssues(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (issue, i) => issue.id === b[i].id && issue.kind === b[i].kind && issue.reason === b[i].reason,
  );
}
