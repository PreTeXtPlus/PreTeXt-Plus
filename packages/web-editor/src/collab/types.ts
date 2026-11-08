import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

/** Identity shown to other collaborators (avatar chips, remote cursors). */
export interface CollabUser {
  name: string;
  /** Any CSS color; used for this user's cursor and avatar. */
  color: string;
}

/**
 * Everything the editor needs to join a collaborative session. The host owns
 * the transport: it creates the `Y.Doc`, keeps it synced with its server (and
 * seeds it on first use — see `seedDocFromState`), and constructs the
 * `Awareness` instance. The editor only reads/writes the doc through the
 * schema in `schema.ts` and renders presence from the awareness states.
 *
 * `doc` and `awareness` must be created with the same `yjs` / `y-protocols`
 * modules the editor resolves (both are peer dependencies) so shared types
 * flow between host and editor as one instance.
 */
export interface CollabSession {
  doc: Y.Doc;
  awareness: Awareness;
  user: CollabUser;
  /**
   * Told when the bridge refuses or repairs a write that would have left the
   * shared document holding a record the host's rows cannot (see
   * {@link CollabInvariantViolation}). The host reports these — the next
   * malformed record then names its caller — and tells the author about a
   * repair that moved one of their records. Optional; nothing waits on it.
   */
  onInvariantViolation?: (violation: CollabInvariantViolation) => void;
}

/** The kinds of record the shared document holds. */
export type CollabRecordKind = "division" | "asset" | "snippet" | "exercise";

/**
 * What the bridge found wrong with a write, and what it did about it.
 *
 * - `invalid_ref`: a local write wanted to give a record a ref the host's rows
 *   would refuse (`isValidRef`). The write was dropped; the record keeps the
 *   ref it had, or is not created. `operation` names the bridge method and
 *   `stack` where it was called from, since the point is to find the caller.
 * - `duplicate_ref`: two divisions in the document held one `xml:id` (two
 *   collaborators named a division the same thing before either saw the
 *   other's). The editor can only show one division per `xml:id`, so the
 *   bridge renamed the one with the higher record id to `renamedTo`, a free
 *   ref, which every peer computes the same way. The renamed division keeps
 *   its content and appears as unplaced; its placeholder, if any, now points
 *   at the division that kept the id.
 */
export type CollabInvariantViolation =
  | {
      kind: "invalid_ref";
      record: CollabRecordKind;
      id: string;
      ref: string;
      operation: string;
      stack?: string;
    }
  | {
      kind: "duplicate_ref";
      record: "division";
      id: string;
      ref: string;
      renamedTo: string;
    };
