import { Group, Panel, Separator } from "react-resizable-panels";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import CodeEditor, { type CodeEditorHandle } from "./CodeEditor";
//import { VisualEditor } from "@pretextbook/visual-editor";
import LivePreview, { type LivePreviewHandle } from "./LivePreview";
import { isLocalPreviewAvailable } from "./wasmPreview";
import {
  buildPreviewLineMap,
  divisionForElementId,
  type PreviewLineMap,
} from "./previewSync";
import LatexImportDialog from "./LatexImportDialog";
import ConvertToPretextDialog from "./ConvertToPretextDialog";
import DocinfoEditor from "./DocinfoEditor";
import FullSourceModal from "./FullSourceModal";
import AssetManagerModal, { type AssetManagerMainTab } from "./AssetManagerModal";
import AssetEditModal from "./AssetEditModal";
import MenuBar from "./MenuBar";
import TableOfContents from "./TableOfContents";
import ErrorBoundary from "./ErrorBoundary";
import "./Editors.css";

import { derivePretextContent } from "../contentConversion";
import type {
  EditorContentChange,
  Asset,
  AssetKind,
  FeedbackSubmission,
  SourceFormat,
} from "../types/editor";
import type { Division, DivisionType } from "../types/sections";
import {
  createNewSection,
  createDivisionContent,
  parseDivisionRefsWithTypes,
  createDivisionWithId,
  insertDivisionRef,
  wrapDivisionForPreview,
  assembleProjectSource,
  assembleFullProjectSource,
  extractDivisionMetadata,
  extractLatexDivisionTitle,
  updateLatexDivisionMetadata,
  latexDivisionToTaggedPretext,
  extractMarkdownDivisionMetadata,
  updateMarkdownDivisionMetadata,
  findDivisionParent,
  renameDivisionRef,
  renameAssetRef,
  removeAssetRef,
  updateSectionMetadata,
  normalizeDivisionsOnLoad,
} from "../sectionUtils";
import { buildProjectAssetView, makeUniqueAssetRef } from "../assetView";
import {
  createEditorStore,
  type DivisionChanges,
  type EditorCallbacks,
  type EditorStoreHandle,
} from "../store/editorStore";
import { EditorStoreProvider } from "../store/EditorStoreProvider";
import { useEditorStore } from "../store/hooks";
import { CollabBridge } from "../collab/bridge";
import type { CollabSession } from "../collab/types";
import PresenceAvatars from "../collab/PresenceAvatars";

// ── Public prop interface ─────────────────────────────────────────

export interface editorProps {
  /**
   * The docinfo element for a pretext document, which can contain macros and similar
   * document wide information.
   */
  docinfo?: string;
  /**
   * Optional user-level common docinfo/preamble that project docinfo can import.
   */
  commonDocinfo?: string;
  /**
   * Whether this project should use the user's common docinfo/preamble.
   */
  useCommonDocinfo?: boolean;
  /**
   * Called when the project-level "use common docinfo" choice changes.
   */
  onUseCommonDocinfoChange?: (value: boolean) => void;
  /**
   * Called when the user edits their common docinfo from the project dialog.
   */
  onCommonDocinfoChange?: (value: string) => void;
  /**
   * Called whenever content changes — a division edit, a structural reorder
   * (which rewrites a parent division's content), or a document-wide docinfo
   * edit.  The single {@link EditorContentChange} payload carries the affected
   * division's `xmlId` along with the derived content state, so the host can
   * update the right record in its divisions pool.
   */
  onContentChange: (change: EditorContentChange) => void;
  /** Document title shown in the menu bar title field. */
  title?: string;
  /** Called when the user edits the title field. */
  onTitleChange?: (value: string) => void;
  /** If provided, a Save button is rendered in the menu bar. */
  onSaveButton?: () => void;
  /** Label for the Save button.  Defaults to `"Save"`. */
  saveButtonLabel?: string;
  /** If provided, a Cancel button is rendered in the menu bar. */
  onCancelButton?: () => void;
  /** Label for the Cancel button.  Defaults to `"Cancel"`. */
  cancelButtonLabel?: string;
  /** Called when a user submits feedback from any built-in feedback link. */
  onFeedbackSubmit?: (feedback: FeedbackSubmission) => void | Promise<void>;
  /** Optional URL for the current project, included in feedback submissions. */
  projectUrl?: string;
  /**
   * If provided, `onSave` is called on Ctrl+S in addition to `onSaveButton`.
   * Useful when the host wants a keyboard shortcut to trigger saving without
   * necessarily showing an explicit Save button.
   */
  onSave?: () => void;
  /**
   * Server-side preview build handler — **no longer required for a preview**.
   *
   * The full preview now renders in the browser via
   * `@pretextbook/pretext-html` (WebAssembly), so the preview toggle, rebuild
   * button and Ctrl+Enter shortcut are available to every host without any
   * wiring. This prop is the fallback for engines that lack WebAssembly JSPI
   * (currently non-Chromium browsers), where a local render is impossible: if
   * you must support those, keep providing it. It is also the way to get an
   * authoritative build from the real PreTeXt toolchain, which — unlike the
   * WASM renderer — can generate latex-image/sageplot assets.
   *
   * @param source - A standalone PreTeXt fragment document for just the
   * active division: wrapped in a synthetic `<pretext>`/`<book>`/`<article>`
   * root (as needed for the division's type) with `<docinfo>` inserted, but
   * with any `<plus:* ref="..."/>` placeholders inside the division left
   * unexpanded. Not the raw division content, and not the full document.
   * @param title - The current document title.
   * @param postToIframe - Helper to post a message into the preview iframe.
   */
  onPreviewRebuild?: (
    source: string,
    title: string,
    postToIframe: (url: string, data: unknown) => void,
  ) => void;
  /**
   * Whether this is an `"article"` (default) or `"book"` project.
   * When `"book"`, the TOC shows a chapter list that expands to show sections.
   */
  projectType?: "article" | "book";
  // ── Divisions API ────────────────────────────────────────────────────────────
  /**
   * Flat pool of all division records for this project.  The editor's content
   * is always sourced from these divisions.
   */
  divisions: Division[];

  /**
   * The `xmlId` of the root division (book, article, or slideshow).
   * When omitted the editor falls back to the first division with a root
   * type (`"book"`, `"article"`, `"slideshow"`).
   */
  rootDivisionId?: string;

  /**
   * The `xmlId` of the division currently open for editing (controlled).
   * When omitted the editor tracks active division internally (uncontrolled).
   */
  activeDivisionId?: string | null;

  /**
   * Called when the user clicks a division in the TOC to open it.
   * The host should update `activeDivisionId`.
   */
  onDivisionSelect?: (xmlId: string) => void;

  /**
   * Called when the user creates a new division via the TOC UI (including
   * an auto-create triggered by typing a new `<plus:TYPE ref="..."/>`
   * placeholder). `division` is the full local record — including the
   * `xmlId` the editor picked — and should be persisted as-is.
   *
   * The division is added to the local pool synchronously and immediately,
   * before this is called, so persistence never blocks the UI. The division
   * arrives with **no** `id`: it is new until the host saves it through the
   * project's nested `divisions_attributes` (no id = insert) and the server
   * mints one, which flows back via the `divisions` prop (matched by `xmlId`).
   *
   * A host that persists immediately may return the server-minted id (or a
   * promise of it). When collaboration is active that id keys the division in
   * the shared document, so peers and doc-derived saves agree on identity; a
   * rejected promise keeps the division out of the shared doc, mirroring the
   * failed create. Without collaboration the return value is ignored.
   */
  onDivisionAdd?: (
    division: Division,
  ) => void | string | Promise<string | undefined | void>;

  /**
   * Called when the user deletes a division via the TOC UI.
   */
  onDivisionRemove?: (xmlId: string) => void;

  /**
   * Called when the user renames, retypes, or changes the `xml:id` of a
   * division via the inline TOC edit form.
   */
  onDivisionUpdate?: (
    xmlId: string,
    changes: {
      title?: string;
      type?: DivisionType;
      xmlId?: string | null;
      sourceFormat?: import("../types/editor").SourceFormat;
      label?: string | null;
    },
  ) => void;

