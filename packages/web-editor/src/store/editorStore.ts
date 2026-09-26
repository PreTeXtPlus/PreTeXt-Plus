/**
 * Per-instance Zustand store for the Editors component.
 *
 * ARCHITECTURE NOTE — the store owns the live editing buffer:
 * `createEditorStore(init)` seeds the editing buffer (`divisions`, `title`,
 * `docinfo`, `openItem`, …) from the host's initial props *once*.
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
 * `projectAssets`, `rootDivisionId`, …) are still mirrored from
 * props every render via `syncState()`.
 *
 * Callback stability: createEditorStore returns a `bindCallbacks` function that
 * EditorsInner calls from useLayoutEffect after every render. Store actions
 * close over an internal mutable bag (`bag.cbs`) rather than React refs, so
 * they are stable while always calling the latest mode-routed callback.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Asset, FeedbackSubmission, Snippet, SourceFormat } from "../types/editor";
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
 * Asset identity within a project: a `<plus:image ref="..."/>` placeholder is
 * resolved by `ref`, so that (not the host's `id`) is what every lookup and
 * pool mutation keys on.
 */
const sameAssetRef = (a: Asset, b: Asset): boolean => a.ref === b.ref;

/**
 * Snippet identity within a project: a `<plus:snippet ref="..."/>` placeholder
 * is resolved by `ref`, so that (not the host's `id`) is what every lookup and
 * pool mutation keys on. Mirrors {@link sameAssetRef}.
 */
const sameSnippetRef = (a: Snippet, b: Snippet): boolean => a.ref === b.ref;

/**
 * Breakpoint shared by `isNarrowScreen` (tabs vs. split layout) and the TOC's
 * default collapsed state — both derive from the same viewport check, so
 * they always agree on which side of it the layout is on.
 */
export const NARROW_SCREEN_MAX_WIDTH = 800;

export const isNarrowViewport = (): boolean =>
  typeof window !== "undefined" && window.innerWidth < NARROW_SCREEN_MAX_WIDTH;

/**
 * Where a deliberate show/hide of the TOC is remembered across sessions, so an
 * author who never uses the sidebar can keep it shut. Only a *wide-screen*
 * toggle is written here: on narrow screens the TOC is a drawer over the
 * editor, which always starts closed, and the programmatic collapses (the
 * breakpoint crossing, expanding to show the properties form) aren't the
 * author expressing a preference either.
 */
const TOC_COLLAPSED_KEY = "pretext-plus:toc-collapsed";

/** The stored preference, or `null` if never set / storage unavailable. */
const readStoredTocCollapsed = (): boolean | null => {
  try {
    const stored = localStorage.getItem(TOC_COLLAPSED_KEY);
    return stored === null ? null : stored === "true";
  } catch {
    // Storage blocked (private mode, third-party iframe): fall back to the
    // viewport default, exactly as before it was persisted.
    return null;
  }
};

const writeStoredTocCollapsed = (collapsed: boolean): void => {
  try {
    localStorage.setItem(TOC_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Storage blocked — the choice just doesn't outlive this session.
  }
};

/** Collapsed on narrow screens; otherwise the remembered choice, else open. */
export const defaultTocCollapsed = (): boolean =>
  isNarrowViewport() ? true : (readStoredTocCollapsed() ?? false);

/**
 * Whether pasting LaTeX or Markdown into a PreTeXt division converts it on the
 * way in (see `pasteConvert.ts`).
 *
 * On by default, because the detector only claims a snippet it is confident
 * about and converting is the reason to paste LaTeX into a PreTeXt file at all.
 * Remembered because the author who wants their markup kept verbatim — quoting
 * TeX in a `<pre>`, say — wants that every time, not once.
 */
const PASTE_AUTO_CONVERT_KEY = "pretext-plus:paste-auto-convert";

/** The stored preference, or `null` if never set / storage unavailable. */
const readStoredPasteAutoConvert = (): boolean | null => {
  try {
    const stored = localStorage.getItem(PASTE_AUTO_CONVERT_KEY);
    return stored === null ? null : stored === "true";
  } catch {
    // Storage blocked (private mode, third-party iframe): fall back to the
    // default, exactly as before it was persisted.
    return null;
  }
};

const writeStoredPasteAutoConvert = (enabled: boolean): void => {
  try {
    localStorage.setItem(PASTE_AUTO_CONVERT_KEY, String(enabled));
  } catch {
    // Storage blocked — the choice just doesn't outlive this session.
  }
};

/** The remembered choice, else on. */
export const defaultPasteAutoConvert = (): boolean =>
  readStoredPasteAutoConvert() ?? true;

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
  projectSnippets?: Snippet[];
  rootDivisionId?: string;
  activeDivisionId?: string | null;
  title?: string;
  docinfo?: string;
  commonDocinfo?: string;
  useCommonDocinfo?: boolean;
  language?: string;
}

