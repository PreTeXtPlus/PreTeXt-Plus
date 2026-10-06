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
import { sanitizeXmlId } from "../sectionUtils";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Why `candidate` can't be a division's `xml:id`, or `null` when it can. The
 * id is structural identity — the target of every `<plus:* ref="..."/>`
 * placeholder — so it must be a non-empty NCName (after sanitizing) that no
 * other division uses. `selfXmlId` is the division being renamed, which may of
 * course keep the id it already has; `null` for a division not created yet.
 */
function xmlIdError(
  sanitized: string,
  selfXmlId: string | null,
  divisions: Division[],
): string | null {
  if (!sanitized) {
    return "The id can't be empty — it identifies the division and is used by references to it.";
  }
  if (divisions.some((d) => d.xmlId !== selfXmlId && d.xmlId === sanitized)) {
    return `"${sanitized}" is already used by another division. Choose a unique id.`;
  }
  return null;
}

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
 * Where the TOC tree's shape — which rows are open, whether the unplaced block
 * is folded — is remembered across sessions, one entry per project. Keyed by
 * the host's `projectUrl`, the only project identity the editor is given; a
 * host that passes none (a scratch page) gets no persistence, since there is
 * nothing to tell its sessions apart by.
 */
const tocTreeKey = (projectUrl: string) =>
  `pretext-plus:toc-tree:${projectUrl}`;

/** The persisted part of the TOC tree's state. */
type StoredTocTree = Pick<
  EditorStoreState,
  "tocExpansion" | "isTocOrphansCollapsed"
>;

/** The stored tree shape for `projectUrl`, or `null` if none / unreadable. */
const readStoredTocTree = (
  projectUrl: string | undefined,
): StoredTocTree | null => {
  if (!projectUrl) return null;
  try {
    const stored = localStorage.getItem(tocTreeKey(projectUrl));
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { tocExpansion, isTocOrphansCollapsed } = parsed as Record<
      string,
      unknown
    >;
    return {
      // Only boolean entries survive, so a hand-edited or older entry can't
      // put a non-boolean where `isExpanded` expects one.
      tocExpansion:
        typeof tocExpansion === "object" && tocExpansion !== null
          ? Object.fromEntries(
              Object.entries(tocExpansion).filter(
                (e): e is [string, boolean] => typeof e[1] === "boolean",
              ),
            )
          : {},
      isTocOrphansCollapsed: isTocOrphansCollapsed === true,
    };
  } catch {
    // Storage blocked or the entry isn't JSON: start from the default shape.
    return null;
  }
};

const writeStoredTocTree = (projectUrl: string, tree: StoredTocTree): void => {
  try {
    localStorage.setItem(tocTreeKey(projectUrl), JSON.stringify(tree));
  } catch {
    // Storage blocked or full — the shape just doesn't outlive this session.
  }
};

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
  | "isFullSourceOpen";

/**
 * Something the author is creating, shown in the editor pane in place of the
 * code editor (see `NewItemPane`). Nothing exists until the form is saved: no
 * record, no placeholder, nothing sent to the host — so Cancel means cancel.
 *
 * - `division`: a new child of `parentXmlId` (`null` for an unplaced one); its
 *   fields live in `editDraft`.
 * - `snippet` / `asset`: a new project record. With `resolveRef`, the record
 *   binds an unlinked `<plus:* ref/>` placeholder; with `replaceRef`, a new
 *   image takes the place of that asset under the same ref.
 */
