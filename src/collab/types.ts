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
}