/** The find/replace panel's inputs — see `EditorStoreState.findPanelState`. */
export interface FindPanelState {
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

const initialFindPanelState: FindPanelState = {
  query: "",
  replacement: "",
  matchCase: false,
  wholeWord: false,
  useRegex: false,
};

type ModalKey =
  | "isImportDialogOpen"
  | "isCleanDialogOpen"
  | "isConvertDialogOpen"
  | "isDocinfoEditorOpen"
  | "isAssetPickerOpen"
  | "isSnippetPickerOpen"
  | "isFullSourceOpen";

/**
 * What the code editor has open: a division, a project snippet, or a project
 * asset, each named by the identifier placeholders use to reach it — a
 * division's `xmlId`, a snippet's or asset's `ref`. There is always exactly one;
 * a `ref` that no longer resolves (the item was just removed) is read as the
 * root division.
 */
export type OpenItem = {
  kind: "division" | "snippet" | "asset";
  ref: string;
};

/** The open division's `xmlId`, or `null` while a snippet or asset is open. */
export const selectOpenDivisionId = (s: {
  openItem: OpenItem;
}): string | null =>
  s.openItem.kind === "division" ? s.openItem.ref : null;

/**
 * The views the project explorer's icon rail switches between. `"find"` is the
 * project-wide find/replace panel, which shares the explorer's slot rather
 * than docking beside it.
 */
export type ExplorerView = "toc" | "snippets" | "assets" | "find";

/**
 * All callbacks wired by Editors.tsx that deep components need to call.
 * Updated on every render via `callbacksRef.current = { ... }`.
 * Actions in the store call through this ref, so they stay stable even as
 * the callbacks close over changing state.
 */
export interface EditorCallbacks {
  selectDivision: (id: string) => void;
  /**
   * Open a draft properties form for a new child of `parentXmlId` (or an
   * unplaced one, if `null`). Nothing is created yet — see `createDivision`.
   */
  addDivision: (parentXmlId: string | null) => void;
  /**
   * Create the division the draft describes and place it under
   * `parentXmlId`. Fired by `commitSectionEdit` when the author saves a draft.
   */
  createDivision: (parentXmlId: string | null, draft: EditDraft) => void;
  removeDivision: (id: string) => void;
  updateDivision: (id: string, changes: DivisionChanges) => void;
  /** Emit a content change for a specific division (edit or structural reorder). */
  divisionContentChange: (xmlId: string, content: string) => void;
  handleDivisionContentChange: (content: string | undefined) => void;
  assetInsert: (asset: Asset) => void;
  /** Remove a project asset (optimistic pool drop + host persistence). */
  assetRemove?: (asset: Asset) => void;
  /** Remove every `<plus:image ref/>` placeholder for an unresolved ref from source. */
  assetRefRemove?: (ref: string) => void;
  /** Duplicate a project asset under a fresh ref (host persists + pool add). */
  assetDuplicate?: (asset: Asset) => void | Promise<void>;
  snippetInsert: (snippet: Snippet) => void;
  /** Remove a project snippet (optimistic pool drop + host persistence). */
  snippetRemove?: (snippet: Snippet) => void;
  /** Remove every `<plus:snippet ref/>` placeholder for an unresolved ref from source. */
  snippetRefRemove?: (ref: string) => void;
  /** Duplicate a project snippet under a fresh ref (host persists + pool add). */
  snippetDuplicate?: (snippet: Snippet) => void | Promise<void>;
  updateTitle: (title: string) => void;
  updateLanguage: (language: string) => void;
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
  /**
   * Authoritative project-snippet pool — owned by the store as a live editing
   * buffer, exactly like {@link EditorStoreState.projectAssets}. Seeded once
   * from the host's `projectSnippets` prop, then mutated optimistically by
   * `addSnippetToPool`/`updateSnippetInPool`/`removeSnippetFromPool`.
   */
  projectSnippets: Snippet[] | undefined;
  title: string;
  docinfo: string;
  commonDocinfo: string;
  useCommonDocinfo: boolean;
  /** The document's content language (BCP-47 code, e.g. `"en-US"`), written as `@xml:lang` on the generated root element. */
  language: string;
  projectUrl: string | undefined;
  /** The signed-in user's email, if any — used to silently attach it to feedback submissions instead of asking for one. */
  userEmail: string | undefined;