export type CreateRequest =
  | { kind: "division"; parentXmlId: string | null }
  | { kind: "snippet"; resolveRef?: string }
  | { kind: "asset"; resolveRef?: string; replaceRef?: string };

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
  isFullSourceOpen: boolean;
  /**
   * The settings drawer under the editor's title bar — the open item's
   * properties and actions. Opening another item resets it to that item's
   * default: closed for a division, open for a snippet or asset.
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

  // TOC tree shape
  /**
   * TOC rows the author has explicitly opened (`true`) or shut (`false`),
   * keyed by xml:id. A row with no entry falls back to the default — only the
   * root is open — so a long book starts as its list of chapters. Kept in the
   * store, like `findPanelState`, because the TOC unmounts whenever the
   * explorer switches view or hides, and would otherwise spring back open.
   * Also saved per project across sessions — see {@link tocTreeKey}.
   */
  tocExpansion: Record<string, boolean>;
  /** Whether the "Unplaced divisions" block is folded down to its header. Saved like `tocExpansion`. */
  isTocOrphansCollapsed: boolean;
  /**
   * The active division whose ancestors the TOC last opened — see
   * `revealInToc`. Remembered so remounting the TOC doesn't re-open a branch
   * the author has since shut. Deliberately *not* saved: a new session opens
   * the path to wherever the author lands, on top of the restored shape.
   */
  tocRevealedId: string | null;

  /**
   * What the author is creating, if anything — see {@link CreateRequest}.
   * While set, the editor pane shows the creation form instead of the code
   * editor; opening any item abandons it.
   */
  creating: CreateRequest | null;
  /**
   * The properties of a division that does not exist yet, drafted while
   * `creating` is a division. An existing division's properties are saved
   * field by field (see `updateDivisionProperties`) and need no draft.
   */
  editDraft: EditDraft | null;

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

  /**
   * Save one or more of an existing division's properties, as the settings
   * drawer commits each field. An `xmlId` is sanitized and validated first;
   * returns why it was refused (nothing is saved), or `undefined` on success.
   */
  updateDivisionProperties: (
    xmlId: string,
    changes: DivisionChanges,
  ) => string | undefined;
  /** Open the creation form for a new, not-yet-created child of `parentXmlId`. */
  startNewDivision: (parentXmlId: string | null, draft: EditDraft) => void;
  /**
   * Replace the editor with the creation form for a new snippet or asset (a
   * division goes through `addSection`, which drafts its defaults first).
   */
  startCreate: (request: CreateRequest) => void;
  /** Abandon the creation form; nothing was created. */
  cancelCreate: () => void;
  setEditDraft: (draft: EditDraft) => void;

  /** Merge `partial` into the find/replace panel's inputs. */
  setFindPanelState: (partial: Partial<FindPanelState>) => void;

  /** Open or shut one TOC row's children. */
  setTocExpanded: (xmlId: string, expanded: boolean) => void;
  /**
   * Open every row in `ancestorIds` (and the unplaced block, if `inOrphans`)
   * so the TOC shows `activeId`, open `activeId` itself so its children show
   * too — one level, not its whole subtree — and record it as revealed.
   */
  revealInToc: (
    activeId: string,
    ancestorIds: string[],
    inOrphans: boolean,
  ) => void;
  toggleTocOrphansCollapsed: () => void;
  commitSectionEdit: () => void;
  cancelSectionEdit: () => void;

  // Assets / content
  insertAsset: (asset: Asset) => void;
  insertAtCursor: (content: string) => void;
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
  /** The host's URL for the project; keys the saved TOC tree shape (see {@link tocTreeKey}). */
  projectUrl?: string;
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

/** The state change that abandons the creation form, if one is open. */
const noCreation = {
  creating: null,
  editDraft: null,
} satisfies Partial<EditorStoreState>;

/**
 * Whether `item`'s settings drawer starts out open: a snippet's or asset's
 * settings are most of what there is to it, so they show unless closed; a
 * division's stay out of the way of its source unless asked for.
 */
const drawerOpenByDefault = (item: OpenItem) => item.kind !== "division";

/**
 * The state change that opens `item`. A different item resets the settings
 * drawer — which belongs to the item being left — to the new item's default. When the author opens an item
 * — even the current one, since clicking its row is how they get back to it —
 * the creation form is abandoned too. When the host or a peer changes what is
 * open (`byAuthor` false: the host restating the open division, the open item
 * being removed), the form is the author's and stays.
 */
