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
 *   pure pool actions (`addDivisionToPool`, `setDivisionContent`, ...), which
 *   never fire host persistence callbacks — correct, because the remote peer
 *   already persisted its own change, and content persistence in collab mode is
 *   read from the doc itself by the host.
 *
 * Origins: every local write is tagged (`localOrigin`, or a registered Monaco
 * binding), and the observers ignore transactions with those origins. Anything
 * else — the transport applying server updates, another tab — is remote.
 */
import * as Y from "yjs";
import type { Division } from "../types/sections";
import type { DivisionChanges, EditorStoreInstance } from "../store/editorStore";
import type { CollabSession } from "./types";
import {
  entryToSnapshot,
  getDivisionsMap,
  getMetaMap,
  makeDivisionEntry,
  type CollabDivisionSnapshot,
} from "./schema";
import { diffReplace } from "./textDiff";
import {
  extractDivisionMetadata,
  extractLatexDivisionTitle,
  extractMarkdownDivisionMetadata,
} from "../sectionUtils";

// crypto.randomUUID is secure-context-only; collab keys just need uniqueness,
// so fall back to a random token over plain HTTP (dev/test servers).
const randomKey = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `local-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

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
  /** entry key (host record id) ↔ current xmlId, both directions. */
  private readonly keyToXmlId = new Map<string, string>();
  private readonly xmlIdToKey = new Map<string, string>();
  private attached = false;

  // A tiny external-store handle so React re-renders when the set of doc
  // entries changes outside React's flow (a remote add, or a local add whose
  // host id resolved asynchronously) — the active division's Y.Text is looked
  // up per render, so a render must follow entry creation.
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
    getMetaMap(this.doc).observe(this.onMetaEvent);
    this.reconcileFromDoc();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    getDivisionsMap(this.doc).unobserveDeep(this.onDivisionsEvents);
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

  localContentChange(xmlId: string, content: string): void {
    const ytext = this.getYText(xmlId);
    if (!ytext) return; // not (yet) in the doc — content lands when the entry is created
    this.doc.transact(() => diffReplace(ytext, content), this.localOrigin);
  }

  /**
   * Mirror a locally created division into the doc. `idResult` is whatever the
   * host's `onDivisionAdd` returned: the stable record id (possibly async,
   * when the host persists immediately to obtain it). Falls back to a random
   * key for hosts that don't return one; a rejected promise means the host
   * failed to persist, and the division is deliberately left out of the doc
   * (mirroring the host's own failure handling).
   */
  localDivisionAdd(
    division: Division,
    idResult?: string | void | Promise<string | void>,
  ): void {
    Promise.resolve(idResult)
      .then((id) => {
        const key = typeof id === "string" && id ? id : randomKey();
        if (this.xmlIdToKey.has(division.xmlId)) return;
        const divisions = getDivisionsMap(this.doc);
        if (divisions.has(key)) return;
        // Read the live record: edits made while awaiting the id must not be lost.
        const live = this.store
          .getState()
          .divisions?.find((d) => d.xmlId === division.xmlId);
        const record = live ?? division;
        this.doc.transact(() => {
          divisions.set(
            key,
            makeDivisionEntry({
              xmlId: record.xmlId,
              sourceFormat: record.sourceFormat,
              source: record.source,
              title: record.title,
              type: record.type,
            }),
          );
        }, this.localOrigin);
        this.keyToXmlId.set(key, record.xmlId);
        this.xmlIdToKey.set(record.xmlId, key);
        this.bump();
      })
      .catch(() => {
        /* host failed to persist the division; leave it out of the doc */
      });
  }

  localDivisionRemove(xmlId: string): void {
    const key = this.xmlIdToKey.get(xmlId);
    if (!key) return;
    this.doc.transact(() => {
      getDivisionsMap(this.doc).delete(key);
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
   * applied before the observers registered. The doc wins. Store divisions the
   * doc lacks entirely are pushed *into* the doc when they carry a stable id —
   * key collisions are harmless since both writers would write the same
   * content and Y.Map converges per key.
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

    for (const division of state.divisions ?? []) {
      if (!this.xmlIdToKey.has(division.xmlId) && division.id) {
        this.localDivisionAdd(division, division.id);
      }
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