  // Divisions (host-controlled pool)
  divisions: Division[] | undefined;
  rootDivisionId: string | undefined;
  /**
   * What the code editor shows. Replaces the old `activeDivisionId`: read the
   * open division through {@link selectOpenDivisionId}, which is `null` while a
   * snippet or asset is open.
   */
  openItem: OpenItem;

  // Computed flags (re-derived each sync)
  canConvertToPretext: boolean;

  /** The source string currently open in the code editor. */
  activeEditorSource: string;

  /** True when the host passed `onFeedbackSubmit`. Controls whether feedback UI is shown. */
  hasFeedback: boolean;

  /** True when the host passed `onAssetDuplicate`. Controls whether Duplicate is offered. */
  hasAssetDuplicate: boolean;

  /** True when the host passed `onSnippetDuplicate`. Controls whether Duplicate is offered. */
  hasSnippetDuplicate: boolean;

  // ── UI state owned by the store ────────────────────────────────────────────

  isTocCollapsed: boolean;
  /** Which view the project explorer shows when it isn't collapsed. */
  explorerView: ExplorerView;
  /** Convert LaTeX/Markdown pasted into a PreTeXt division — see {@link PASTE_AUTO_CONVERT_KEY}. */
  pasteAutoConvert: boolean;
  showLivePreview: boolean;
  isNarrowScreen: boolean;
  activeTab: "editor" | "preview";
  isImportDialogOpen: boolean;
  isCleanDialogOpen: boolean;
  isConvertDialogOpen: boolean;
  isDocinfoEditorOpen: boolean;
  isAssetPickerOpen: boolean;
  isSnippetPickerOpen: boolean;
  isFullSourceOpen: boolean;
  /**
   * The settings drawer under the editor's title bar — the open item's
   * properties and actions. Switching to another item closes it.
   */
  isSettingsDrawerOpen: boolean;
  /**
   * The find/replace panel's query, replacement text and option toggles.
   * Kept in the store (rather than the panel's own `useState`) so switching
   * the explorer to another view and back — the panel unmounts, since it's
   * only rendered while `explorerView` is `"find"` — doesn't lose what the
   * author typed.
   */
  findPanelState: FindPanelState;

  // Division properties form (rendered in the settings drawer)
  editingId: string | null;
  editDraft: EditDraft | null;
  /**
   * Set while `editDraft` describes a division that does not exist yet, naming
   * the parent it will be placed under (`null` for an unplaced one).
   *
   * A new division is *only* a draft until the author saves it: no record, no
   * `<plus:* ref/>` in the parent, nothing sent to the host. That is what makes
   * Cancel mean cancel, and it is why a new division never has to be renamed —
   * it is created with the id the author chose. `editingId` is null throughout.
   */
  pendingNewDivision: { parentXmlId: string | null } | null;

  /**
   * An unresolved placeholder the user is resolving — opens the asset manager
   * in "resolve this ref" mode, where picking/uploading binds the result to
   * this `ref` instead of copying an embed code.
   */
  assetResolveTarget: { ref: string } | null;

