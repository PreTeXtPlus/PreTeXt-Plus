/**
 * The shared-document schema for collaborative editing.
 *
 * One Y.Doc per project:
 *
 * - `doc.getMap("divisions")`: key → `Y.Map` entry per division, where the key
 *   is the host's stable record id (the editor falls back to a random UUID for
 *   a division whose host id never materializes). Each entry holds the
 *   division's record fields (`xmlId`, `sourceFormat`, `title`, `type`) plus
 *   its content as a nested `Y.Text` under `"source"` — the CRDT that makes
 *   concurrent character edits merge.
 * - `doc.getMap("meta")`: document-wide fields — `title`, `docinfo`,
 *   `useCommonDocinfo` — all last-writer-wins values.
 *
 * Division *order* needs no structure of its own: ordering lives in the parent
 * division's source as `<plus:* ref="..."/>` placeholders, which is itself
 * collaborative text.
 *
 * Everything here is exported so hosts can seed a fresh doc from their own
 * records (`seedDocFromState`) and serialize the live doc back into records
 * for persistence (`docToState`) without duplicating the layout.
 */
import * as Y from "yjs";
import type { DivisionType } from "../types/sections";
import type { SourceFormat } from "../types/editor";

/** One division as it crosses the doc boundary (seed input / serialize output). */
export interface CollabDivisionSnapshot {
  /** The entry's key in the divisions map — the host's stable record id. */
  id: string;
  xmlId: string;
  sourceFormat: SourceFormat;
  source: string;
  title?: string;
  type?: DivisionType;
}

/** The whole doc as plain data (seed input / serialize output). */
export interface CollabDocState {
  title: string;
  docinfo: string;
  useCommonDocinfo?: boolean;
  divisions: CollabDivisionSnapshot[];
}

export const getDivisionsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>("divisions");

export const getMetaMap = (doc: Y.Doc): Y.Map<unknown> =>
  doc.getMap<unknown>("meta");

/** Build a divisions-map entry (record fields + `Y.Text` source). */
export const makeDivisionEntry = (
  snapshot: Omit<CollabDivisionSnapshot, "id">,
): Y.Map<unknown> => {
  const entry = new Y.Map<unknown>();
  entry.set("xmlId", snapshot.xmlId);
  entry.set("sourceFormat", snapshot.sourceFormat);
  if (snapshot.title !== undefined) entry.set("title", snapshot.title);
  if (snapshot.type !== undefined) entry.set("type", snapshot.type);
  const text = new Y.Text();
  if (snapshot.source) text.insert(0, snapshot.source);
  entry.set("source", text);
  return entry;
};

/** The `Y.Text` holding a division's source, or undefined if absent. */
export const getDivisionText = (
  doc: Y.Doc,
  id: string,
): Y.Text | undefined => {
  const entry = getDivisionsMap(doc).get(id);
  const text = entry?.get("source");
  return text instanceof Y.Text ? text : undefined;
};

/** Read one divisions-map entry back into plain data. */
export const entryToSnapshot = (
  id: string,
  entry: Y.Map<unknown>,
): CollabDivisionSnapshot => {
  const source = entry.get("source");
  return {
    id,
    xmlId: String(entry.get("xmlId") ?? ""),
    sourceFormat: (entry.get("sourceFormat") ?? "pretext") as SourceFormat,
    source: source instanceof Y.Text ? source.toString() : "",
    title: entry.get("title") as string | undefined,
    type: entry.get("type") as DivisionType | undefined,
  };
};

/**
 * Populate an empty doc from host records, in a single transaction. Must only
 * ever run once per project (hosts guard this server-side): two clients each
 * seeding an empty doc and then syncing would duplicate every division's text,
 * since the CRDT rightly treats the two seeds as independent concurrent inserts.
 */
export const seedDocFromState = (doc: Y.Doc, state: CollabDocState): void => {
  doc.transact(() => {
    const meta = getMetaMap(doc);
    meta.set("title", state.title);
    meta.set("docinfo", state.docinfo);
    if (state.useCommonDocinfo !== undefined) {
      meta.set("useCommonDocinfo", state.useCommonDocinfo);
    }
    const divisions = getDivisionsMap(doc);
    for (const division of state.divisions) {
      divisions.set(division.id, makeDivisionEntry(division));
    }
  });
};

/** Serialize the live doc into plain records (host persistence reads this). */
export const docToState = (doc: Y.Doc): CollabDocState => {
  const meta = getMetaMap(doc);
  const divisions: CollabDivisionSnapshot[] = [];
  getDivisionsMap(doc).forEach((entry, id) => {
    divisions.push(entryToSnapshot(id, entry));
  });
  return {
    title: String(meta.get("title") ?? ""),
    docinfo: String(meta.get("docinfo") ?? ""),
    useCommonDocinfo: meta.get("useCommonDocinfo") as boolean | undefined,
    divisions,
  };
};
