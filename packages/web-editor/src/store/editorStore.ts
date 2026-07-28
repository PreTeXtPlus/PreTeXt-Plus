/**
 * Per-instance Zustand store for the Editors component.
 *
 * ARCHITECTURE NOTE — the store owns the live editing buffer:
 * `createEditorStore(init)` seeds the editing buffer (`divisions`, `title`,
 * `docinfo`, `activeDivisionId`, …) from the host's initial props *once*.
 * After that, the store is authoritative for what's being edited:
 *   • Internal edit actions (`setDivisionContent`, `patchDivision`, `setTitle`,
 *     …) update the store optimistically and the host callbacks are fired
 *     purely as notifications (so the host can persist/autosave).  A host is no
 *     longer required to echo every edit back as new props for it to display.
 *   • Genuine external updates (a save that reconciles server-assigned ids, or
 *     swapping to a different project) still win: Editors.tsx detects when a
 *     controlled prop actually changes since the last render and calls
 *     `applyExternalUpdate()` to overwrite the buffer.  A stale prop that the
 *     host simply never updated is NOT re-applied, so it can't clobber a local
 *     edit.
 *
 * Derived/config fields that are never edited locally (`source`, `sourceFormat`,
 * `projectAssets`, `projectType`, `rootDivisionId`, …) are still mirrored from
 * props every render via `syncState()`.
 *
 * Callback stability: createEditorStore returns a `bindCallbacks` function that
 * EditorsInner calls from useLayoutEffect after every render. Store actions
 * close over an internal mutable bag (`bag.cbs`) rather than React refs, so
 * they are stable while always calling the latest mode-routed callback.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Asset, AssetKind, FeedbackSubmission, SourceFormat } from "../types/editor";
import type { Division, DivisionType } from "../types/sections";
import type { EditDraft } from "../components/toc/types";
import {
  getSectionAttributes,
  extractLatexSectionLabel,
  extractMarkdownDivisionMetadata,
  sanitizeXmlId,
} from "../sectionUtils";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Asset identity within a project: a `<plus:KIND ref="..."/>` placeholder is
 * resolved by kind+ref, so that pair (not the host's `id`) is what every
 * lookup and pool mutation keys on.
 */
const sameAssetRef = (a: Asset, b: Asset): boolean =>
  a.kind === b.kind && a.ref === b.ref;

// ── Types ───────────────────────────────────────────────────────────────────

export type DivisionChanges = {
  title?: string;
  type?: DivisionType;
  xmlId?: string | null;
  sourceFormat?: SourceFormat;
  label?: string | null;
};

/**
 * A batch of editing-buffer fields the host has genuinely changed (an external
 * reset).  Only the provided fields are overwritten in the store; omitted
 * fields keep their current — possibly locally edited — value.
 */
export interface ExternalUpdate {
  divisions?: Division[];
  projectAssets?: Asset[];
  rootDivisionId?: string;
  activeDivisionId?: string | null;
  title?: string;
  docinfo?: string;
  commonDocinfo?: string;
  useCommonDocinfo?: boolean;
}

type ModalKey =
  | "isLatexDialogOpen"
  | "isConvertDialogOpen"
  | "isDocinfoEditorOpen"
  | "isAssetPickerOpen"
  | "isFullSourceOpen";

/**
 * All callbacks wired by Editors.tsx that deep components need to call.
 * Updated on every render via `callbacksRef.current = { ... }`.
 * Actions in the store call through this ref, so they stay stable even as
 * the callbacks close over changing state.
 */
export interface EditorCallbacks {
  selectDivision: (id: string) => void;
  /** Add a new division as the last child of `parentXmlId` (or unplaced if `null`). */
  addDivision: (parentXmlId: string | null) => void;
  removeDivision: (id: string) => void;
  updateDivision: (id: string, changes: DivisionChanges) => void;
  /** Emit a content change for a specific division (edit or structural reorder). */
  divisionContentChange: (xmlId: string, content: string) => void;
  handleDivisionContentChange: (content: string | undefined) => void;
  assetInsert: (asset: Asset) => void;
  /** Remove a project asset (optimistic pool drop + host persistence). */
  assetRemove?: (asset: Asset) => void;
  /** Remove every `<plus:KIND ref/>` placeholder for an unresolved ref from source. */
  assetRefRemove?: (kind: AssetKind, ref: string) => void;
  /** Duplicate a project asset under a fresh ref (host persists + pool add). */
  assetDuplicate?: (asset: Asset) => void | Promise<void>;
  updateTitle: (title: string) => void;
  feedbackSubmit?: (feedback: FeedbackSubmission) => void | Promise<void>;
  insertContentAtCursor?: (content: string) => void;
}