  /**
   * An unresolved placeholder the user is resolving — opens the snippet
   * manager in "resolve this ref" mode, where creating a snippet binds the
   * result to this `ref` instead of copying an embed code.
   */
  snippetResolveTarget: { ref: string } | null;

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
  /**
   * Open `item` in the code editor. Closes the settings drawer and drops any
   * unsaved properties draft, since both describe the item being left.
   */
  setOpenItem: (item: OpenItem) => void;
  /** Open a division in the code editor (store only — no host notification). */
  openDivision: (xmlId: string | null) => void;
  /** Open a project snippet's source in the code editor. */
  openSnippet: (ref: string) => void;
  /** Open a project asset's source in the code editor. */
  openAsset: (ref: string) => void;
  /** Optimistically set the document title. */
  setTitle: (title: string) => void;
  /** Optimistically set the document language. */
  setLanguage: (language: string) => void;
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
  /** Set the TOC's collapsed state programmatically (not a saved preference). */
  setIsTocCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * Flip the TOC open/closed on the user's behalf, remembering the new state
   * for future sessions — see {@link TOC_COLLAPSED_KEY}.
   */
  toggleTocCollapsed: () => void;
  /**
   * A click on an explorer rail icon: opens `view`, or — if it is already the
   * open view — collapses the explorer to its rail. Collapse changes are
   * remembered like {@link toggleTocCollapsed}'s.
   */
  selectExplorerView: (view: ExplorerView) => void;
  /**
   * Open the explorer on `view` for the author (Tools → Find in Project, the
   * wrapper-line properties form). Never collapses, and not a saved preference.
   */
  showExplorerView: (view: ExplorerView) => void;
  /**
   * Turn paste-and-convert on or off, remembering the choice for future
   * sessions — see {@link PASTE_AUTO_CONVERT_KEY}.
   */
  togglePasteAutoConvert: () => void;
  openModal: (modal: ModalKey) => void;
  closeModal: (modal: ModalKey) => void;
  /** Open or close the settings drawer. Closing drops any properties draft. */
  setSettingsDrawerOpen: (open: boolean) => void;

  // TOC section / division actions (stable — delegate to bag.cbs)
  selectSection: (id: string) => void;
  addSection: (parentXmlId: string | null) => void;
  removeSection: (id: string) => void;
  updateSection: (id: string, changes: DivisionChanges) => void;
  /** Update a parent division's content after a structural DnD change. */
  divisionContentChange: (xmlId: string, content: string) => void;

  // Division properties form (opens the settings drawer)
  startSectionEdit: (section: Division) => void;
  /** Open the properties form for a new, not-yet-created child of `parentXmlId`. */
  startNewDivision: (parentXmlId: string | null, draft: EditDraft) => void;
  setEditDraft: (draft: EditDraft) => void;

  /** Merge `partial` into the find/replace panel's inputs. */
  setFindPanelState: (partial: Partial<FindPanelState>) => void;
  commitSectionEdit: () => void;
  cancelSectionEdit: () => void;

  // Assets / content
  insertAsset: (asset: Asset) => void;
  insertAtCursor: (content: string) => void;
  /** Open the asset manager in resolve mode for an unresolved `ref`. */
  openAssetResolver: (ref: string) => void;
  closeAssetResolver: () => void;
  /** Remove a project asset (pool + host persistence). */
  removeAsset: (asset: Asset) => void;
  /** Remove every placeholder for an unresolved `ref` from the document. */
  removeAssetRefFromDocument: (ref: string) => void;
  /** Duplicate a project asset under a fresh ref. Resolves when the host settles. */
  duplicateAsset: (asset: Asset) => Promise<void>;
  /**
   * Optimistically add an asset to the pool (no-op if one with the same
   * ref already exists). Used when an asset is uploaded, created, added
   * from the library, or inserted, so it's editable immediately.
   */
  addAssetToPool: (asset: Asset) => void;
  /**
   * Optimistically replace the pool entry matching `asset` by ref (adding
   * it if absent). Used when an asset's content/source is edited.
   */
  updateAssetInPool: (asset: Asset) => void;
  /**
   * Optimistically rename an asset's `ref`: drop the pool entry matching
   * `oldRef` and insert `newAsset` (which carries the new ref). Used when
   * an asset's `ref` is edited — a plain `updateAssetInPool` can't match it
   * because the ref key has changed.
   */
  renameAssetInPool: (oldRef: string, newAsset: Asset) => void;
  /** Optimistically remove the asset matching `asset` by ref from the pool. */
  removeAssetFromPool: (asset: Asset) => void;