const openItemState = (
  s: Pick<EditorStoreState, "openItem" | "creating">,
  item: OpenItem,
  byAuthor = true,
): Partial<EditorStoreState> => {
  const leaveCreation = s.creating && byAuthor ? noCreation : {};
  if (sameOpenItem(s.openItem, item)) return leaveCreation;
  return {
    openItem: item,
    isSettingsDrawerOpen: drawerOpenByDefault(item),
    ...leaveCreation,
  };
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

  const storedTocTree = readStoredTocTree(init.projectUrl);

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
    projectUrl: init.projectUrl,
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
    isFullSourceOpen: false,
    isSettingsDrawerOpen: false,
    findPanelState: initialFindPanelState,
    tocExpansion: storedTocTree?.tocExpansion ?? {},
    isTocOrphansCollapsed: storedTocTree?.isTocOrphansCollapsed ?? false,
    tocRevealedId: null,
    creating: null,
    editDraft: null,

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
            ...openItemState(
              s,
              { kind: "division", ref: activeDivisionId ?? "" },
              false,
            ),
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
        // The TOC keys a row's open/shut state by xml:id, so a rename carries
        // it across rather than snapping an open branch shut.
        const renamed =
          changes.xmlId != null && changes.xmlId !== xmlId ? changes.xmlId : null;
        if (!renamed) return { divisions, openItem };
        const { [xmlId]: expanded, ...tocExpansion } = s.tocExpansion;
        return {
          divisions,
          openItem,
          tocExpansion:
            expanded === undefined
              ? s.tocExpansion
              : { ...tocExpansion, [renamed]: expanded },
          tocRevealedId:
            s.tocRevealedId === xmlId ? renamed : s.tocRevealedId,
        };
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
            ? openItemState(s, rootItem({ ...s, divisions }), false)
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
    setSettingsDrawerOpen: (open) => set({ isSettingsDrawerOpen: open }),

    // TOC section / division actions — stable closures that read through bag.cbs
    selectSection: (id) => bag.cbs.selectDivision(id),
    addSection: (parentXmlId) => bag.cbs.addDivision(parentXmlId),
    removeSection: (id) => bag.cbs.removeDivision(id),
    updateSection: (id, changes) => bag.cbs.updateDivision(id, changes),
    divisionContentChange: (xmlId, content) =>
      bag.cbs.divisionContentChange?.(xmlId, content),

    // Division properties — saved per field from the settings drawer
    updateDivisionProperties: (xmlId, changes) => {
      if (changes.xmlId !== undefined && changes.xmlId !== null) {
        const sanitized = sanitizeXmlId(changes.xmlId);
        const error = xmlIdError(sanitized, xmlId, get().divisions ?? []);
        if (error) return error;
        changes = { ...changes, xmlId: sanitized };
      }
      bag.cbs.updateDivision(xmlId, changes);
      return undefined;
    },
    // A creation form takes the editor's place; the open item's drawer is
    // back at its default when the form goes away. On a narrow screen the form
    // is on the Editor tab, so that's where the author is taken.
    startNewDivision: (parentXmlId, editDraft) =>
      set((s) => ({
        editDraft,
        creating: { kind: "division", parentXmlId },
        isSettingsDrawerOpen: drawerOpenByDefault(s.openItem),
        activeTab: "editor",
      })),
    startCreate: (creating) =>
      set((s) => ({
        creating,
        editDraft: null,
        isSettingsDrawerOpen: drawerOpenByDefault(s.openItem),
        activeTab: "editor",
      })),
    cancelCreate: () => set(noCreation),
    setEditDraft: (editDraft) => set({ editDraft }),

    setFindPanelState: (partial) =>
      set((s) => ({ findPanelState: { ...s.findPanelState, ...partial } })),

    setTocExpanded: (xmlId, expanded) =>
      set((s) => ({ tocExpansion: { ...s.tocExpansion, [xmlId]: expanded } })),
    revealInToc: (activeId, ancestorIds, inOrphans) =>
      set((s) => ({
        tocExpansion: {
          ...s.tocExpansion,
          ...Object.fromEntries(
            [...ancestorIds, activeId].map((id) => [id, true]),
          ),
        },
        isTocOrphansCollapsed: inOrphans ? false : s.isTocOrphansCollapsed,
        tocRevealedId: activeId,
      })),
    toggleTocOrphansCollapsed: () =>
      set((s) => ({ isTocOrphansCollapsed: !s.isTocOrphansCollapsed })),
    commitSectionEdit: () => {
      const { editDraft, divisions, creating } = get();
      if (!editDraft || creating?.kind !== "division") return;

      // Saving a draft is where a new division is created — the first moment
      // anything is written. It is created with the id, type and format the
      // author chose, so nothing has to be renamed afterwards and the parent's
      // placeholder is written once, already pointing at the right id. An
      // invalid id keeps the form open.
      const xmlId = sanitizeXmlId(editDraft.xmlId);
      const error = xmlIdError(xmlId, null, divisions ?? []);
      if (error) {
        window.alert(error);
        return;
      }
      set(noCreation);
      bag.cbs.createDivision(creating.parentXmlId, {
        ...editDraft,
        title: editDraft.title.trim(),
        xmlId,
      });
    },
    cancelSectionEdit: () =>
      // Cancelling a draft leaves nothing behind: the division was never
      // created and the parent's source was never touched.
      set(noCreation),

    insertAsset: (asset) => bag.cbs.assetInsert(asset),
    insertAtCursor: (content) => bag.cbs.insertContentAtCursor?.(content),
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
          ? openItemState(s, rootItem(s), false)
          : {}),
      })),

    insertSnippet: (snippet) => bag.cbs.snippetInsert(snippet),
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
          ? openItemState(s, rootItem(s), false)
          : {}),
      })),

    updateTitle: (title) => bag.cbs.updateTitle(title),
    updateLanguage: (language) => bag.cbs.updateLanguage(language),
    feedbackSubmit: (feedback) => bag.cbs.feedbackSubmit?.(feedback),
  }));

  // Save the TOC tree's shape whenever it changes, whichever action changed
  // it. Keyed by the project the store was created for.
  const { projectUrl } = init;
  if (projectUrl) {
    store.subscribe((s, prev) => {
      if (
        s.tocExpansion !== prev.tocExpansion ||
        s.isTocOrphansCollapsed !== prev.isTocOrphansCollapsed
      ) {
        writeStoredTocTree(projectUrl, {
          tocExpansion: s.tocExpansion,
          isTocOrphansCollapsed: s.isTocOrphansCollapsed,
        });
      }
    });
  }

  return { store, bindCallbacks: (cbs) => { bag.cbs = cbs; } };
}