export interface EditorStoreState {
  // ── Data synced from host props ───────────────────────────────────────────

  source: string;
  sourceFormat: SourceFormat;
  /**
   * Authoritative project-asset pool — owned by the store as a live editing
   * buffer, exactly like {@link EditorStoreState.divisions}. Seeded once from
   * the host's `projectAssets` prop, then mutated optimistically by
   * `addAssetToPool`/`updateAssetInPool`/`removeAssetFromPool` (host callbacks
   * fire purely as persistence notifications). A genuine external change to the
   * prop wins via `applyExternalUpdate`, but a stale prop the host never updated
   * can't clobber a just-created asset — so an asset is editable the instant
   * it's added, without waiting for the host to echo it back.
   */
  projectAssets: Asset[] | undefined;
  title: string;
  docinfo: string;
  commonDocinfo: string;
  useCommonDocinfo: boolean;
  projectType: "article" | "book" | undefined;
  projectUrl: string | undefined;

  // Divisions (host-controlled pool)
  divisions: Division[] | undefined;
  rootDivisionId: string | undefined;
  activeDivisionId: string | null;

  // Computed flags (re-derived each sync)
  canConvertToPretext: boolean;

  /** The source string currently open in the code editor. */
  activeEditorSource: string;

  /** True when the host passed `onFeedbackSubmit`. Controls whether feedback UI is shown. */
  hasFeedback: boolean;

  /** True when the host passed `onAssetDuplicate`. Controls whether Duplicate is offered. */
  hasAssetDuplicate: boolean;

  // ── UI state owned by the store ────────────────────────────────────────────

  isTocCollapsed: boolean;
  showLivePreview: boolean;
  isNarrowScreen: boolean;
  activeTab: "editor" | "preview";
  isLatexDialogOpen: boolean;
  isConvertDialogOpen: boolean;
  isDocinfoEditorOpen: boolean;
  isAssetPickerOpen: boolean;
  isFullSourceOpen: boolean;

  // TOC inline edit form
  editingId: string | null;
  editDraft: EditDraft | null;
  /** True while `editDraft` belongs to a just-created, not-yet-saved division. */
  editingIsNew: boolean;

  /** The asset currently open in the asset edit modal, identified by kind+ref. */
  editingAssetRef: { kind: AssetKind; ref: string } | null;

  /**
   * An unresolved placeholder the user is resolving — opens the asset manager
   * in "resolve this ref" mode, where picking/uploading binds the result to
   * this `kind`+`ref` instead of copying an embed code.
   */
  assetResolveTarget: { kind: AssetKind; ref: string } | null;

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Sync a batch of derived/controlled data from Editors into the store. */
  syncState: (partial: Partial<EditorSyncableState>) => void;

  // ── Authoritative editing-buffer actions ───────────────────────────────────
  /** Apply a genuine external update from the host (host wins). */
  applyExternalUpdate: (partial: ExternalUpdate) => void;
  /** Optimistically set a division's content in the local pool. */
  setDivisionContent: (xmlId: string, content: string) => void;
  /** Optimistically patch a division's metadata (title/type/xml:id/format). */
  patchDivision: (xmlId: string, changes: DivisionChanges) => void;
  /** Optimistically add a division to the local pool (no-op if it exists). */
  addDivisionToPool: (division: Division) => void;
  /** Optimistically remove a division from the local pool. */
  removeDivisionFromPool: (xmlId: string) => void;
  /** Set the active (open-for-editing) division id. */
  setActiveDivisionId: (id: string | null) => void;
  /** Optimistically set the document title. */
  setTitle: (title: string) => void;
  /** Optimistically set the docinfo-related fields together. */
  setDocinfo: (info: {
    docinfo: string;
    commonDocinfo: string;
    useCommonDocinfo: boolean;
  }) => void;

  // UI
  setShowLivePreview: (show: boolean) => void;
  setActiveTab: (tab: "editor" | "preview") => void;
  setIsNarrowScreen: (narrow: boolean) => void;
  setIsTocCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  openModal: (modal: ModalKey) => void;
  closeModal: (modal: ModalKey) => void;

  // TOC section / division actions (stable — delegate to bag.cbs)
  selectSection: (id: string) => void;
  addSection: (parentXmlId: string | null) => void;
  removeSection: (id: string) => void;
  updateSection: (id: string, changes: DivisionChanges) => void;
  /** Update a parent division's content after a structural DnD change. */
  divisionContentChange: (xmlId: string, content: string) => void;