  // Snippets / content
  insertSnippet: (snippet: Snippet) => void;
  /** Open the snippet manager in resolve mode for an unresolved `ref`. */
  openSnippetResolver: (ref: string) => void;
  closeSnippetResolver: () => void;
  /** Remove a project snippet (pool + host persistence). */
  removeSnippet: (snippet: Snippet) => void;
  /** Remove every placeholder for an unresolved `ref` from the document. */
  removeSnippetRefFromDocument: (ref: string) => void;
  /** Duplicate a project snippet under a fresh ref. Resolves when the host settles. */
  duplicateSnippet: (snippet: Snippet) => Promise<void>;
  /**
   * Optimistically add a snippet to the pool (no-op if one with the same
   * ref already exists). Used when a snippet is created, added, or inserted,
   * so it's editable immediately.
   */
  addSnippetToPool: (snippet: Snippet) => void;
  /**
   * Optimistically replace the pool entry matching `snippet` by ref (adding
   * it if absent). Used when a snippet's content is edited.
   */
  updateSnippetInPool: (snippet: Snippet) => void;
  /**
   * Optimistically rename a snippet's `ref`: drop the pool entry matching
   * `oldRef` and insert `newSnippet` (which carries the new ref).
   */
  renameSnippetInPool: (oldRef: string, newSnippet: Snippet) => void;
  /** Optimistically remove the snippet matching `snippet` by ref from the pool. */
  removeSnippetFromPool: (snippet: Snippet) => void;

