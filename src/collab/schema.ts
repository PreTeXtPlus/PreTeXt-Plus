/**
 * The shared-document schema for collaborative editing.
 *
 * One Y.Doc per project:
 *
 * - `doc.getMap("divisions")`: key → `Y.Map` entry per division, where the key
 *   is the division's record id. Each entry holds the division's record fields
 *   (`xmlId`, `sourceFormat`, `title`, `type`) plus its content as a nested
 *   `Y.Text` under `"source"` — the CRDT that makes concurrent character edits
 *   merge.
 * - `doc.getMap("assets")`: key → `Y.Map` entry per project asset, keyed by the
 *   asset's record id. Metadata only (`ref`, `kind`, `title`, `source`, `url`,
 *   `fileRef`, `isFile`), all last-writer-wins — an asset's *bytes* stay with
 *   the host, since the doc is replicated to every peer and persisted as an
 *   append-only update log. The uploader therefore writes its entry only once
 *   the host has stored the file and handed back a URL; every other peer learns
 *   of the asset from this map rather than from a re-fetch.
 * - `doc.getMap("meta")`: document-wide fields — `title`, `docinfo`,
 *   `useCommonDocinfo` — all last-writer-wins values.
 * - `doc.getMap("deleted")`: tombstones, record id → `"division"` | `"asset"`.
 *   Removing an entry from a Y.Map is not by itself something the host can
 *   observe later: the peer that removed a division persists that removal
 *   immediately, but if its request never lands, nothing in the doc would ever
 *   ask again and a full reload would resurrect the row. A tombstone is what
 *   lets the session leader re-send the `_destroy` from the doc (see
 *   `docToState`), so the host's delete must be idempotent.
 *
 * Record ids are minted by whichever client creates the record (see
 * `src/recordId.ts`) rather than assigned by the host, so an entry can be
 * created in the same tick as the edit that references it.
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
import type { Asset, SourceFormat } from "../types/editor";

/** One division as it crosses the doc boundary (seed input / serialize output). */
export interface CollabDivisionSnapshot {
  /** The entry's key in the divisions map — the division's record id. */
  id: string;
  xmlId: string;
  sourceFormat: SourceFormat;
  source: string;
  title?: string;
  type?: DivisionType;
}

/**
 * One project asset as it crosses the doc boundary. Identical to {@link Asset}
 * except that `id` is required — it is the entry's key in the assets map.
 */
export type CollabAssetSnapshot = Asset & { id: string };

/** Which collection a tombstone refers to, so the host can route its delete. */
export type CollabDeletedKind = "division" | "asset";

/** A record removed during the session, kept so the delete can be re-sent. */
export interface CollabDeletion {
  id: string;
  kind: CollabDeletedKind;
}

/** The whole doc as plain data, as a host supplies it to seed a fresh doc. */
export interface CollabDocState {
  title: string;
  docinfo: string;
  useCommonDocinfo?: boolean;
  divisions: CollabDivisionSnapshot[];
  /** Optional: a project may have no assets, and a host need not seed them. */
  assets?: CollabAssetSnapshot[];
  /**
   * Tombstones. Meaningless in a seed (a fresh doc has deleted nothing) and
   * ignored by {@link seedDocFromState}; always present in `docToState` output.
   */
  deleted?: CollabDeletion[];
}

/** The whole doc as plain data, as `docToState` reads it back out. */
export interface CollabDocSnapshot extends CollabDocState {
  assets: CollabAssetSnapshot[];
  deleted: CollabDeletion[];
}

export const getDivisionsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>("divisions");

export const getAssetsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>("assets");

export const getMetaMap = (doc: Y.Doc): Y.Map<unknown> =>
  doc.getMap<unknown>("meta");

export const getDeletedMap = (doc: Y.Doc): Y.Map<CollabDeletedKind> =>
  doc.getMap<CollabDeletedKind>("deleted");

/** Record a tombstone. Callers are already inside a local transaction. */
export const markDeleted = (
  doc: Y.Doc,
  kind: CollabDeletedKind,
  id: string,
): void => {
  getDeletedMap(doc).set(id, kind);
};

/**
 * Drop tombstones the host has confirmed. A tombstone exists only to make a
 * removal survive a failed request, so once the host reports the record gone it
 * has no further job — and clearing it is what keeps the map from growing for
 * the life of a long session. Safe to call from the host, outside any bridge:
 * the map has no store mirror, so the resulting transaction only travels to
 * peers, where it converges like any other.
 */
export const clearDeletions = (
  doc: Y.Doc,
  deletions: readonly CollabDeletion[],
): void => {
  if (deletions.length === 0) return;
  doc.transact(() => {
    const deleted = getDeletedMap(doc);
    for (const { id } of deletions) deleted.delete(id);
  });
};

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

/**
 * The asset fields the doc carries. Everything an {@link Asset} needs to be
 * usable by a peer that never saw the upload, and nothing derived: `contentType`
 * is a local UI hint from the `File` object, so it is deliberately absent.
 */
const ASSET_FIELDS = [
  "ref",
  "kind",
  "title",
  "source",
  "url",
  "fileRef",
  "isFile",
] as const;

/** Build an assets-map entry. Plain last-writer-wins scalars throughout. */
export const makeAssetEntry = (asset: Asset): Y.Map<unknown> => {
  const entry = new Y.Map<unknown>();
  applyAssetFields(entry, asset);
  return entry;
};

/** Write an asset's fields onto an entry. Callers own the transaction. */
export const applyAssetFields = (entry: Y.Map<unknown>, asset: Asset): void => {
  for (const field of ASSET_FIELDS) {
    const value = asset[field];
    if (value === undefined) entry.delete(field);
    else entry.set(field, value);
  }
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

/** Read one assets-map entry back into plain data. */
export const assetEntryToSnapshot = (
  id: string,
  entry: Y.Map<unknown>,
): CollabAssetSnapshot => ({
  id,
  ref: entry.get("ref") as string | undefined,
  kind: (entry.get("kind") ?? "image") as Asset["kind"],
  title: String(entry.get("title") ?? ""),
  source: entry.get("source") as string | undefined,
  url: entry.get("url") as string | undefined,
  fileRef: entry.get("fileRef") as string | undefined,
  isFile: entry.get("isFile") as boolean | undefined,
});

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
    const assets = getAssetsMap(doc);
    for (const asset of state.assets ?? []) {
      assets.set(asset.id, makeAssetEntry(asset));
    }
  });
};

/** Serialize the live doc into plain records (host persistence reads this). */
export const docToState = (doc: Y.Doc): CollabDocSnapshot => {
  const meta = getMetaMap(doc);
  const divisions: CollabDivisionSnapshot[] = [];
  getDivisionsMap(doc).forEach((entry, id) => {
    divisions.push(entryToSnapshot(id, entry));
  });
  const assets: CollabAssetSnapshot[] = [];
  getAssetsMap(doc).forEach((entry, id) => {
    assets.push(assetEntryToSnapshot(id, entry));
  });
  const deleted: CollabDeletion[] = [];
  getDeletedMap(doc).forEach((kind, id) => {
    deleted.push({ id, kind });
  });
  return {
    title: String(meta.get("title") ?? ""),
    docinfo: String(meta.get("docinfo") ?? ""),
    useCommonDocinfo: meta.get("useCommonDocinfo") as boolean | undefined,
    divisions,
    assets,
    deleted,
  };
};