  // TOC inline edit form
  startSectionEdit: (section: Division, options?: { isNew?: boolean }) => void;
  setEditDraft: (draft: EditDraft) => void;
  commitSectionEdit: () => void;
  cancelSectionEdit: () => void;

  // Assets / content
  insertAsset: (asset: Asset) => void;
  insertAtCursor: (content: string) => void;
  /** Open the asset edit modal for the asset identified by `kind`+`ref`. */
  openAssetEditor: (kind: AssetKind, ref: string) => void;
  closeAssetEditor: () => void;
  /** Open the asset manager in resolve mode for an unresolved `kind`+`ref`. */
  openAssetResolver: (kind: AssetKind, ref: string) => void;
  closeAssetResolver: () => void;
  /** Remove a project asset (pool + host persistence). */
  removeAsset: (asset: Asset) => void;
  /** Remove every placeholder for an unresolved `kind`+`ref` from the document. */
  removeAssetRefFromDocument: (kind: AssetKind, ref: string) => void;
  /** Duplicate a project asset under a fresh ref. Resolves when the host settles. */
  duplicateAsset: (asset: Asset) => Promise<void>;
  /**
   * Optimistically add an asset to the pool (no-op if one with the same
   * kind+ref already exists). Used when an asset is uploaded, created, added
   * from the library, or inserted, so it's editable immediately.
   */
  addAssetToPool: (asset: Asset) => void;
  /**
   * Optimistically replace the pool entry matching `asset` by kind+ref (adding
   * it if absent). Used when an asset's content/source is edited.
   */
  updateAssetInPool: (asset: Asset) => void;
  /**
   * Optimistically rename an asset's `ref`: drop the pool entry matching
   * `kind`+`oldRef` and insert `newAsset` (which carries the new ref). Used when
   * an asset's `ref` is edited — a plain `updateAssetInPool` can't match it
   * because the kind+ref key has changed.
   */
  renameAssetInPool: (kind: AssetKind, oldRef: string, newAsset: Asset) => void;
  /** Optimistically remove the asset matching `asset` by kind+ref from the pool. */
  removeAssetFromPool: (asset: Asset) => void;
  updateTitle: (title: string) => void;
  feedbackSubmit: (feedback: FeedbackSubmission) => void;
}

/** The subset of EditorStoreState that Editors.tsx syncs on each render. */
export type EditorSyncableState = Pick<
  EditorStoreState,
  | "source"
  | "sourceFormat"
  | "title"
  | "docinfo"
  | "commonDocinfo"
  | "useCommonDocinfo"
  | "projectType"
  | "projectUrl"
  | "divisions"
  | "rootDivisionId"
  | "activeDivisionId"
  | "canConvertToPretext"
  | "activeEditorSource"
  | "hasFeedback"
  | "hasAssetDuplicate"
>;

// ── Factory ─────────────────────────────────────────────────────────────────

export interface EditorStoreInit {
  source: string;
  sourceFormat: SourceFormat;
  title: string;
  docinfo: string;
  commonDocinfo: string;
  useCommonDocinfo: boolean;
  projectType: "article" | "book" | undefined;
  divisions: Division[];
  activeDivisionId: string | null;
  projectAssets: Asset[] | undefined;
}

/** The Zustand vanilla store instance type. */
export type EditorStoreInstance = StoreApi<EditorStoreState>;

/** Return value of createEditorStore. */
export interface EditorStoreHandle {
  /** The Zustand vanilla store — pass to EditorStoreProvider. */
  store: EditorStoreInstance;
  /**
   * Update the mutable callbacks bag.  Call from useLayoutEffect after every
   * render so store actions always invoke the latest mode-routed callbacks.
   */
  bindCallbacks: (cbs: EditorCallbacks) => void;
}

