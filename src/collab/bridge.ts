/**
 * Two-way sync between the collaborative Y.Doc and the editor's Zustand store.
 *
 * The store remains the editor's authoritative *local* buffer (every component
 * keeps reading it); the doc is the authoritative *shared* state. The bridge
 * keeps them equal:
 *
 * - **local → doc**: EditorsInner calls the `local*` methods from the same
 *   choke points that already update the store (`emitContentChange`, the
 *   `applyDivision*` wrappers, title/docinfo commits). Content strings are
 *   applied to the division's `Y.Text` as a minimal diff, so a whole-string
 *   rewrite (TOC reorder, metadata edit) merges with concurrent remote typing.
 *   Keystrokes in the code editor skip this path entirely — the Monaco binding
 *   writes precise deltas straight into the `Y.Text`, and the debounced
 *   `local*` call that follows becomes a no-op diff.
 *
 * - **doc → store**: observers translate remote transactions into the store's
 *   pure pool actions (`addDivisionToPool`, `setDivisionContent`,
 *   `addAssetToPool`, ...), which never fire host persistence callbacks —
 *   correct, because the remote peer already persisted its own change, and
 *   content persistence in collab mode is read from the doc itself by the host.
 *
 * Origins: every local write is tagged (`localOrigin`, or a registered Monaco
 * binding), and the observers ignore transactions with those origins. Anything
 * else — the transport applying server updates, another tab — is remote.
 *
 * Structural writes that belong together — creating a division and inserting
 * the parent placeholder that points at it, or renaming an xml:id in both
 * places — go through `transact`, so peers never observe the half-applied
 * state in between (a placeholder referring to a division that doesn't exist).
 */
import * as Y from "yjs";
import type { Division } from "../types/sections";
import type { DivisionChanges, EditorStoreInstance } from "../store/editorStore";
import type { Asset, AssetKind } from "../types/editor";
import type { CollabSession } from "./types";
import {
  applyAssetFields,
  assetEntryToSnapshot,
  entryToSnapshot,
  getAssetsMap,
  getDeletedMap,
  getDivisionsMap,
  getMetaMap,
  makeAssetEntry,
  makeDivisionEntry,
  markDeleted,
  type CollabDivisionSnapshot,
} from "./schema";
import { diffReplace } from "./textDiff";
import {
  extractDivisionMetadata,
  extractLatexDivisionTitle,
  extractMarkdownDivisionMetadata,
} from "../sectionUtils";

/** The store pool's identity for an asset, as one comparable string. */
const assetRefKey = (kind: AssetKind, ref: string | undefined): string =>
  `${kind}:${ref ?? ""}`;

/** Inverse of {@link assetRefKey}. A ref may itself contain no colon (REF_REGEX). */
const splitAssetRefKey = (key: string): [AssetKind, string] => {
  const separator = key.indexOf(":");
  return [key.slice(0, separator) as AssetKind, key.slice(separator + 1)];
};

/** Division record derived from a doc entry, for insertion into the store pool. */
const snapshotToRecord = (snapshot: CollabDivisionSnapshot): Division => {
  // Prefer the record fields the remote actor carried on the entry; fall back
  // to deriving them from the source itself (same derivations the store's
  // load-time normalization uses), since title/type are required on Division.
  let title = snapshot.title;
  let type = snapshot.type;
  if (title === undefined || type === undefined) {
    const meta =
      snapshot.sourceFormat === "markdown"
        ? extractMarkdownDivisionMetadata(snapshot.source)
        : snapshot.sourceFormat === "pretext"
          ? extractDivisionMetadata(snapshot.source)
          : null;
    title ??=
      meta?.title ??
      (snapshot.sourceFormat === "latex"
        ? (extractLatexDivisionTitle(snapshot.source) ?? "")
        : "");
    type ??= meta?.type ?? "section";
  }
  return {
    id: snapshot.id,
    xmlId: snapshot.xmlId,
    sourceFormat: snapshot.sourceFormat,
    source: snapshot.source,
    title,
    type,
  };
};