  updateTitle: (title: string) => void;
  updateLanguage: (language: string) => void;
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
  | "language"
  | "projectUrl"
  | "userEmail"
  | "divisions"
  | "rootDivisionId"
  | "canConvertToPretext"
  | "activeEditorSource"
  | "hasFeedback"
  | "hasAssetDuplicate"
  | "hasSnippetDuplicate"
>;

// ── Factory ─────────────────────────────────────────────────────────────────

export interface EditorStoreInit {
  source: string;
  sourceFormat: SourceFormat;
  title: string;
  docinfo: string;
  commonDocinfo: string;
  useCommonDocinfo: boolean;
  language: string;
  divisions: Division[];
  activeDivisionId: string | null;
  projectAssets: Asset[] | undefined;
  /** Optional (unlike `projectAssets`) so existing hosts/tests need no change to keep compiling. */
  projectSnippets?: Snippet[];
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

const sameOpenItem = (a: OpenItem, b: OpenItem): boolean =>
  a.kind === b.kind && a.ref === b.ref;

/**
 * The state change that opens `item`. A different item closes the settings
 * drawer and drops any properties draft — both belong to the item being left —
 * while re-opening the current one changes nothing.
 */
const openItemState = (
  s: Pick<EditorStoreState, "openItem">,
  item: OpenItem,
): Partial<EditorStoreState> =>
  sameOpenItem(s.openItem, item)
    ? {}
    : {
      openItem: item,
      isSettingsDrawerOpen: false,
      editingId: null,
      editDraft: null,
      pendingNewDivision: null,
    };

/**
 * Where the editor lands when its open item goes away: the root division —
 * named by the host when it has synced one, else the first root-typed division
 * left in the pool, else whatever division is left.
 */
const rootItem = (
  s: Pick<EditorStoreState, "rootDivisionId" | "divisions">,
): OpenItem => {
  const remaining = s.divisions ?? [];
  const root =
    (s.rootDivisionId &&
      remaining.find((d) => d.xmlId === s.rootDivisionId)) ||
    remaining.find(
      (d) => d.type === "book" || d.type === "article" || d.type === "slideshow",
    ) ||
    remaining[0];
  return { kind: "division", ref: root?.xmlId ?? "" };
};

export function createEditorStore(init: EditorStoreInit): EditorStoreHandle {
  // Plain mutable bag — NOT React state.  Not tracked by Zustand, so updating
  // it does not trigger any re-renders.  Store actions close over this object.
  const noop = () => { };
  const bag: { cbs: EditorCallbacks } = {
    cbs: {
      selectDivision: noop,
      addDivision: noop,
      createDivision: noop,
      removeDivision: noop,
      updateDivision: noop,
      divisionContentChange: noop,
      handleDivisionContentChange: noop,
      assetInsert: noop,
      snippetInsert: noop,
      updateTitle: noop,
      updateLanguage: noop,
    },
  };

  const store = createStore<EditorStoreState>()((set, get) => ({
    // ── Initial data ───────────────────────────────────────────────────────
    source: init.source,
    sourceFormat: init.sourceFormat,
    projectAssets: init.projectAssets,
    projectSnippets: init.projectSnippets,
    title: init.title,
    docinfo: init.docinfo,
    commonDocinfo: init.commonDocinfo,
    useCommonDocinfo: init.useCommonDocinfo,
    language: init.language,
    projectUrl: undefined,
    userEmail: undefined,
    divisions: init.divisions,
    rootDivisionId: undefined,
    openItem: { kind: "division", ref: init.activeDivisionId ?? "" },
    canConvertToPretext: true,
    activeEditorSource: init.source,
    hasFeedback: false,
    hasAssetDuplicate: false,
    hasSnippetDuplicate: false,

    // ── Initial UI state ───────────────────────────────────────────────────
    isTocCollapsed: defaultTocCollapsed(),
    explorerView: "toc",
    pasteAutoConvert: defaultPasteAutoConvert(),
    showLivePreview: true,
    isNarrowScreen: isNarrowViewport(),
    activeTab: "editor",
    isImportDialogOpen: false,
    isCleanDialogOpen: false,
    isConvertDialogOpen: false,
    isDocinfoEditorOpen: false,
    isAssetPickerOpen: false,
    isSnippetPickerOpen: false,
    isFullSourceOpen: false,
    isSettingsDrawerOpen: false,
    findPanelState: initialFindPanelState,
    editingId: null,
    editDraft: null,
    pendingNewDivision: null,
    assetResolveTarget: null,
    snippetResolveTarget: null,

    // ── Actions ────────────────────────────────────────────────────────────
    syncState: (partial) => set(partial),

    // ── Authoritative editing-buffer actions ─────────────────────────────────
    // The host still speaks in `activeDivisionId`; it names a division to open.
    applyExternalUpdate: ({ activeDivisionId, ...partial }) =>
      set((s) =>
        activeDivisionId === undefined
          ? partial
          : {
            ...partial,
            ...openItemState(s, { kind: "division", ref: activeDivisionId ?? "" }),
          },
      ),
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
        // A renamed division that is open stays open under its new id.
        const openItem =
          changes.xmlId != null &&
          s.openItem.kind === "division" &&
          s.openItem.ref === xmlId
            ? { kind: "division" as const, ref: changes.xmlId }
            : s.openItem;
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
        return { divisions, openItem };
      }),
    addDivisionToPool: (division) =>
      set((s) => {
        const existing = s.divisions ?? [];
        if (existing.some((d) => d.xmlId === division.xmlId)) return {};
        return { divisions: [...existing, division] };
      }),
    removeDivisionFromPool: (xmlId) =>
      set((s) => {
        const divisions = (s.divisions ?? []).filter((d) => d.xmlId !== xmlId);
        return {
          divisions,
          ...(s.openItem.kind === "division" && s.openItem.ref === xmlId
            ? openItemState(s, rootItem({ ...s, divisions }))
            : {}),
        };
      }),
    setOpenItem: (item) => set((s) => openItemState(s, item)),
    openDivision: (xmlId) =>
      set((s) => openItemState(s, { kind: "division", ref: xmlId ?? "" })),
    openSnippet: (ref) =>
      set((s) => openItemState(s, { kind: "snippet", ref })),
    openAsset: (ref) => set((s) => openItemState(s, { kind: "asset", ref })),
    setTitle: (title) => set({ title }),
    setLanguage: (language) => set({ language }),
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
    toggleTocCollapsed: () =>
      set((s) => {
        const isTocCollapsed = !s.isTocCollapsed;
        if (!s.isNarrowScreen) writeStoredTocCollapsed(isTocCollapsed);
        return { isTocCollapsed };
      }),
    selectExplorerView: (view) =>
      set((s) => {
        const isTocCollapsed = view === s.explorerView && !s.isTocCollapsed;
        if (!s.isNarrowScreen && isTocCollapsed !== s.isTocCollapsed) {
          writeStoredTocCollapsed(isTocCollapsed);
        }
        return { explorerView: view, isTocCollapsed };
      }),
    showExplorerView: (view) =>
      set({ explorerView: view, isTocCollapsed: false }),
    togglePasteAutoConvert: () =>
      set((s) => {
        const pasteAutoConvert = !s.pasteAutoConvert;
        writeStoredPasteAutoConvert(pasteAutoConvert);
        return { pasteAutoConvert };
      }),
    openModal: (modal) => set({ [modal]: true } as Pick<EditorStoreState, ModalKey>),
    closeModal: (modal) => set({ [modal]: false } as Pick<EditorStoreState, ModalKey>),
    setSettingsDrawerOpen: (open) =>
      set(
        open
          ? { isSettingsDrawerOpen: true }
          : {
            isSettingsDrawerOpen: false,
            editingId: null,
            editDraft: null,
            pendingNewDivision: null,
          },
      ),

    // TOC section / division actions — stable closures that read through bag.cbs
    selectSection: (id) => bag.cbs.selectDivision(id),
    addSection: (parentXmlId) => bag.cbs.addDivision(parentXmlId),
    removeSection: (id) => bag.cbs.removeDivision(id),
    updateSection: (id, changes) => bag.cbs.updateDivision(id, changes),
    divisionContentChange: (xmlId, content) =>
      bag.cbs.divisionContentChange?.(xmlId, content),

    // Division properties form — lives in the settings drawer
    startSectionEdit: (section) => {
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
        pendingNewDivision: null,
        isSettingsDrawerOpen: true,
      });
    },
    startNewDivision: (parentXmlId, editDraft) =>
      set({
        editingId: null,
        editDraft,
        pendingNewDivision: { parentXmlId },
        isSettingsDrawerOpen: true,
      }),
    setEditDraft: (editDraft) => set({ editDraft }),