export function createEditorStore(init: EditorStoreInit): EditorStoreHandle {
  // Plain mutable bag — NOT React state.  Not tracked by Zustand, so updating
  // it does not trigger any re-renders.  Store actions close over this object.
  const noop = () => { };
  const bag: { cbs: EditorCallbacks } = {
    cbs: {
      selectDivision: noop,
      addDivision: noop,
      removeDivision: noop,
      updateDivision: noop,
      divisionContentChange: noop,
      handleDivisionContentChange: noop,
      assetInsert: noop,
      updateTitle: noop,
    },
  };

  const store = createStore<EditorStoreState>()((set, get) => ({
    // ── Initial data ───────────────────────────────────────────────────────
    source: init.source,
    sourceFormat: init.sourceFormat,
    projectAssets: init.projectAssets,
    title: init.title,
    docinfo: init.docinfo,
    commonDocinfo: init.commonDocinfo,
    useCommonDocinfo: init.useCommonDocinfo,
    projectType: init.projectType,
    projectUrl: undefined,
    divisions: init.divisions,
    rootDivisionId: undefined,
    activeDivisionId: init.activeDivisionId,
    canConvertToPretext: true,
    activeEditorSource: init.source,
    hasFeedback: false,
    hasAssetDuplicate: false,

    // ── Initial UI state ───────────────────────────────────────────────────
    isTocCollapsed: false,
    showLivePreview: true,
    isNarrowScreen:
      typeof window !== "undefined" ? window.innerWidth < 800 : false,
    activeTab: "editor",
    isLatexDialogOpen: false,
    isConvertDialogOpen: false,
    isDocinfoEditorOpen: false,
    isAssetPickerOpen: false,
    isFullSourceOpen: false,
    editingId: null,
    editDraft: null,
    editingIsNew: false,
    editingAssetRef: null,
    assetResolveTarget: null,

    // ── Actions ────────────────────────────────────────────────────────────
    syncState: (partial) => set(partial),

    // ── Authoritative editing-buffer actions ─────────────────────────────────
    applyExternalUpdate: (partial) => set(partial),
    setDivisionContent: (xmlId, content) =>
      set((s) => {
        if (!s.divisions) return {};
        let changed = false;
        const divisions = s.divisions.map((d) => {
          if (d.xmlId === xmlId && d.source !== content) {
            changed = true;
            return { ...d, source: content };
          }
          return d;
        });
        return changed ? { divisions } : {};
      }),
    patchDivision: (xmlId, changes) =>
      set((s) => {
        if (!s.divisions) return {};
        const divisions = s.divisions.map((d) =>
          d.xmlId === xmlId
            ? {
              ...d,
              ...(changes.title !== undefined && { title: changes.title }),
              ...(changes.type !== undefined && { type: changes.type }),
              ...(changes.xmlId != null && { xmlId: changes.xmlId }),
              ...(changes.sourceFormat !== undefined && {
                sourceFormat: changes.sourceFormat,
              }),
            }
            : d,
        );
        return { divisions };
      }),
    addDivisionToPool: (division) =>
      set((s) => {
        const existing = s.divisions ?? [];
        if (existing.some((d) => d.xmlId === division.xmlId)) return {};
        return { divisions: [...existing, division] };
      }),
    removeDivisionFromPool: (xmlId) =>
      set((s) => ({
        divisions: (s.divisions ?? []).filter((d) => d.xmlId !== xmlId),
      })),
    setActiveDivisionId: (activeDivisionId) => set({ activeDivisionId }),
    setTitle: (title) => set({ title }),
    setDocinfo: ({ docinfo, commonDocinfo, useCommonDocinfo }) =>
      set({ docinfo, commonDocinfo, useCommonDocinfo }),

    setShowLivePreview: (showLivePreview) => set({ showLivePreview }),
    setActiveTab: (activeTab) => set({ activeTab }),
    setIsNarrowScreen: (isNarrowScreen) => set({ isNarrowScreen }),
    setIsTocCollapsed: (value) =>
      set((s) => ({
        isTocCollapsed:
          typeof value === "function" ? value(s.isTocCollapsed) : value,
      })),
    openModal: (modal) => set({ [modal]: true } as Pick<EditorStoreState, ModalKey>),
    closeModal: (modal) => set({ [modal]: false } as Pick<EditorStoreState, ModalKey>),

    // TOC section / division actions — stable closures that read through bag.cbs
    selectSection: (id) => bag.cbs.selectDivision(id),
    addSection: (parentXmlId) => bag.cbs.addDivision(parentXmlId),
    removeSection: (id) => bag.cbs.removeDivision(id),
    updateSection: (id, changes) => bag.cbs.updateDivision(id, changes),
    divisionContentChange: (xmlId, content) =>
      bag.cbs.divisionContentChange?.(xmlId, content),

    // TOC inline edit form
    startSectionEdit: (section, options) => {
      // Each format stores its xml:id/label differently: Markdown in YAML
      // frontmatter, LaTeX as the `\label` after `\section` (it has no separate
      // PreTeXt `label` attribute), and PreTeXt as the wrapper element's
      // attributes. All three fall back to the record id when their source
      // carries none yet, so the field shows the division's current identity
      // rather than a misleadingly blank one — notably the root division,
      // whose <article>/<book> wrapper is valid PreTeXt with only a `label`
      // and no `xml:id` at all (see ensureRootLabel in sectionUtils.ts).
      const { xmlId, label } =
        section.sourceFormat === "markdown"
          ? (() => {
            const meta = extractMarkdownDivisionMetadata(section.source);
            return { xmlId: meta?.xmlId || section.xmlId, label: meta?.label ?? "" };
          })()
          : section.sourceFormat === "latex"
            ? {
              xmlId: extractLatexSectionLabel(section.source) || section.xmlId,
              label: "",
            }
            : (() => {
              const attrs = getSectionAttributes(section.source);
              return { xmlId: attrs.xmlId || section.xmlId, label: attrs.label };
            })();
      set({
        editingId: section.xmlId,
        editDraft: {
          title: section.title,
          type: section.type as DivisionType,
          xmlId,
          label,
          sourceFormat: section.sourceFormat,
        },
        editingIsNew: options?.isNew ?? false,
      });
    },
    setEditDraft: (editDraft) => set({ editDraft }),
    commitSectionEdit: () => {
      const { editingId, editDraft, divisions } = get();
      if (editingId && editDraft) {
        const division = (divisions ?? []).find((d) => d.xmlId === editingId);

        // A division's `xml:id` is structural identity: it must be a non-empty,
        // unique NCName because it's the target of every `<plus:* ref="..."/>`
        // placeholder. Validate before committing so an empty or duplicate id
        // can never break the project; keep the form open on failure. Every
        // format now carries it (LaTeX spells it as the `\section`'s `\label`).
        let xmlId: string | null = null;
        if (division) {
          const sanitized = sanitizeXmlId(editDraft.xmlId);
          if (!sanitized) {
            window.alert(
              "xml:id can't be empty — it identifies the division and is used by references to it.",
            );
            return;
          }
          if (
            (divisions ?? []).some(
              (d) => d.xmlId !== editingId && d.xmlId === sanitized,
            )
          ) {
            window.alert(
              `xml:id "${sanitized}" is already used by another division. Choose a unique id.`,
            );
            return;
          }
          xmlId = sanitized;
        }

        bag.cbs.updateDivision(editingId, {
          title: editDraft.title.trim() || undefined,
          type: editDraft.type,
          xmlId,
          label: editDraft.label.trim() || null,
          // Only meaningfully different from the division's current format
          // while `editingIsNew` — the form keeps this field read-only
          // otherwise, so it's always a no-op patch for existing divisions.
          sourceFormat: editDraft.sourceFormat,
        });
      }
      set({ editingId: null, editDraft: null, editingIsNew: false });
    },
    cancelSectionEdit: () =>
      set({ editingId: null, editDraft: null, editingIsNew: false }),

    insertAsset: (asset) => bag.cbs.assetInsert(asset),
    insertAtCursor: (content) => bag.cbs.insertContentAtCursor?.(content),
    openAssetEditor: (kind, ref) => set({ editingAssetRef: { kind, ref } }),
    closeAssetEditor: () => set({ editingAssetRef: null }),
    openAssetResolver: (kind, ref) => set({ assetResolveTarget: { kind, ref } }),
    closeAssetResolver: () => set({ assetResolveTarget: null }),
    removeAsset: (asset) => bag.cbs.assetRemove?.(asset),
    removeAssetRefFromDocument: (kind, ref) => bag.cbs.assetRefRemove?.(kind, ref),
    duplicateAsset: async (asset) => {
      await bag.cbs.assetDuplicate?.(asset);
    },
    addAssetToPool: (asset) =>
      set((s) => {
        const base = s.projectAssets ?? [];
        if (base.some((a) => sameAssetRef(a, asset))) return {};
        return { projectAssets: [...base, asset] };
      }),
    updateAssetInPool: (asset) =>
      set((s) => {
        const base = s.projectAssets ?? [];
        return base.some((a) => sameAssetRef(a, asset))
          ? { projectAssets: base.map((a) => (sameAssetRef(a, asset) ? asset : a)) }
          : { projectAssets: [...base, asset] };
      }),
    renameAssetInPool: (kind, oldRef, newAsset) =>
      set((s) => {
        const base = s.projectAssets ?? [];
        const filtered = base.filter(
          (a) => !(a.kind === kind && a.ref === oldRef) && !sameAssetRef(a, newAsset),
        );
        return { projectAssets: [...filtered, newAsset] };
      }),
    removeAssetFromPool: (asset) =>
      set((s) => ({
        projectAssets: (s.projectAssets ?? []).filter(
          (a) => !sameAssetRef(a, asset),
        ),
      })),
    updateTitle: (title) => bag.cbs.updateTitle(title),
    feedbackSubmit: (feedback) => bag.cbs.feedbackSubmit?.(feedback),
  }));

  return { store, bindCallbacks: (cbs) => { bag.cbs = cbs; } };
}
