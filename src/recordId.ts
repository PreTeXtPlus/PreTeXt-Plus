/**
 * Record ids the editor mints for itself.
 *
 * A division or asset created in the editor gets its `id` here rather than
 * from the host's database. That ordering is what makes collaborative creation
 * work: the record can enter the shared document (keyed by this id) in the same
 * tick it enters the local pool, instead of waiting on a round trip during
 * which peers would see a `<plus:* ref="…"/>` placeholder pointing at nothing.
 * The host persists the record *under* the id it is given — see the
 * `onDivisionAdd` / `onAssetUpload` prop docs.
 *
 * A UUID, because that is what the ids being replaced are: hosts store these
 * as uuid primary keys, so a client-minted one is directly insertable.
 */
export function newRecordId(): string {
  // crypto.randomUUID is secure-context-only, and dev/test servers run plain
  // HTTP. The fallback only needs uniqueness, not unguessability.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = () => Math.random().toString(16).slice(2, 10);
  return `${random()}-${random().slice(0, 4)}-4${random().slice(0, 3)}-a${random().slice(0, 3)}-${random()}${random().slice(0, 4)}`;
}