    setFindPanelState: (partial) =>
      set((s) => ({ findPanelState: { ...s.findPanelState, ...partial } })),
    commitSectionEdit: () => {
      const { editingId, editDraft, divisions, pendingNewDivision } = get();
      if (!editDraft) return;

      // A division's `xml:id` is structural identity: it must be a non-empty,
      // unique NCName because it's the target of every `<plus:* ref="..."/>`
      // placeholder. Validate before committing so an empty or duplicate id
      // can never break the project; keep the form open on failure (returning
      // `null`). Every format carries it — LaTeX spells it as the `\section`'s
      // `\label`. `selfXmlId` is the division being renamed, which of course
      // may keep the id it already has.
      const validateXmlId = (selfXmlId: string | null): string | null => {
        const sanitized = sanitizeXmlId(editDraft.xmlId);
        if (!sanitized) {
          window.alert(
            "xml:id can't be empty — it identifies the division and is used by references to it.",
          );
          return null;
        }
        if (
          (divisions ?? []).some(
            (d) => d.xmlId !== selfXmlId && d.xmlId === sanitized,
          )
        ) {
          window.alert(
            `xml:id "${sanitized}" is already used by another division. Choose a unique id.`,
          );
          return null;
        }
        return sanitized;
      };

      // Saving a draft is where a new division is created — the first moment
      // anything is written. It is created with the id, type and format the
      // author chose, so nothing has to be renamed afterwards and the parent's
      // placeholder is written once, already pointing at the right id.
      if (pendingNewDivision) {
        const xmlId = validateXmlId(null);
        if (!xmlId) return;
        set({
          editingId: null,
          editDraft: null,
          pendingNewDivision: null,
          isSettingsDrawerOpen: false,
        });
        bag.cbs.createDivision(pendingNewDivision.parentXmlId, {
          ...editDraft,
          title: editDraft.title.trim(),
          xmlId,
        });
        return;
      }

      if (editingId) {
        const division = (divisions ?? []).find((d) => d.xmlId === editingId);
        let xmlId: string | null = null;
        if (division) {
          xmlId = validateXmlId(editingId);
          if (!xmlId) return;
        }

        bag.cbs.updateDivision(editingId, {
          title: editDraft.title.trim() || undefined,
          type: editDraft.type,
          xmlId,
          label: editDraft.label.trim() || null,
          // The form keeps this field read-only for an existing division — its
          // source can't be losslessly translated — so it's always a no-op
          // patch here. Only a draft chooses a format.
          sourceFormat: editDraft.sourceFormat,
        });
      }
      set({
        editingId: null,
        editDraft: null,
        pendingNewDivision: null,
        isSettingsDrawerOpen: false,
      });
    },
    cancelSectionEdit: () =>
      // Cancelling a draft leaves nothing behind: the division was never
      // created and the parent's source was never touched.
      set({
        editingId: null,
        editDraft: null,
        pendingNewDivision: null,
        isSettingsDrawerOpen: false,
      }),