  // ── End divisions API ─────────────────────────────────────────────────────

  /**
   * Assets already associated with this project.  When omitted, the Assets
   * button and modal are hidden entirely.
   */
  projectAssets?: Asset[];
  /**
   * @deprecated Assets are no longer inserted at the cursor — adding an asset
   * now copies its embed code to the clipboard. Retained for backward
   * compatibility; it is no longer called. Use the creation hooks
   * (`onAssetUpload`/`onCreateDoenet`) to learn when an asset enters the
   * project.
   */
  onAssetInsert?: (asset: Asset) => void;
  /**
   * Called when the user uploads an image file, or after `onAssetFetchUrl`
   * fetches an external URL. `title` is the human-readable title the user
   * entered in the modal (may differ from `file.name`) — persist it as the
   * asset's title rather than deriving one from the filename.
   */
  onAssetUpload?: (file: File, title?: string) => Promise<Asset>;
  /**
   * Called when the user adds an image by URL. Should fetch the URL
   * server-side (to avoid CORS) and return the raw file bytes — it must
   * NOT create a persisted asset. The returned file is then committed via
   * `onAssetUpload`, the same as a local file pick, with the user's entered
   * title passed as `onAssetUpload`'s second argument.
   */
  onAssetFetchUrl?: (url: string) => Promise<File>;
  /** Called when the user creates a new Doenet activity. */
  onCreateDoenet?: (title: string, ref: string) => Promise<Asset>;
  /** Called when the user removes an asset from the project. */
  onAssetRemove?: (asset: Asset) => void;
  /** Called when the user saves edits to an asset's content (e.g. its `source`). */
  onAssetUpdate?: (asset: Asset) => Promise<void> | void;
  /** If true, the TOC and asset manager hide all assets. */
  hideAssets?: boolean;

  /**
   * Real-time collaboration session. When provided, the editor binds its
   * buffers to the session's Y.Doc (per the schema in `src/collab/schema.ts`),
   * renders collaborator presence (avatar chips, remote cursors), and treats
   * the doc as the shared source of truth: remote structural changes flow into
   * the editor automatically, and local ones are mirrored into the doc. The
   * host owns the transport — creating, seeding, and syncing the doc — see
   * {@link CollabSession}. When omitted, nothing collaborative is loaded and
   * behavior is identical to previous versions.
   */
  collaboration?: CollabSession;
}

// ── Helper: find the root division for a divisions pool ─────────────────────

const findRootDivision = (
  divisions: Division[],
  rootDivisionId?: string,
): Division | null =>
  divisions.find((d) =>
    rootDivisionId
      ? d.xmlId === rootDivisionId
      : d.type === "book" || d.type === "article" || d.type === "slideshow",
  ) ??
  divisions[0] ??
  null;

// ── Outer component: creates store + provides it ───────────────────────────

/**
 * Top-level editor component.  Creates the per-instance Zustand store and
 * wraps the inner component in the store's Context provider.
 */
const Editors = (props: editorProps) => {
  // Store + bindCallbacks are created once per mount via lazy useState.
  // bindCallbacks is a plain function (not a React ref), so passing it during
  // render does not trigger the react-hooks/refs lint rule.
  const [handle] = useState<EditorStoreHandle>(() => {
    const initRootDivision = findRootDivision(
      props.divisions,
      props.rootDivisionId,
    );
    // Hosts aren't required to persist a division's title or root wrapper
    // separately from its PreTeXt source, so the very first pool of
    // divisions a host hands over may be missing both — back-derive them
    // from each division's own content before seeding the store.
    const normalizedDivisions = normalizeDivisionsOnLoad(
      props.divisions,
      initRootDivision?.xmlId,
      props.projectType,
      props.title,
    );
    const normalizedRoot =
      normalizedDivisions.find((d) => d.xmlId === initRootDivision?.xmlId) ??
      initRootDivision;
    const initActiveId =
      props.activeDivisionId ?? normalizedRoot?.xmlId ?? null;
    const initActive =
      normalizedDivisions.find((d) => d.xmlId === initActiveId) ??
      normalizedRoot;

    return createEditorStore({
      source: initActive?.source ?? "",
      sourceFormat: initActive?.sourceFormat ?? "pretext",
      title: props.title || normalizedRoot?.title || "Document Title",
      docinfo: props.docinfo ?? "",
      commonDocinfo: props.commonDocinfo ?? "",
      useCommonDocinfo: props.useCommonDocinfo ?? false,
      projectType: props.projectType,
      divisions: normalizedDivisions,
      activeDivisionId: initActiveId,
      projectAssets: props.projectAssets,
    });
  });

  // The collaboration bridge lives beside the store for the whole mount (the
  // session is expected to be stable — hosts construct doc/awareness before
  // mounting). Attached in an effect so observers are torn down on unmount.
  const [bridge] = useState<CollabBridge | null>(() =>
    props.collaboration
      ? new CollabBridge(props.collaboration, handle.store)
      : null,
  );
  useEffect(() => {
    if (!bridge) return;
    bridge.attach();
    return () => bridge.detach();
  }, [bridge]);

  return (
    <EditorStoreProvider store={handle.store}>
      <EditorsInner
        {...props}
        bindCallbacks={handle.bindCallbacks}
        bridge={bridge}
      />
    </EditorStoreProvider>
  );
};

// ── Inner component: all editing logic ────────────────────────────────────

interface EditorsInnerProps extends editorProps {
  bindCallbacks: (cbs: EditorCallbacks) => void;
  bridge: CollabBridge | null;
}