export class CollabBridge {
  /** Origin tag for the bridge's own doc transactions. */
  readonly localOrigin: object = { collabBridge: true };

  private readonly doc: Y.Doc;
  private readonly store: EditorStoreInstance;
  private readonly session: CollabSession;
  /** All origins considered "local" (the bridge itself + live Monaco bindings). */
  private readonly localOrigins = new Set<unknown>();
  /** entry key (record id) ↔ current xmlId, both directions. */
  private readonly keyToXmlId = new Map<string, string>();
  private readonly xmlIdToKey = new Map<string, string>();
  /**
   * Asset entry key (record id) ↔ current `kind:ref`, both directions. The doc
   * keys assets by record id; the store's pool keys them by kind+ref, so a
   * remote `ref` rename has to be dispatched as a rename of a *known* old key.
   */
  private readonly keyToAssetRef = new Map<string, string>();
  private readonly assetRefToKey = new Map<string, string>();
  private attached = false;

  // A tiny external-store handle so React re-renders when the set of doc
  // entries changes outside React's flow (a remote add, or a local one) — the
  // active division's Y.Text is looked up per render, so a render must follow
  // entry creation.
  private version = 0;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;
  private bump(): void {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  constructor(session: CollabSession, store: EditorStoreInstance) {
    this.session = session;
    this.doc = session.doc;
    this.store = store;
    this.localOrigins.add(this.localOrigin);
  }

  /** Register a Monaco binding (or other local writer) so its transactions aren't echoed back. */
  registerLocalOrigin(origin: unknown): void {
    this.localOrigins.add(origin);
  }
  unregisterLocalOrigin(origin: unknown): void {
    this.localOrigins.delete(origin);
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.session.awareness.setLocalStateField("user", this.session.user);
    getDivisionsMap(this.doc).observeDeep(this.onDivisionsEvents);
    getAssetsMap(this.doc).observeDeep(this.onAssetsEvents);
    getMetaMap(this.doc).observe(this.onMetaEvent);
    this.reconcileFromDoc();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    getDivisionsMap(this.doc).unobserveDeep(this.onDivisionsEvents);
    getAssetsMap(this.doc).unobserveDeep(this.onAssetsEvents);
    getMetaMap(this.doc).unobserve(this.onMetaEvent);
  }

  /** The shared text for a division, by the editor's identity (xmlId). */
  getYText(xmlId: string): Y.Text | undefined {
    const key = this.xmlIdToKey.get(xmlId);
    if (!key) return undefined;
    const entry = getDivisionsMap(this.doc).get(key);
    const text = entry?.get("source");
    return text instanceof Y.Text ? text : undefined;
  }

  // ── local → doc ──────────────────────────────────────────────────────────

  /**
   * Run several local doc writes as one transaction, so peers apply them
   * together. Nesting is safe — Yjs collapses inner `transact` calls into the
   * outermost one, and every `local*` method below uses the same origin, so a
   * wrapped call keeps its local tag.
   */
  transact(run: () => void): void {
    this.doc.transact(run, this.localOrigin);
  }

  localContentChange(xmlId: string, content: string): void {
    const ytext = this.getYText(xmlId);
    if (!ytext) return; // not (yet) in the doc — content lands when the entry is created
    this.doc.transact(() => diffReplace(ytext, content), this.localOrigin);
  }

  /**
   * Mirror a locally created division into the doc, synchronously, keyed by the
   * `id` the editor minted for it (see `src/recordId.ts`). Nothing here waits
   * on the host: the entry exists for peers as soon as the transaction leaves,
   * and the host persists the same record under the same id on its own
   * schedule. A host that fails to persist therefore leaves a division in the
   * doc rather than losing it — the session leader's next save retries it,
   * which is what the host's create being an upsert buys.
   */
  localDivisionAdd(division: Division): void {
    if (!division.id) return;
    if (this.xmlIdToKey.has(division.xmlId)) return;
    const divisions = getDivisionsMap(this.doc);
    if (divisions.has(division.id)) return;
    this.doc.transact(() => {
      divisions.set(
        division.id as string,
        makeDivisionEntry({
          xmlId: division.xmlId,
          sourceFormat: division.sourceFormat,
          source: division.source,
          title: division.title,
          type: division.type,
        }),
      );
      // A division created now and removed later in the same session must not
      // be resurrected by a stale tombstone from an earlier record under the
      // same id (host ids are unique, so this only guards re-creation flows).
      getDeletedMap(this.doc).delete(division.id as string);
    }, this.localOrigin);
    this.keyToXmlId.set(division.id, division.xmlId);
    this.xmlIdToKey.set(division.xmlId, division.id);
    this.bump();
  }

  localDivisionRemove(xmlId: string): void {
    const key = this.xmlIdToKey.get(xmlId);
    if (!key) return;
    this.doc.transact(() => {
      getDivisionsMap(this.doc).delete(key);
      markDeleted(this.doc, "division", key);
    }, this.localOrigin);
    this.keyToXmlId.delete(key);
    this.xmlIdToKey.delete(xmlId);
    this.bump();
  }

  localDivisionUpdate(xmlId: string, changes: DivisionChanges): void {
    const key = this.xmlIdToKey.get(xmlId);
    if (!key) return;
    const entry = getDivisionsMap(this.doc).get(key);
    if (!entry) return;
    this.doc.transact(() => {
      if (changes.xmlId != null && changes.xmlId !== xmlId) {
        entry.set("xmlId", changes.xmlId);
      }
      if (changes.sourceFormat !== undefined) {
        entry.set("sourceFormat", changes.sourceFormat);
      }
      if (changes.title !== undefined) entry.set("title", changes.title);
      if (changes.type !== undefined) entry.set("type", changes.type);
    }, this.localOrigin);
    if (changes.xmlId != null && changes.xmlId !== xmlId) {
      this.keyToXmlId.set(key, changes.xmlId);
      this.xmlIdToKey.delete(xmlId);
      this.xmlIdToKey.set(changes.xmlId, key);
    }
  }

  /**
   * Mirror a locally added project asset into the doc. Unlike a division this
   * *does* follow the host: an asset's bytes can't ride in the doc, so the
   * uploader waits for the host to store the file and hand back a URL, and only
   * then publishes the finished record here. Peers pick the asset up from this
   * entry — never from a re-fetch of the host, which wouldn't yet know about
   * assets other peers added.
   */
  localAssetAdd(asset: Asset): void {
    if (!asset.id) return;
    const assets = getAssetsMap(this.doc);
    this.doc.transact(() => {
      const existing = assets.get(asset.id as string);
      if (existing) applyAssetFields(existing, asset);
      else assets.set(asset.id as string, makeAssetEntry(asset));
      getDeletedMap(this.doc).delete(asset.id as string);
    }, this.localOrigin);
    this.trackAssetKey(asset.id, asset);
    this.bump();
  }

  /**
   * Mirror an edit to an asset's fields. `previousRef` names the ref the asset
   * had before this edit, when the edit renames it — the store pool keys on
   * kind+ref, so the bridge has to move its own index along with the doc.
   */
  localAssetUpdate(asset: Asset, previousRef?: string): void {
    const key =
      asset.id ??
      this.assetRefToKey.get(assetRefKey(asset.kind, previousRef ?? asset.ref));
    if (!key) return;
    const assets = getAssetsMap(this.doc);
    this.doc.transact(() => {
      const entry = assets.get(key);
      if (entry) applyAssetFields(entry, asset);
      else assets.set(key, makeAssetEntry(asset));
    }, this.localOrigin);
    // `previousRef` located the entry above; retiring the old `kind:ref` index
    // is trackAssetKey's job, and it only does so when this key still owns it.
    this.trackAssetKey(key, asset);
    this.bump();
  }

  localAssetRemove(asset: Asset): void {
    const key = asset.id ?? this.assetRefToKey.get(assetRefKey(asset.kind, asset.ref));
    if (!key) return;
    this.doc.transact(() => {
      getAssetsMap(this.doc).delete(key);
      markDeleted(this.doc, "asset", key);
    }, this.localOrigin);
    this.untrackAssetKey(key);
    this.bump();
  }

  private trackAssetKey(key: string, asset: Asset): void {
    this.untrackAssetKey(key);
    const current = assetRefKey(asset.kind, asset.ref);
    this.keyToAssetRef.set(key, current);
    this.assetRefToKey.set(current, key);
  }

  /**
   * Forget an asset key, returning the `kind:ref` it held — but only if it
   * still held it. Two records can briefly share a ref (Replace hands the
   * replacement the old asset's ref before the old one is dropped), and the
   * loser of that overlap must not tear down the winner's mapping, nor be
   * reported to the pool as owning a ref that has moved on.
   */
  private untrackAssetKey(key: string): string | undefined {
    const previous = this.keyToAssetRef.get(key);
    this.keyToAssetRef.delete(key);
    if (previous === undefined) return undefined;
    if (this.assetRefToKey.get(previous) !== key) return undefined;
    this.assetRefToKey.delete(previous);
    return previous;
  }

  localTitleChange(title: string): void {
    this.doc.transact(() => {
      getMetaMap(this.doc).set("title", title);
    }, this.localOrigin);
  }

  localDocinfoChange(docinfo: string, useCommonDocinfo?: boolean): void {
    this.doc.transact(() => {
      const meta = getMetaMap(this.doc);
      meta.set("docinfo", docinfo);
      if (useCommonDocinfo !== undefined) {
        meta.set("useCommonDocinfo", useCommonDocinfo);
      }
    }, this.localOrigin);
  }

  // ── doc → store ──────────────────────────────────────────────────────────

  private isLocal(transaction: Y.Transaction): boolean {
    return this.localOrigins.has(transaction.origin);
  }

  /**
   * One-time doc → store reconciliation at attach. The doc may already be
   * ahead of the records the store was seeded from (another client edited
   * between the host's data fetch and the doc sync), and updates may have been
   * applied before the observers registered. The doc wins. Store records the
   * doc lacks entirely are pushed *into* the doc when they carry a stable id —
   * key collisions are harmless since both writers would write the same
   * content and Y.Map converges per key.
   *
   * Assets follow the same rule, with one addition: an asset the doc *knows to
   * have been deleted* is dropped from the pool. The `projectAssets` prop is a
   * snapshot of the host taken before this client joined, so it can easily
   * still list an asset a peer removed minutes ago.
   */
  private reconcileFromDoc(): void {
    const state = this.store.getState();
    const divisions = getDivisionsMap(this.doc);

    divisions.forEach((entry, key) => {
      const snapshot = entryToSnapshot(key, entry);
      this.keyToXmlId.set(key, snapshot.xmlId);
      this.xmlIdToKey.set(snapshot.xmlId, key);
      const existing = state.divisions?.find((d) => d.xmlId === snapshot.xmlId);
      if (!existing) {
        state.addDivisionToPool(snapshotToRecord(snapshot));
      } else {
        if (existing.source !== snapshot.source) {
          state.setDivisionContent(snapshot.xmlId, snapshot.source);
        }
        if (
          snapshot.sourceFormat !== existing.sourceFormat ||
          (snapshot.title !== undefined && snapshot.title !== existing.title) ||
          (snapshot.type !== undefined && snapshot.type !== existing.type)
        ) {
          state.patchDivision(snapshot.xmlId, {
            sourceFormat: snapshot.sourceFormat,
            title: snapshot.title,
            type: snapshot.type,
          });
        }
      }
    });

    const deleted = getDeletedMap(this.doc);

    for (const division of [...(this.store.getState().divisions ?? [])]) {
      if (!division.id || this.xmlIdToKey.has(division.xmlId)) continue;
      // A division the doc knows was deleted must not be pushed back in: the
      // `divisions` prop is a snapshot of the host taken before this client
      // joined, so it can still list one a peer removed minutes ago.
      if (deleted.get(division.id) === "division") {
        state.removeDivisionFromPool(division.xmlId);
        continue;
      }
      this.localDivisionAdd(division);
    }

    const assets = getAssetsMap(this.doc);
    assets.forEach((entry, key) => {
      const snapshot = assetEntryToSnapshot(key, entry);
      this.trackAssetKey(key, snapshot);
      // Match the pool entry by record id, not by kind+ref: a peer may have
      // renamed the ref since the prop we were seeded from was read, and
      // updating under the new ref alone would leave the old one behind as a
      // duplicate.
      const pooled = this.store
        .getState()
        .projectAssets?.find((a) => a.id === key);
      if (pooled && pooled.ref !== snapshot.ref) {
        state.renameAssetInPool(pooled.kind, pooled.ref ?? "", snapshot);
      } else {
        state.updateAssetInPool(snapshot);
      }
    });

    for (const asset of [...(this.store.getState().projectAssets ?? [])]) {
      if (!asset.id) continue;
      if (deleted.get(asset.id) === "asset") state.removeAssetFromPool(asset);
      else if (!assets.has(asset.id)) this.localAssetAdd(asset);
    }

    const meta = getMetaMap(this.doc);
    const title = meta.get("title");
    if (typeof title === "string" && title !== state.title) {
      state.setTitle(title);
    }
    const docinfo = meta.get("docinfo");
    const useCommon = meta.get("useCommonDocinfo");
    if (
      (typeof docinfo === "string" && docinfo !== state.docinfo) ||
      (typeof useCommon === "boolean" && useCommon !== state.useCommonDocinfo)
    ) {
      state.setDocinfo({
        docinfo: typeof docinfo === "string" ? docinfo : state.docinfo,
        commonDocinfo: state.commonDocinfo,
        useCommonDocinfo:
          typeof useCommon === "boolean" ? useCommon : state.useCommonDocinfo,
      });
    }
    this.bump();
  }

  private onDivisionsEvents = (
    events: Y.YEvent<any>[],
    transaction: Y.Transaction,
  ): void => {
    if (this.isLocal(transaction)) return;
    const state = this.store.getState();
    const divisions = getDivisionsMap(this.doc);
    let structureChanged = false;

    for (const event of events) {
      if (event.target === divisions) {
        // Top level: entries added/removed.
        event.changes.keys.forEach((change, key) => {
          if (change.action === "add") {
            const entry = divisions.get(key);
            if (!entry) return;
            const snapshot = entryToSnapshot(key, entry);
            this.keyToXmlId.set(key, snapshot.xmlId);
            this.xmlIdToKey.set(snapshot.xmlId, key);
            state.addDivisionToPool(snapshotToRecord(snapshot));
            structureChanged = true;
          } else if (change.action === "delete") {
            const xmlId = this.keyToXmlId.get(key);
            this.keyToXmlId.delete(key);
            if (xmlId === undefined) return;
            this.xmlIdToKey.delete(xmlId);
            state.removeDivisionFromPool(xmlId);
            structureChanged = true;
            // Never leave the editor pointing at a removed division.
            if (this.store.getState().activeDivisionId === xmlId) {
              const remaining = this.store.getState().divisions ?? [];
              const fallback =
                remaining.find(
                  (d) =>
                    d.type === "book" ||
                    d.type === "article" ||
                    d.type === "slideshow",
                ) ?? remaining[0];
              state.setActiveDivisionId(fallback?.xmlId ?? null);
            }
          }
        });
      } else if (event.target instanceof Y.Text) {
        // A division's source text changed. Path is [entryKey, "source"].
        const key = String(event.path[0]);
        const xmlId = this.keyToXmlId.get(key);
        if (xmlId === undefined) continue;
        state.setDivisionContent(xmlId, event.target.toString());
      } else if (event.target instanceof Y.Map && event.path.length === 1) {
        // Record fields on one entry changed (rename, retype, format switch).
        const key = String(event.path[0]);
        const oldXmlId = this.keyToXmlId.get(key);
        const entry = divisions.get(key);
        if (oldXmlId === undefined || !entry) continue;
        const snapshot = entryToSnapshot(key, entry);
        const changes: DivisionChanges = {};
        event.changes.keys.forEach((_, field) => {
          if (field === "xmlId") changes.xmlId = snapshot.xmlId;
          if (field === "sourceFormat") changes.sourceFormat = snapshot.sourceFormat;
          if (field === "title" && snapshot.title !== undefined) {
            changes.title = snapshot.title;
          }
          if (field === "type" && snapshot.type !== undefined) {
            changes.type = snapshot.type;
          }
        });
        if (Object.keys(changes).length === 0) continue;
        state.patchDivision(oldXmlId, changes);
        if (changes.xmlId != null && changes.xmlId !== oldXmlId) {
          this.keyToXmlId.set(key, changes.xmlId);
          this.xmlIdToKey.delete(oldXmlId);
          this.xmlIdToKey.set(changes.xmlId, key);
          if (this.store.getState().activeDivisionId === oldXmlId) {
            state.setActiveDivisionId(changes.xmlId);
          }
          structureChanged = true;
        }
      }
    }

    if (structureChanged) this.bump();
  };

  /**
   * Remote asset changes → the store's pool. The pool keys on kind+ref while
   * the doc keys on record id, so a field change that moved `ref` has to be
   * replayed as a rename from the ref this bridge last saw for that key.
   */
  private onAssetsEvents = (
    events: Y.YEvent<any>[],
    transaction: Y.Transaction,
  ): void => {
    if (this.isLocal(transaction)) return;
    const state = this.store.getState();
    const assets = getAssetsMap(this.doc);

    for (const event of events) {
      if (event.target === assets) {
        event.changes.keys.forEach((change, key) => {
          if (change.action === "delete") {
            // Undefined when this record no longer owns the ref — another
            // record took it over (Replace), and dropping that ref from the
            // pool now would remove the wrong asset.
            const previous = this.untrackAssetKey(key);
            if (previous === undefined) return;
            const [kind, ref] = splitAssetRefKey(previous);
            state.removeAssetFromPool({ id: key, kind, ref, title: "" });
            return;
          }
          const entry = assets.get(key);
          if (!entry) return;
          this.applyRemoteAsset(key, assetEntryToSnapshot(key, entry));
        });
      } else if (event.target instanceof Y.Map && event.path.length === 1) {
        const key = String(event.path[0]);
        const entry = assets.get(key);
        if (!entry) continue;
        this.applyRemoteAsset(key, assetEntryToSnapshot(key, entry));
      }
    }

    this.bump();
  };

  private applyRemoteAsset(key: string, asset: Asset): void {
    const state = this.store.getState();
    const previous = this.keyToAssetRef.get(key);
    const current = assetRefKey(asset.kind, asset.ref);
    // Rename only when this record still owns the ref it is moving away from;
    // otherwise the pool entry under that ref belongs to someone else.
    if (
      previous !== undefined &&
      previous !== current &&
      this.assetRefToKey.get(previous) === key
    ) {
      const [kind, ref] = splitAssetRefKey(previous);
      state.renameAssetInPool(kind, ref, asset);
    } else {
      state.updateAssetInPool(asset);
    }
    this.trackAssetKey(key, asset);
  }

  private onMetaEvent = (
    event: Y.YMapEvent<unknown>,
    transaction: Y.Transaction,
  ): void => {
    if (this.isLocal(transaction)) return;
    const state = this.store.getState();
    const meta = getMetaMap(this.doc);
    event.changes.keys.forEach((_, key) => {
      if (key === "title") {
        const title = meta.get("title");
        if (typeof title === "string") state.setTitle(title);
      } else if (key === "docinfo" || key === "useCommonDocinfo") {
        const docinfo = meta.get("docinfo");
        const useCommon = meta.get("useCommonDocinfo");
        const current = this.store.getState();
        current.setDocinfo({
          docinfo: typeof docinfo === "string" ? docinfo : current.docinfo,
          commonDocinfo: current.commonDocinfo,
          useCommonDocinfo:
            typeof useCommon === "boolean"
              ? useCommon
              : current.useCommonDocinfo,
        });
      }
    });
  };
}