    insertAsset: (asset) => bag.cbs.assetInsert(asset),
    insertAtCursor: (content) => bag.cbs.insertContentAtCursor?.(content),
    openAssetResolver: (ref) => set({ assetResolveTarget: { ref } }),
    closeAssetResolver: () => set({ assetResolveTarget: null }),
    removeAsset: (asset) => bag.cbs.assetRemove?.(asset),
    removeAssetRefFromDocument: (ref) => bag.cbs.assetRefRemove?.(ref),
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
    renameAssetInPool: (oldRef, newAsset) =>
      set((s) => {
        const base = s.projectAssets ?? [];
        const filtered = base.filter(
          (a) => a.ref !== oldRef && !sameAssetRef(a, newAsset),
        );
        const isOpen = s.openItem.kind === "asset" && s.openItem.ref === oldRef;
        return {
          projectAssets: [...filtered, newAsset],
          ...(isOpen && newAsset.ref
            ? { openItem: { kind: "asset" as const, ref: newAsset.ref } }
            : {}),
        };
      }),
    removeAssetFromPool: (asset) =>
      set((s) => ({
        projectAssets: (s.projectAssets ?? []).filter(
          (a) => !sameAssetRef(a, asset),
        ),
        ...(s.openItem.kind === "asset" && s.openItem.ref === asset.ref
          ? openItemState(s, rootItem(s))
          : {}),
      })),

    insertSnippet: (snippet) => bag.cbs.snippetInsert(snippet),
    openSnippetResolver: (ref) => set({ snippetResolveTarget: { ref } }),
    closeSnippetResolver: () => set({ snippetResolveTarget: null }),
    removeSnippet: (snippet) => bag.cbs.snippetRemove?.(snippet),
    removeSnippetRefFromDocument: (ref) => bag.cbs.snippetRefRemove?.(ref),
    duplicateSnippet: async (snippet) => {
      await bag.cbs.snippetDuplicate?.(snippet);
    },
    addSnippetToPool: (snippet) =>
      set((s) => {
        const base = s.projectSnippets ?? [];
        if (base.some((a) => sameSnippetRef(a, snippet))) return {};
        return { projectSnippets: [...base, snippet] };
      }),
    updateSnippetInPool: (snippet) =>
      set((s) => {
        const base = s.projectSnippets ?? [];
        return base.some((a) => sameSnippetRef(a, snippet))
          ? { projectSnippets: base.map((a) => (sameSnippetRef(a, snippet) ? snippet : a)) }
          : { projectSnippets: [...base, snippet] };
      }),
    renameSnippetInPool: (oldRef, newSnippet) =>
      set((s) => {
        const base = s.projectSnippets ?? [];
        const filtered = base.filter(
          (a) => a.ref !== oldRef && !sameSnippetRef(a, newSnippet),
        );
        const isOpen = s.openItem.kind === "snippet" && s.openItem.ref === oldRef;
        return {
          projectSnippets: [...filtered, newSnippet],
          ...(isOpen
            ? { openItem: { kind: "snippet" as const, ref: newSnippet.ref } }
            : {}),
        };
      }),
    removeSnippetFromPool: (snippet) =>
      set((s) => ({
        projectSnippets: (s.projectSnippets ?? []).filter(
          (a) => !sameSnippetRef(a, snippet),
        ),
        ...(s.openItem.kind === "snippet" && s.openItem.ref === snippet.ref
          ? openItemState(s, rootItem(s))
          : {}),
      })),

    updateTitle: (title) => bag.cbs.updateTitle(title),
    updateLanguage: (language) => bag.cbs.updateLanguage(language),
    feedbackSubmit: (feedback) => bag.cbs.feedbackSubmit?.(feedback),
  }));

  return { store, bindCallbacks: (cbs) => { bag.cbs = cbs; } };
}