const EditorsInner = (props: EditorsInnerProps) => {
  const { bindCallbacks, bridge } = props;

  // Re-render when the set of shared-doc entries changes outside React's flow
  // (a remote division add/remove, or a local add whose host id resolved
  // asynchronously) — the active division's Y.Text is looked up per render.
  useSyncExternalStore(
    bridge?.subscribe ?? (() => () => {}),
    bridge?.getVersion ?? (() => 0),
  );

  // ── Store reads (UI state owned by the store) ───────────────────────────
  const showLivePreview = useEditorStore((s) => s.showLivePreview);
  const isNarrowScreen = useEditorStore((s) => s.isNarrowScreen);
  const setIsNarrowScreen = useEditorStore((s) => s.setIsNarrowScreen);
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const isTocCollapsed = useEditorStore((s) => s.isTocCollapsed);
  const setIsTocCollapsed = useEditorStore((s) => s.setIsTocCollapsed);
  const isLatexDialogOpen = useEditorStore((s) => s.isLatexDialogOpen);
  const isConvertDialogOpen = useEditorStore((s) => s.isConvertDialogOpen);
  const isDocinfoEditorOpen = useEditorStore((s) => s.isDocinfoEditorOpen);
  const isAssetPickerOpen = useEditorStore((s) => s.isAssetPickerOpen);
  const isFullSourceOpen = useEditorStore((s) => s.isFullSourceOpen);
  const editingAssetRef = useEditorStore((s) => s.editingAssetRef);
  const openAssetEditor = useEditorStore((s) => s.openAssetEditor);
  const closeAssetEditor = useEditorStore((s) => s.closeAssetEditor);
  const assetResolveTarget = useEditorStore((s) => s.assetResolveTarget);
  const closeAssetResolver = useEditorStore((s) => s.closeAssetResolver);
  // Replace target is local UI state (only Editors + the asset manager need it).
  const [assetReplaceTarget, setAssetReplaceTarget] = useState<Asset | null>(null);
  // Which tab the asset manager should open on — local UI state, reset per open.
  const [assetPickerInitialTab, setAssetPickerInitialTab] = useState<AssetManagerMainTab>("in-document");
  const openModal = useEditorStore((s) => s.openModal);
  const closeModal = useEditorStore((s) => s.closeModal);
  const syncState = useEditorStore((s) => s.syncState);

  // The project-asset pool is read from the store (authoritative), not props —
  // so an asset just uploaded/created is resolvable for editing immediately,
  // without waiting for the host to echo it back as a new `projectAssets` prop.
  const projectAssets = useEditorStore((s) => s.projectAssets);
  const addAssetToPool = useEditorStore((s) => s.addAssetToPool);
  const updateAssetInPool = useEditorStore((s) => s.updateAssetInPool);
  const renameAssetInPool = useEditorStore((s) => s.renameAssetInPool);
  const removeAssetFromPool = useEditorStore((s) => s.removeAssetFromPool);

  const editingAsset = editingAssetRef
    ? projectAssets?.find(
        (a) => a.kind === editingAssetRef.kind && a.ref === editingAssetRef.ref,
      )
    : undefined;

  // ── Authoritative editing buffer (read from the store, not props) ─────────
  // The store owns the live edit after the initial seed.  Reading these here
  // means a local edit displays immediately without the host having to echo
  // anything back as new props.
  const divisionsRaw = useEditorStore((s) => s.divisions);
  const divisions = useMemo(() => divisionsRaw ?? [], [divisionsRaw]);
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  const title = useEditorStore((s) => s.title);
  const docinfo = useEditorStore((s) => s.docinfo);
  const commonDocinfo = useEditorStore((s) => s.commonDocinfo);
  const useCommonDocinfo = useEditorStore((s) => s.useCommonDocinfo);

  // Editing-buffer mutators (optimistic; host callbacks fire as notifications).
  const applyExternalUpdate = useEditorStore((s) => s.applyExternalUpdate);
  const setDivisionContent = useEditorStore((s) => s.setDivisionContent);
  const patchDivision = useEditorStore((s) => s.patchDivision);
  const addDivisionToPool = useEditorStore((s) => s.addDivisionToPool);
  const removeDivisionFromPool = useEditorStore(
    (s) => s.removeDivisionFromPool,
  );
  const setActiveDivisionId = useEditorStore((s) => s.setActiveDivisionId);
  const startSectionEdit = useEditorStore((s) => s.startSectionEdit);
  const setTitle = useEditorStore((s) => s.setTitle);
  const setDocinfo = useEditorStore((s) => s.setDocinfo);
  const editingId = useEditorStore((s) => s.editingId);
  const editingIsNew = useEditorStore((s) => s.editingIsNew);

  const livePreviewRef = useRef<LivePreviewHandle>(null);
  const codeEditorRef = useRef<CodeEditorHandle>(null);

  // A brand-new division's properties form (title/format/id) opens immediately
  // after creation — see handleDivisionAdd. Once the author closes it (Save or
  // Cancel), drop focus straight into the code editor so they can start typing
  // the body without an extra click.
  const wasEditingNewRef = useRef(false);
  useEffect(() => {
    if (editingId && editingIsNew) {
      wasEditingNewRef.current = true;
    } else if (wasEditingNewRef.current) {
      wasEditingNewRef.current = false;
      codeEditorRef.current?.focus();
    }
  }, [editingId, editingIsNew]);

  // ── Active division (derived from the store's authoritative pool) ─────────
  const rootDivision = findRootDivision(divisions, props.rootDivisionId);

  const activeDivision =
    divisions.find((d) => d.xmlId === activeDivisionId) ?? divisions[0] ?? null;

  const activeDivisionFormat = activeDivision?.sourceFormat ?? "pretext";

  // The code editor now shows (and edits) the division's full source,
  // wrapper tag included, rather than a stripped-down body — the wrapper
  // (with its xml:id/label attributes and title) is the source of truth.
  const divisionActiveSource = activeDivision?.source ?? "";

  // ── Cross-division preview sync ──────────────────────────────────────────
  // Clicking inside a child division's content opens that division. Its line
  // cannot be revealed in the same tick: the editor is still holding the
  // previous division's source, and only picks up the new one on the next
  // render. Park the target and apply it once the switch has landed.
  const pendingRevealRef = useRef<{ xmlId: string; line: number } | null>(null);

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || activeDivision?.xmlId !== pending.xmlId) return;
    // CodeEditor's own content effect has already run (child effects fire
    // before their parent's), so its model holds this division's source.
    pendingRevealRef.current = null;
    codeEditorRef.current?.revealLine(pending.line);
  }, [activeDivision?.xmlId, divisionActiveSource]);

  // Per-division line maps for the document currently on screen. Built lazily
  // — only a click needs them, and only a cross-division click needs more than
  // one — and discarded whenever the previewed document changes.
  const divisionMapCacheRef = useRef<{
    key: string;
    maps: Map<string, PreviewLineMap>;
  }>({ key: "", maps: new Map() });

  // ── Content-change emitter ───────────────────────────────────────────────
  // Single channel for every content change: a division edit, a structural
  // reorder, or a docinfo edit.  Always carries the affected division's xmlId.
  // Updates the store's pool optimistically first (so the edit displays without
  // the host echoing it back), then notifies the host.
  const emitContentChange = (
    xmlId: string,
    content: string,
    format: SourceFormat,
    extra?: Partial<EditorContentChange>,
  ) => {
    setDivisionContent(xmlId, content);
    // Mirror into the shared doc as a minimal diff. For Monaco keystrokes the
    // binding already wrote the precise delta, making this a no-op; for
    // whole-string rewrites (TOC reorder, metadata edits, conversions) this is
    // the write-through.
    bridge?.localContentChange(xmlId, content);
    props.onContentChange({
      xmlId,
      source: content,
      sourceFormat: format,
      pretextSource: format === "pretext" ? content : undefined,
      ...extra,
    });
  };

  // The remaining structural mutations follow the same pattern: update the
  // store's authoritative pool optimistically, then fire the (optional) host
  // callback as a persistence notification.
  const applyDivisionUpdate = (xmlId: string, changes: DivisionChanges) => {
    patchDivision(xmlId, changes);
    bridge?.localDivisionUpdate(xmlId, changes);
    props.onDivisionUpdate?.(xmlId, changes);
  };

  // Metadata edits from the TOC "Edit properties" form. Unlike code-editor
  // edits — where the source is authoritative and already carries the new
  // attributes — here the form fields are authoritative, so we must rewrite the
  // division's own source wrapper *and* keep the parent's
  // `<plus:* ref="..."/>` placeholder in sync. This is the single validated,
  // atomic place an `xml:id` rename happens (the code editor can't change it).
  const applyDivisionMetadataEdit = (
    xmlId: string,
    changes: DivisionChanges,
  ) => {
    const division = divisions.find((d) => d.xmlId === xmlId);
    // Every source format now carries its structural metadata in its own source
    // — the PreTeXt wrapper element, the Markdown YAML frontmatter, or the LaTeX
    // `\section`/`\label` commands — so they all share the rewrite/parent-sync
    // path below. Only a missing division falls back to a bare record patch.
    if (!division) {
      applyDivisionUpdate(xmlId, changes);
      return;
    }

    // 1. Rewrite this division's own source so its metadata matches.
    let updated: Division;
    if (
      changes.sourceFormat !== undefined &&
      changes.sourceFormat !== division.sourceFormat
    ) {
      // Switching format is only offered for a brand-new, not-yet-saved
      // division (see SectionEditForm's `isNew`), so there's no existing
      // source to translate — start over from that format's blank template.
      const type = changes.type ?? division.type;
      const title = changes.title ?? division.title;
      const newXmlId = changes.xmlId || division.xmlId;
      updated = {
        ...division,
        sourceFormat: changes.sourceFormat,
        type,
        title,
        xmlId: newXmlId,
        source: createDivisionContent(
          type,
          changes.sourceFormat,
          title,
          newXmlId,
        ),
      };
    } else if (division.sourceFormat === "markdown") {
      updated = updateMarkdownDivisionMetadata(division, changes);
    } else if (division.sourceFormat === "latex") {
      // The header command is renamed to match the new type (`\section{` →
      // `\worksheet{`), and the title/xml:id are written into the header/`\label`.
      // LaTeX has no representation for PreTeXt's separate `label` attribute, so
      // that change is tracked on the record only.
      updated = updateLatexDivisionMetadata(division, changes);
    } else {
      updated = updateSectionMetadata(division, changes);
    }
    const newXmlId = updated.xmlId;
    if (updated.source !== division.source) {
      // Emit keyed on the OLD id — before the record is renamed in step 2.
      emitContentChange(division.xmlId, updated.source, updated.sourceFormat);
    }

    // 2. Patch the record fields (this renames the pool key to newXmlId).
    applyDivisionUpdate(xmlId, { ...changes, xmlId: newXmlId });

    // 3. Keep the parent's ref placeholder in sync with an id or type change so
    //    the division stays placed in the tree.
    if (newXmlId !== division.xmlId || updated.type !== division.type) {
      const parent = findDivisionParent(divisions, division.xmlId);
      if (parent) {
        const newParentContent = renameDivisionRef(
          parent.source,
          division.xmlId,
          newXmlId,
          updated.type,
        );
        if (newParentContent !== parent.source) {
          emitContentChange(
            parent.xmlId,
            newParentContent,
            parent.sourceFormat,
          );
        }
      }
    }

    // 4. Follow an id rename so the user stays on the same division.
    if (newXmlId !== division.xmlId) {
      applyDivisionSelect(newXmlId);
    }
  };

  const applyDivisionAdd = (division: Division) => {
    // A newly created division is persisted through the project's nested
    // `divisions_attributes` with no id, so the server mints one on save
    // (no id = new). Strip any placeholder id a creation helper set locally —
    // `xmlId` is what every code path keys on, and the server-assigned id
    // flows back later via the `divisions` prop (matched by `xmlId`).
    const newDivision: Division = { ...division, id: undefined };
    addDivisionToPool(newDivision);
    const idResult = props.onDivisionAdd?.(newDivision);
    // The shared-doc entry is keyed by the host's id when one is returned, so
    // peers and doc-derived saves agree on identity from the start.
    bridge?.localDivisionAdd(newDivision, idResult);
  };

  const applyDivisionRemove = (xmlId: string) => {
    removeDivisionFromPool(xmlId);
    bridge?.localDivisionRemove(xmlId);
    props.onDivisionRemove?.(xmlId);
  };

  const applyDivisionSelect = (xmlId: string) => {
    setActiveDivisionId(xmlId);
    props.onDivisionSelect?.(xmlId);
  };

  // The active division's source converted to a complete, correctly-typed
  // PreTeXt element. Markdown's frontmatter already yields a full element; LaTeX
  // is converted and tagged with its authored type (latexDivisionToTaggedPretext).
  // `undefined` when the division is PreTeXt (no conversion) or conversion fails
  // (so the convert action is disabled and the preview falls back).
  const divisionConvertedPretext = useMemo(() => {
    if (!activeDivision || activeDivisionFormat === "pretext") return undefined;
    if (activeDivisionFormat === "latex") {
      return latexDivisionToTaggedPretext(activeDivision) ?? undefined;
    }
    const result = derivePretextContent(
      divisionActiveSource,
      activeDivisionFormat,
    );
    return result.pretextError ? undefined : result.pretextSource;
  }, [activeDivision, activeDivisionFormat, divisionActiveSource]);

  const handleDivisionContentChange = (newContent: string | undefined) => {
    if (!activeDivision) return;
    // The user now edits the division's full source (wrapper tag included),
    // so it's stored as-is.
    let wrapped = newContent || "";

    // `xml:id` is structural identity and is NOT editable from the code editor:
    // it's renamed only via the TOC (validated + atomic). If the user edited or
    // removed the wrapper's xml:id, re-assert the canonical id back into the
    // stored source so the division's identity can never be broken from here.
    if (activeDivisionFormat === "pretext") {
      const meta = extractDivisionMetadata(wrapped);
      if (meta && meta.xmlId !== activeDivision.xmlId) {
        // Rewrite only the xml:id back to canonical; pass the content's own
        // title/type/label (via `meta`) so a simultaneous title or type edit in
        // the same change isn't clobbered by stale record values.
        wrapped = updateSectionMetadata(
          {
            ...activeDivision,
            source: wrapped,
            title: meta.title,
            type: meta.type,
          },
          { xmlId: activeDivision.xmlId, label: meta.label || null },
        ).source;
      }
    } else if (activeDivisionFormat === "markdown") {
      // The frontmatter is locked in the code editor, but re-assert the
      // canonical xml:id back into it anyway so the division's identity can
      // never be broken from here (e.g. by a paste over the locked region).
      const meta = extractMarkdownDivisionMetadata(wrapped);
      if (meta && meta.xmlId !== activeDivision.xmlId) {
        wrapped = updateMarkdownDivisionMetadata(
          { ...activeDivision, source: wrapped },
          { xmlId: activeDivision.xmlId },
        ).source;
      }
    }

    if (wrapped === activeDivision.source) return;
    emitContentChange(activeDivision.xmlId, wrapped, activeDivisionFormat);

    // The source is the source of truth for title/type/label: re-derive them
    // from the edited content so the TOC stays in sync even when the dropdown
    // form is never used. (xml:id is excluded — see the re-assertion above.)
    // These flow through the apply* wrappers so the store reflects them whether
    // or not the host wired the callbacks.
    if (activeDivisionFormat === "pretext") {
      const meta = extractDivisionMetadata(wrapped);
      if (meta) {
        applyDivisionUpdate(activeDivision.xmlId, {
          title: meta.title,
          type: meta.type,
          label: meta.label || null,
        });

        // A type change is still allowed from source; keep the parent's
        // `<plus:TYPE ref="..."/>` placeholder tag in sync. The id never
        // changes here, so the ref target stays stable.
        if (meta.type !== activeDivision.type) {
          const parent = findDivisionParent(divisions, activeDivision.xmlId);
          if (parent) {
            const newParentContent = renameDivisionRef(
              parent.source,
              activeDivision.xmlId,
              activeDivision.xmlId,
              meta.type,
            );
            if (newParentContent !== parent.source) {
              emitContentChange(
                parent.xmlId,
                newParentContent,
                parent.sourceFormat,
              );
            }
          }
        }
      }
    } else if (activeDivisionFormat === "markdown") {
      // Markdown's structural metadata — including its title — lives in its
      // frontmatter; re-derive it so the TOC stays in sync. The frontmatter is
      // normally locked in the code editor (see `computeLockedRegion`), so this
      // is mostly defensive, but a type change is kept in sync with the parent
      // ref regardless.
      const meta = extractMarkdownDivisionMetadata(wrapped);
      if (meta) {
        applyDivisionUpdate(activeDivision.xmlId, {
          title: meta.title,
          type: meta.type,
          label: meta.label || null,
        });

        if (meta.type !== activeDivision.type) {
          const parent = findDivisionParent(divisions, activeDivision.xmlId);
          if (parent) {
            const newParentContent = renameDivisionRef(
              parent.source,
              activeDivision.xmlId,
              activeDivision.xmlId,
              meta.type,
            );
            if (newParentContent !== parent.source) {
              emitContentChange(
                parent.xmlId,
                newParentContent,
                parent.sourceFormat,
              );
            }
          }
        }
      }
    } else if (activeDivisionFormat === "latex") {
      // The `\section` header (and thus the title) is locked in the code editor,
      // so this normally only re-asserts the existing title; `\begin{section}`
      // env-style divisions aren't locked, so it keeps their title in sync.
      // Returns null for headerless intro/conclusion bodies, leaving title as-is.
      const latexTitle = extractLatexDivisionTitle(wrapped);
      if (latexTitle !== null) {
        applyDivisionUpdate(activeDivision.xmlId, { title: latexTitle });
      }
    }

    // Auto-create Division records for any new <plus:TYPE ref="id"/> placeholders
    // that appeared in the edited content but don't yet have a matching division.
    const existingIds = new Set(divisions.map((d) => d.xmlId));
    for (const { xmlId, type } of parseDivisionRefsWithTypes(
      wrapped,
      activeDivisionFormat,
    )) {
      if (!existingIds.has(xmlId)) {
        applyDivisionAdd(
          createDivisionWithId(xmlId, type, activeDivisionFormat),
        );
        existingIds.add(xmlId); // prevent duplicates within the same edit
      }
    }
  };

  const handleDivisionSelect = (xmlId: string) => {
    applyDivisionSelect(xmlId);
  };

  // Clicking the locked wrapper line in the code editor opens the active
  // division's properties form in the TOC. Expand the TOC first so the form is
  // visible (it's collapsible, and collapsed in the narrow-screen drawer).
  const handleRequestWrapperEdit = () => {
    if (!activeDivision) return;
    setIsTocCollapsed(false);
    startSectionEdit(activeDivision);
  };

  // Adds a new PreTeXt section as the last child of `parentXmlId` (or
  // unplaced, if `null`), then immediately opens its properties form flagged
  // `isNew` so the user can pick a different source format before the
  // division's first real edit — see SectionEditForm.
  const handleDivisionAdd = (parentXmlId: string | null) => {
    const newDiv = createNewSection();
    applyDivisionAdd(newDiv);
    if (parentXmlId) {
      const parent = divisions.find((d) => d.xmlId === parentXmlId);
      if (parent) {
        emitContentChange(
          parent.xmlId,
          insertDivisionRef(
            parent.source,
            newDiv.xmlId,
            newDiv.type,
            null,
            parent.sourceFormat,
          ),
          parent.sourceFormat,
        );
      }
    }
    setActiveDivisionId(newDiv.xmlId);
    startSectionEdit(newDiv, { isNew: true });
  };

  // ── Asset embedding ─────────────────────────────────────────────────────
  // Assets are no longer inserted at the Monaco cursor (which silently fails
  // inside a division's locked header). Instead a newly added asset is dropped
  // into the project pool and its embed code copied to the clipboard (by the
  // asset manager), so the author pastes it wherever it belongs.
  const handleAssetAdded = (asset: Asset) => {
    // Add to the authoritative pool optimistically so it's editable immediately,
    // even before the host echoes it back as an updated `projectAssets` prop.
    // The host already learns of the asset through the creation hook that
    // produced it (`onAssetUpload`/`onCreateDoenet`), so the deprecated
    // `onAssetInsert` is no longer fired here.
    addAssetToPool(asset);
  };

  const handleAssetRemove = (asset: Asset) => {
    // Optimistically drop it from the pool, then notify the host to persist.
    removeAssetFromPool(asset);
    props.onAssetRemove?.(asset);
  };

  // Duplicate and Replace don't need bespoke host hooks — they compose the
  // asset operations the host already provides. Duplicate re-fetches the
  // original's bytes and re-uploads them as an independent asset; Replace
  // uploads the new image, hands it the old ref, and drops the old asset.
  const canDuplicateAsset = !!(
    props.onAssetUpload &&
    props.onAssetFetchUrl &&
    props.onAssetUpdate
  );
  // Replace swaps in a chosen/created asset and drops the old one, so it needs
  // a removal hook plus an upload source for the replacement.
  const canReplaceAsset = !!(props.onAssetRemove && props.onAssetUpload);

  /**
   * Duplicate an asset under a fresh, non-colliding ref by re-fetching its bytes
   * (`onAssetFetchUrl`) and re-uploading them (`onAssetUpload`) as a new asset,
   * then giving that asset the new ref and the original's source
   * (`onAssetUpdate`). The copy is "unused" (no placeholder yet) until its embed
   * code is pasted; we open it in the editor so the user can tweak it.
   */
  const handleAssetDuplicate = async (asset: Asset) => {
    if (
      !props.onAssetUpload ||
      !props.onAssetFetchUrl ||
      !asset.ref ||
      !asset.url
    )
      return;
    const taken = new Set(
      buildProjectAssetView(divisions, projectAssets).map((r) => r.ref),
    );
    const newRef = makeUniqueAssetRef(asset.ref, taken);
    const file = await props.onAssetFetchUrl(asset.url);
    // `file.name` comes from the source URL (often an opaque, server-generated
    // path segment, e.g. a storage key) rather than anything human-readable.
    // Hosts commonly derive the asset's persisted title/ref from the uploaded
    // file's name, so rename it to `newRef` before handing it to
    // `onAssetUpload` — otherwise that opaque name leaks through as the
    // duplicate's default title/ref instead of the friendly "-copy" we just
    // computed.
    const extension = /\.[^./\\]+$/.exec(file.name)?.[0] ?? "";
    const renamedFile = new File([file], `${newRef}${extension}`, {
      type: file.type,
    });
    const uploaded = await props.onAssetUpload(renamedFile);
    const copy: Asset = {
      ...uploaded,
      ref: newRef,
      title: `${asset.title} (copy)`,
      source: asset.source,
    };
    await props.onAssetUpdate?.(copy);
    addAssetToPool(copy);
    openAssetEditor(copy.kind, newRef);
  };

  /**
   * Replace an asset with the user's freshly created `newAsset` (from the asset
   * manager's replace mode), then drop the old one. The new asset adopts the old
   * ref/title/source (`onAssetUpdate`) so the document's references don't move,
   * and it's safe because each asset owns its own file.
   */
  const handleAssetReplaceCommit = async (oldAsset: Asset, newAsset: Asset) => {
    const replaced: Asset = {
      ...newAsset,
      ref: oldAsset.ref,
      title: oldAsset.title,
      source: oldAsset.source,
    };
    await props.onAssetUpdate?.(replaced);
    updateAssetInPool(replaced);
    props.onAssetRemove?.(oldAsset);
    removeAssetFromPool(oldAsset);
  };

  /**
   * Rewrite every `<plus:KIND ref="oldRef"/>` placeholder across all divisions
   * to `newRef`, routing each affected division through the unified
   * content-change channel so the edit is persisted and survives locked
   * regions. Used when an asset's ref is renamed or an unresolved placeholder
   * is linked to an asset whose ref differs.
   */
  const renameAssetRefEverywhere = (
    kind: AssetKind,
    oldRef: string,
    newRef: string,
  ) => {
    if (oldRef === newRef) return;
    for (const division of divisions) {
      const next = renameAssetRef(division.source, kind, oldRef, newRef);
      if (next !== division.source) {
        emitContentChange(division.xmlId, next, division.sourceFormat);
      }
    }
  };

  /** Delete every `<plus:KIND ref="ref"/>` placeholder for an unresolved ref. */
  const removeAssetRefEverywhere = (kind: AssetKind, ref: string) => {
    for (const division of divisions) {
      const next = removeAssetRef(division.source, kind, ref);
      if (next !== division.source) {
        emitContentChange(division.xmlId, next, division.sourceFormat);
      }
    }
  };

  // ── Resize listener ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => setIsNarrowScreen(window.innerWidth < 800);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setIsNarrowScreen]);

  const isNonPretextDoc = activeDivisionFormat !== "pretext";

  // ── Bind callbacks after every render ────────────────────────────────────
  // Store actions call through the internal bag so they always invoke the
  // latest callbacks (which close over the current render's state/props)
  // without requiring stable identities for any of the callback functions.
  useLayoutEffect(() => {
    bindCallbacks({
      selectDivision: handleDivisionSelect,
      addDivision: (parentXmlId) => handleDivisionAdd(parentXmlId),
      removeDivision: (xmlId) => applyDivisionRemove(xmlId),
      updateDivision: (xmlId, changes) =>
        applyDivisionMetadataEdit(xmlId, changes),
      // Structural reorders rewrite a parent division's content; route them
      // through the same unified content-change channel as direct edits.
      divisionContentChange: (xmlId, content) => {
        const division = divisions.find((d) => d.xmlId === xmlId);
        emitContentChange(xmlId, content, division?.sourceFormat ?? "pretext");
      },
      handleDivisionContentChange,
      assetInsert: handleAssetAdded,
      assetRemove: handleAssetRemove,
      assetRefRemove: removeAssetRefEverywhere,
      assetDuplicate: canDuplicateAsset ? handleAssetDuplicate : undefined,
      insertContentAtCursor: (content) =>
        codeEditorRef.current?.insertAtCursor(content),
      updateTitle: (value) => {
        setTitle(value);
        bridge?.localTitleChange(value);
        props.onTitleChange?.(value);
      },
      feedbackSubmit: props.onFeedbackSubmit,
    });
  });

  // ── Sync derived/config state into store ─────────────────────────────────
  // Only fields that are NEVER edited locally are mirrored from props/derived
  // values on every render — the editing buffer itself (divisions, title,
  // docinfo, activeDivisionId) is owned by the store and handled separately
  // (optimistic edits above + external-update detection below).  `source` /
  // `sourceFormat` track the active division (read by the feedback link).
  useEffect(() => {
    syncState({
      source: divisionActiveSource,
      sourceFormat: activeDivisionFormat,
      projectType: props.projectType,
      projectUrl: props.projectUrl,
      rootDivisionId: rootDivision?.xmlId,
      canConvertToPretext: divisionConvertedPretext !== undefined,
      activeEditorSource: divisionActiveSource,
      hasFeedback: props.onFeedbackSubmit !== undefined,
      hasAssetDuplicate: canDuplicateAsset,
    });
  });

  // ── Detect genuine external updates from the host ────────────────────────
  // The store owns the live editing buffer, so we must NOT clobber it with a
  // stale prop the host simply never updated.  A buffer field is pushed into
  // the store only when its controlled prop actually *changed* since the last
  // render (host-initiated) — which is how a real reset (e.g. reconciling
  // server-assigned ids after a save, or switching projects) wins, while a
  // host that ignores the change callbacks keeps its local edits.  The
  // project-asset pool follows the exact same rule: a stale `projectAssets`
  // prop (e.g. one the host re-supplies on an unrelated content change before
  // it has persisted a just-uploaded asset) won't drop the optimistic addition.
  const externalRef = useRef({
    divisions: props.divisions,
    projectAssets: props.projectAssets,
    title: props.title,
    docinfo: props.docinfo,
    commonDocinfo: props.commonDocinfo,
    useCommonDocinfo: props.useCommonDocinfo,
    activeDivisionId: props.activeDivisionId,
  });
  useEffect(() => {
    const prev = externalRef.current;
    const update: Parameters<typeof applyExternalUpdate>[0] = {};
    let changed = false;

    if (
      props.projectAssets !== undefined &&
      props.projectAssets !== prev.projectAssets
    ) {
      update.projectAssets = props.projectAssets;
      changed = true;
    }

    if (props.divisions !== prev.divisions) {
      const newRoot = findRootDivision(props.divisions, props.rootDivisionId);
      const normalizedDivisions = normalizeDivisionsOnLoad(
        props.divisions,
        newRoot?.xmlId,
        props.projectType,
        props.title,
      );
      update.divisions = normalizedDivisions;
      const normalizedRoot =
        normalizedDivisions.find((d) => d.xmlId === newRoot?.xmlId) ?? newRoot;
      // If the active division no longer exists in the incoming pool, fall back
      // to the root so the editor never points at a missing division.
      if (
        activeDivisionId == null ||
        !props.divisions.some((d) => d.xmlId === activeDivisionId)
      ) {
        update.activeDivisionId = normalizedRoot?.xmlId ?? null;
      }
      // Hosts that don't persist a title separately rely on the root
      // division's own <title> for it; re-derive whenever a fresh divisions
      // pool arrives and the host isn't supplying an explicit title of its own.
      if (!props.title && normalizedRoot?.title) {
        update.title = normalizedRoot.title;
      }
      changed = true;
    }
    if (props.title !== undefined && props.title !== prev.title) {
      update.title = props.title;
      changed = true;
    }
    if (props.docinfo !== undefined && props.docinfo !== prev.docinfo) {
      update.docinfo = props.docinfo;
      changed = true;
    }
    if (
      props.commonDocinfo !== undefined &&
      props.commonDocinfo !== prev.commonDocinfo
    ) {
      update.commonDocinfo = props.commonDocinfo;
      changed = true;
    }
    if (
      props.useCommonDocinfo !== undefined &&
      props.useCommonDocinfo !== prev.useCommonDocinfo
    ) {
      update.useCommonDocinfo = props.useCommonDocinfo;
      changed = true;
    }
    if (
      props.activeDivisionId !== undefined &&
      props.activeDivisionId !== prev.activeDivisionId
    ) {
      update.activeDivisionId = props.activeDivisionId;
      changed = true;
    }

    if (changed) applyExternalUpdate(update);

    externalRef.current = {
      divisions: props.divisions,
      projectAssets: props.projectAssets,
      title: props.title,
      docinfo: props.docinfo,
      commonDocinfo: props.commonDocinfo,
      useCommonDocinfo: props.useCommonDocinfo,
      activeDivisionId: props.activeDivisionId,
    };
  });

  // ── Push load-time normalization back to the host ─────────────────────────
  // `normalizeDivisionsOnLoad` may rewrite a division's content on load — most
  // notably wrapping a legacy root fragment that lacks its <article>/<book>
  // element (with a <title>) around it. That rewrite is seeded straight into
  // the store's buffer, so the host never learns of it through the normal edit
  // path and the structural fix would be lost on the next reload. Emit it back
  // as a content change so the host persists it (and its own change handler
  // fires). Keyed on the raw `props.divisions` identity so a host that ignores
  // the callback isn't re-notified on every render; the rewrite is a no-op once
  // the host echoes the wrapped content back, so this never loops.
  const normalizationEmittedRef = useRef<Division[] | null>(null);
  useEffect(() => {
    if (normalizationEmittedRef.current === props.divisions) return;
    normalizationEmittedRef.current = props.divisions;

    const newRoot = findRootDivision(props.divisions, props.rootDivisionId);
    const normalized = normalizeDivisionsOnLoad(
      props.divisions,
      newRoot?.xmlId,
      props.projectType,
      props.title,
    );
    for (const division of normalized) {
      if (division.sourceFormat !== "pretext") continue;
      const original = props.divisions.find((d) => d.xmlId === division.xmlId);
      if (!original || division.source === original.source) continue;
      props.onContentChange({
        xmlId: division.xmlId,
        source: division.source,
        sourceFormat: "pretext",
        pretextSource: division.source,
      });
    }
  });

  // ── Preview content ──────────────────────────────────────────────────────
  // The docinfo that actually governs rendering: the user's common
  // docinfo/preamble when opted in, otherwise the project's own.  Read from the
  // store's authoritative buffer.
  const effectiveDocinfo = useCommonDocinfo ? commonDocinfo : docinfo;

  // The full assembled PreTeXt source for the whole project — every division
  // resolved and `<plus:* ref="..."/>` placeholder expanded, wrapped in the
  // outer `<pretext>`/`<docinfo>` shell. Computed only while the modal is open
  // (it walks the entire divisions tree) and guarded so a malformed fragment
  // can never crash the editor.
  const fullProjectSource = useMemo(() => {
    if (!isFullSourceOpen || !rootDivision) return "";
    try {
      return assembleFullProjectSource(
        divisions,
        rootDivision.xmlId,
        effectiveDocinfo,
        projectAssets ?? [],
      );
    } catch (error) {
      return `<!-- Unable to assemble document source: ${
        error instanceof Error ? error.message : String(error)
      } -->`;
    }
  }, [
    isFullSourceOpen,
    rootDivision,
    divisions,
    effectiveDocinfo,
    projectAssets,
  ]);

  // The active division's own tagged XML (outer element included), with any
  // `<plus:* ref="..."/>` placeholder expanded against the full divisions
  // pool — the real build server has no notion of that placeholder syntax,
  // so previewing a division that still contains unresolved refs (to child
  // divisions or to assets like `<plus:image ref="...">`) produces invalid
  // PreTeXt and a build failure. `assembleProjectSource` handles the
  // LaTeX/Markdown -> PreTeXt conversion internally before resolving refs, so
  // this is correct for every source format, not just PreTeXt.
  const divisionTaggedXml = !activeDivision
    ? undefined
    : assembleProjectSource(divisions, activeDivision.xmlId, projectAssets);

  const previewContent =
    activeDivision && divisionTaggedXml !== undefined
      ? wrapDivisionForPreview(
          activeDivision.type,
          divisionTaggedXml,
          effectiveDocinfo,
          activeDivision.title,
        )
      : undefined;

  // ── Preview rebuild helpers ──────────────────────────────────────────────
  // The full preview no longer needs a host-provided build server: when the
  // browser supports WebAssembly JSPI it renders in-page via
  // `@pretextbook/pretext-html`. `onPreviewRebuild` remains the fallback for
  // engines without JSPI, so a host that must support those should keep
  // providing it.
  const canPreview =
    isLocalPreviewAvailable() || props.onPreviewRebuild !== undefined;

  // ── Two-way sync ─────────────────────────────────────────────────────────
  // Correspondence between the Monaco buffer (one division's own source) and
  // the assembled document the preview renders. See previewSync.ts for why
  // these differ and how the mapping is recovered.
  //
  // Memoised on the two strings themselves — they are recomputed every render
  // but compare by value, so an unchanged edit costs nothing — and skipped
  // entirely while the preview is closed, since nothing can ask for it then.
  //
  // Note the map describes the *current* buffer, while the page on screen is
  // from the last rebuild (previews rebuild on save, not on every keystroke).
  // Between the two, a lookup can land on an element that has since moved or
  // gone; it resolves by id, so the usual outcome is a slightly stale target
  // or no scroll at all, and the next rebuild restores exactness.
  const previewLineMap = useMemo(
    () =>
      showLivePreview && canPreview && previewContent
        ? buildPreviewLineMap(divisionActiveSource, previewContent)
        : null,
    [showLivePreview, canPreview, previewContent, divisionActiveSource],
  );

  // Source → preview. Lines with no counterpart (a `<plus:.../>` placeholder,
  // or anything in a non-PreTeXt buffer whose assembled form is a conversion)
  // simply do not scroll.
  const handleCursorLineChange = (editorLine: number) => {
    const assembledLine = previewLineMap?.toAssembled(editorLine);
    if (assembledLine !== undefined) {
      livePreviewRef.current?.scrollToAssembledLine(assembledLine);
    }
  };

  // Preview → source. Previewing a parent renders its children inline, so the
  // click may belong to a different division record entirely. Which one is
  // read off the element's id, which encodes its authoring division; the line
  // within that division is then recovered by matching only *that* division's
  // source, never a search across the pool.
  const handleSyncToSource = ({
    assembledLine,
    elementId,
  }: {
    assembledLine: number;
    elementId: string;
  }) => {
    if (!previewContent) return;

    const owner = divisionForElementId(elementId, (xmlId) =>
      divisions.some((d) => d.xmlId === xmlId),
    );
    // Unattributable (page chrome, or an authored xml:id that is not a
    // division): stay put rather than guess at another division.
    const targetId = owner ?? activeDivision?.xmlId;
    if (!targetId) return;

    if (divisionMapCacheRef.current.key !== previewContent) {
      divisionMapCacheRef.current = { key: previewContent, maps: new Map() };
    }
    let map = divisionMapCacheRef.current.maps.get(targetId);
    if (!map) {
      const source = divisions.find((d) => d.xmlId === targetId)?.source ?? "";
      map = buildPreviewLineMap(source, previewContent);
      divisionMapCacheRef.current.maps.set(targetId, map);
    }
    // A converted division (LaTeX, Markdown) shares no lines with its rendered
    // form, so there is no line to land on — but opening it is still right.
    const line = map.toEditor(assembledLine);

    if (targetId === activeDivision?.xmlId) {
      if (line !== undefined) codeEditorRef.current?.revealLine(line);
      return;
    }
    pendingRevealRef.current =
      line === undefined ? null : { xmlId: targetId, line };
    applyDivisionSelect(targetId);
  };

  const triggerRebuild = () => livePreviewRef.current?.rebuild();
  const triggerSaveAndRebuild = () => {
    props.onSave?.();
    livePreviewRef.current?.rebuild();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && e.key === "Enter" && canPreview) {
      e.preventDefault();
      triggerRebuild();
    } else if (isCtrl && e.key === "s") {
      e.preventDefault();
      triggerSaveAndRebuild();
    }
  };

  const handleConvertToPretext = () => {
    if (!activeDivision || !divisionConvertedPretext) return;
    const base = createNewSection();
    // Orphan a copy of the original (still in its own source format) under a
    // fresh xml:id so it doesn't collide with the division being converted.
    // `updateSectionMetadata` only understands PreTeXt's XML wrapper, so the
    // copy's embedded id has to be rewritten with the format-specific helper
    // (the same ones `applyDivisionMetadataEdit` uses).
    const orphanSeed: Division = {
      id: base.xmlId,
      xmlId: activeDivision.xmlId,
      title: activeDivision.title,
      type: activeDivision.type,
      sourceFormat: activeDivisionFormat,
      source: activeDivision.source,
    };
    const newDiv: Division =
      activeDivisionFormat === "markdown"
        ? updateMarkdownDivisionMetadata(orphanSeed, { xmlId: base.xmlId })
        : updateLatexDivisionMetadata(orphanSeed, { xmlId: base.xmlId });
    applyDivisionAdd(newDiv);

    // Replace the current division's own source with the converted PreTeXt,
    // keeping its xml:id but flipping its format so the rest of the UI (code
    // editor language, visual editor, TOC) treats it as PreTeXt going forward.
    emitContentChange(
      activeDivision.xmlId,
      divisionConvertedPretext,
      "pretext",
    );
    applyDivisionUpdate(activeDivision.xmlId, { sourceFormat: "pretext" });
  };

  // Which division each collaborator is looking at (drives presence detail).
  useEffect(() => {
    if (!props.collaboration) return;
    props.collaboration.awareness.setLocalStateField(
      "division",
      activeDivisionId ?? null,
    );
  }, [props.collaboration, activeDivisionId]);

  // The active division's shared text, when collaboration is on and the
  // division has reached the doc (a just-created one lands after its host id
  // resolves — the bridge version subscription re-renders us then).
  const activeCollabText =
    bridge && activeDivision ? bridge.getYText(activeDivision.xmlId) : undefined;

  // ── Code editor ──────────────────────────────────────────────────────────
  const codeEditor = (
    <CodeEditor
      ref={codeEditorRef}
      content={divisionActiveSource}
      sourceFormat={activeDivisionFormat}
      collab={
        props.collaboration && bridge && activeCollabText && activeDivision
          ? {
              ytext: activeCollabText,
              awareness: props.collaboration.awareness,
              user: props.collaboration.user,
              divisionKey: activeDivision.xmlId,
              registerLocalOrigin: (origin) =>
                bridge.registerLocalOrigin(origin),
              unregisterLocalOrigin: (origin) =>
                bridge.unregisterLocalOrigin(origin),
            }
          : undefined
      }
      onChange={handleDivisionContentChange}
      onRebuild={canPreview ? triggerRebuild : undefined}
      onSave={triggerSaveAndRebuild}
      onCursorLineChange={handleCursorLineChange}
      onOpenLatexImport={() => openModal("isLatexDialogOpen")}
      onOpenDocinfoEditor={() => openModal("isDocinfoEditorOpen")}
      onOpenConvertToPretext={
        isNonPretextDoc && divisionConvertedPretext !== undefined
          ? () => openModal("isConvertDialogOpen")
          : undefined
      }
      canConvertToPretext={divisionConvertedPretext !== undefined}
      onOpenAssets={
        props.projectAssets !== undefined && activeDivisionFormat === "pretext"
          ? () => openModal("isAssetPickerOpen")
          : undefined
      }
      onShowFullSource={() => openModal("isFullSourceOpen")}
      // Every format now locks its structural lines (the PreTeXt wrapper tag +
      // title, the Markdown frontmatter, the LaTeX `\section` header) and a
      // single click on them opens the division's properties form in the TOC.
      // The code editor only fires this when a locked leading line is actually
      // present, so it's safe to wire up for all formats.
      onRequestWrapperEdit={handleRequestWrapperEdit}
      hideAssets={props.hideAssets}
    />
  );

  // ── Preview panel ─────────────────────────────────────────────────────────
  let preview: ReactNode;
  if (showLivePreview && canPreview) {
    preview = (
      <LivePreview
        ref={livePreviewRef}
        content={previewContent || ""}
        title={title}
        onRebuild={props.onPreviewRebuild}
        onSyncToSource={handleSyncToSource}
        divisionId={activeDivision?.xmlId}
      />
    );
    // For now, we disable the visual editor.  This might come back in a later version:
    //} else {
    //  const canEditVisually = activeDivisionFormat === "pretext";
    //  const editDisabledReason =
    //    activeDivisionFormat === "markdown"
    //      ? "Visual editing is not available for Markdown documents."
    //      : activeDivisionFormat === "latex"
    //      ? "Visual editing is not available for LaTeX documents."
    //      : "";
    //  preview = (
    //    <VisualEditor
    //      content={divisionActiveSource}
    //      canEdit={canEditVisually}
    //      editDisabledReason={editDisabledReason}
    //      onChange={(content) => handleDivisionContentChange(content)}
    //    />
    //  );
  }

  // ── TOC sidebar ──────────────────────────────────────────────────────────
  // Deep data + callbacks come from the store.
  const tocSidebar = (
    <TableOfContents
      isCollapsed={isTocCollapsed}
      onToggleCollapse={() => setIsTocCollapsed((c) => !c)}
      hideAssets={props.hideAssets}
      onOpenAssetPicker={
        props.projectAssets !== undefined
          ? (initialTab) => {
              setAssetPickerInitialTab(initialTab ?? "in-document");
              openModal("isAssetPickerOpen");
            }
          : undefined
      }
    />
  );

  // ── Layout ────────────────────────────────────────────────────────────────
  const editorTabId = "pretext-plus-tab-editor";
  const previewTabId = "pretext-plus-tab-preview";
  const tabPanelId = "pretext-plus-tabpanel";

  let editorDisplays: ReactNode;
  if (isNarrowScreen) {
    editorDisplays = (
      <div className="pretext-plus-editor__tabs">
        {tocSidebar}
        <div className="pretext-plus-editor__tabs-main">
          <div className="pretext-plus-editor__tab-list" role="tablist">
            <button
              type="button"
              id={editorTabId}
              role="tab"
              aria-controls={tabPanelId}
              aria-selected={activeTab === "editor"}
              tabIndex={activeTab === "editor" ? 0 : -1}
              className={`pretext-plus-editor__tab-button ${
                activeTab === "editor" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("editor")}
            >
              Editor
            </button>
            <button
              type="button"
              id={previewTabId}
              role="tab"
              aria-controls={tabPanelId}
              aria-selected={activeTab === "preview"}
              tabIndex={activeTab === "preview" ? 0 : -1}
              className={`pretext-plus-editor__tab-button ${
                activeTab === "preview" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("preview")}
            >
              Preview
            </button>
          </div>
          <div
            id={tabPanelId}
            className="pretext-plus-editor__tab-panel"
            role="tabpanel"
            aria-labelledby={
              activeTab === "editor" ? editorTabId : previewTabId
            }
          >
            <div style={{ height: "100%" }}>
              {activeTab === "editor" ? codeEditor : preview}
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    editorDisplays = (
      <div className="pretext-plus-editor__sectioned-layout">
        {tocSidebar}
        <Group
          orientation="horizontal"
          className="pretext-plus-editor__splitter"
        >
          <Panel className="pretext-plus-editor__editor-panel">
            {codeEditor}
          </Panel>
          <Separator className="pretext-plus-editor__resize-handle">
            <div className="pretext-plus-editor__resize-dots"></div>
          </Separator>
          <Panel className="pretext-plus-editor__preview-panel">
            {preview}
          </Panel>
        </Group>
      </div>
    );
  }

  return (
    <div className="pretext-plus-editor" onKeyDown={handleKeyDown}>
      <MenuBar
        onSaveButton={props.onSaveButton}
        saveButtonLabel={props.saveButtonLabel}
        onCancelButton={props.onCancelButton}
        cancelButtonLabel={props.cancelButtonLabel}
        showPreviewModeToggle={false}
        presence={
          props.collaboration ? (
            <PresenceAvatars awareness={props.collaboration.awareness} />
          ) : undefined
        }
      />
      <div className="pretext-plus-editor__editor-displays">
        <ErrorBoundary resetKeys={[divisionActiveSource, activeDivisionId]}>
          {editorDisplays}
        </ErrorBoundary>
        {isLatexDialogOpen ? (
          <LatexImportDialog onClose={() => closeModal("isLatexDialogOpen")} />
        ) : null}
        {isConvertDialogOpen && activeDivision && divisionConvertedPretext ? (
          <ConvertToPretextDialog
            source={divisionActiveSource}
            sourceFormat={activeDivisionFormat}
            pretextSource={divisionConvertedPretext}
            onConfirm={handleConvertToPretext}
            onClose={() => closeModal("isConvertDialogOpen")}
          />
        ) : null}
        {isDocinfoEditorOpen ? (
          <DocinfoEditor
            docinfo={docinfo}
            showCommonDocinfoControls
            commonDocinfo={commonDocinfo}
            initialUseCommonDocinfo={useCommonDocinfo}
            onClose={(value) => {
              closeModal("isDocinfoEditorOpen");
              if (value !== undefined) {
                setDocinfo({
                  docinfo: value.docinfo,
                  commonDocinfo: value.commonDocinfo,
                  useCommonDocinfo: value.useCommonDocinfo,
                });
                bridge?.localDocinfoChange(
                  value.docinfo,
                  value.useCommonDocinfo,
                );
                props.onCommonDocinfoChange?.(value.commonDocinfo);
                props.onUseCommonDocinfoChange?.(value.useCommonDocinfo);
                // Docinfo is document-wide: report it against the root
                // division through the unified content-change channel.
                const docinfoTarget = rootDivision ?? activeDivision;
                emitContentChange(
                  docinfoTarget?.xmlId ?? "",
                  docinfoTarget?.source ?? "",
                  docinfoTarget?.sourceFormat ?? "pretext",
                  {
                    docinfo: value.docinfo,
                    commonDocinfo: value.commonDocinfo,
                    useCommonDocinfo: value.useCommonDocinfo,
                  },
                );
              }
            }}
          />
        ) : null}
        {(isAssetPickerOpen || assetResolveTarget || assetReplaceTarget) &&
        props.projectAssets !== undefined ? (
          <AssetManagerModal
            open={isAssetPickerOpen || !!assetResolveTarget || !!assetReplaceTarget}
            initialTab={assetPickerInitialTab}
            resolveTarget={assetResolveTarget}
            replaceTarget={assetReplaceTarget}
            onClose={() => {
              closeModal("isAssetPickerOpen");
              closeAssetResolver();
              setAssetReplaceTarget(null);
              setAssetPickerInitialTab("in-document");
            }}
            onUpload={props.onAssetUpload}
            onFetchUrl={props.onAssetFetchUrl}
            onCreateDoenet={props.onCreateDoenet}
            onRemoveAsset={props.onAssetRemove ? handleAssetRemove : undefined}
            onDuplicateAsset={
              canDuplicateAsset ? handleAssetDuplicate : undefined
            }
            onAssetAdded={handleAssetAdded}
            onResolveRef={renameAssetRefEverywhere}
            onReplaceAsset={handleAssetReplaceCommit}
          />
        ) : null}
        {isFullSourceOpen ? (
          <FullSourceModal
            source={fullProjectSource}
            onClose={() => closeModal("isFullSourceOpen")}
          />
        ) : null}
        {editingAsset ? (
          <AssetEditModal
            // Key by the edited asset so switching targets (e.g. opening the
            // original right after Duplicate auto-opens the copy) remounts the
            // modal and re-seeds its form fields from the new asset, instead of
            // carrying the previous asset's edits over and writing them to the
            // wrong record on Save.
            key={`${editingAsset.kind}:${editingAsset.ref}`}
            asset={editingAsset}
            projectAssets={projectAssets ?? []}
            onClose={closeAssetEditor}
            onReplace={
              canReplaceAsset
                ? (asset) => {
                    closeAssetEditor();
                    setAssetReplaceTarget(asset);
                  }
                : undefined
            }
            onDuplicate={
              // Don't close first: keep the modal open (busy) through the
              // re-fetch/upload round-trip, then handleAssetDuplicate re-opens
              // it on the copy — the key above makes that a clean remount.
              canDuplicateAsset
                ? (asset) => handleAssetDuplicate(asset)
                : undefined
            }
            onSave={async (asset, prevRef) => {
              // Optimistic: reflect the edit in the authoritative pool first so
              // the change shows immediately, then notify the host to persist.
              if (asset.ref && asset.ref !== prevRef) {
                renameAssetRefEverywhere(asset.kind, prevRef, asset.ref);
                renameAssetInPool(asset.kind, prevRef, asset);
              } else {
                updateAssetInPool(asset);
              }
              await props.onAssetUpdate?.(asset);
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

export default Editors;
