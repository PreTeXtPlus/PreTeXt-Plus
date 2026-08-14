import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Editors,
  assembleFullProjectSource,
  clearDeletions,
  docToState,
  DEFAULT_LANGUAGE,
} from "@pretextbook/web-editor";
import { YCableProvider } from "./collab/yCableProvider";
import {
  railsDivisionToEditor,
  railsAssetToEditor,
  toEditorAsset,
} from "./railsProjectMapping";

/** @typedef {import("@pretextbook/web-editor").Asset} Asset */
/** @typedef {import("@pretextbook/web-editor").Division} Division */
/** @typedef {import("./railsProjectMapping").RailsDivision} RailsDivision */
/** @typedef {import("./railsProjectMapping").RailsAsset} RailsAsset */
/** @typedef {import("./railsProjectMapping").EditorDivision} EditorDivision */

/**
 * The full project JSON returned by the editor-state endpoint.
 * @typedef {Object} RailsProjectJson
 * @property {string} [title]
 * @property {string} [docinfo]
 * @property {string} [common_docinfo]
 * @property {boolean} [use_common_docinfo]
 * @property {string} [document_type]
 * @property {string} [language]
 * @property {RailsDivision[]} [divisions]
 * @property {RailsAsset[]} [assets]
 */

/**
 * The client-side working/server-snapshot state mirrored from Rails and fed
 * to (or read back from) the `<Editors>` component.
 * @typedef {Object} EditorState
 * @property {string} title
 * @property {string} docinfo
 * @property {string} commonDocinfo
 * @property {boolean} useCommonDocinfo
 * @property {string} language
 * @property {"article"|"book"} projectType
 * @property {EditorDivision[]} divisions
 * @property {Asset[]} [projectAssets]
 * @property {string} [rootDivisionId]
 */

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------
// React (not the Stimulus controller) now owns the editor's data layer, and
// TanStack Query manages *server state* for us:
//
//   * useQuery   -> the READ.  Loads the project JSON once, exposes
//                   loading/error state, and caches the result.
//   * useMutation -> the WRITE. Wraps the PATCH save, exposing isPending /
//                   error and an awaitable mutateAsync().
//
// What TanStack deliberately does NOT manage is the *live editing buffer* --
// the characters the user is currently typing.  That is client state, and it
// already lives inside the web-editor's own Zustand store.  The host's job is
// only to (a) feed the initial data in, (b) collect changes as they stream out
// via onContentChange, and (c) push the accumulated result back to the server.
//
// So we keep a small mutable "working copy" in a ref, seeded once from the
// query result and updated by the editor callbacks.  The query cache holds the
// last-known *server* snapshot; diffing the working copy against it is our
// dirty check.  Rails remains the source of truth for the data model -- we map
// its `divisions` / `assets` JSON into the shapes the web-editor wants.
//
// Both divisions and assets live directly on Project (Rails has a single
// per-project `Asset` model -- there is no more cross-project asset library,
// and no dedicated REST endpoints for either resource: `divisions_attributes`
// and `assets_attributes` are just nested attributes accepted by the one
// project PATCH). An entry with no `id` in either collection is a pure
// *addition* -- existing rows not mentioned are left untouched -- so we reuse
// that single endpoint for two different rhythms:
//
//   * divisions default to the deferred/autosaved bulk save
//     (editorStateToRailsPayload) -- EXCEPT a brand new division, which is
//     persisted immediately in onDivisionAdd so the web-editor can learn its
//     real server id right away.
//   * every asset action (upload/edit/remove) is persisted immediately, each
//     as its own single-entry PATCH, then invalidates the project query so
//     the `projectAssets` prop reconciles to server truth on the next read.
//     Assets are deliberately excluded from the bulk save payload for the
//     same reason.
//
// A fresh `projectAssets` array identity is an authoritative reset of the
// editor's pool, so we only ever hand it the query's current data, never a
// stale-but-new-identity array.
// ---------------------------------------------------------------------------

const AUTOSAVE_MS = 10000;

// --- Rails JSON  <->  web-editor shapes ------------------------------------
// railsDivisionToEditor / railsAssetToEditor / toEditorAsset now live in
// ./railsProjectMapping, shared with ./shared_source.jsx.

// Slugify arbitrary text into a valid PreTeXt ref (REF_REGEX: a leading letter
// or underscore, then letters/digits/hyphens/underscores).
/**
 * @param {string|undefined} value
 * @returns {string}
 */
function slugifyRef(value) {
  const slug = (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z_]/.test(slug) ? slug : `asset-${slug}`.replace(/-+$/, "");
}

// Transform the full project JSON into the state the editor renders from.
/**
 * @param {RailsProjectJson} json
 * @returns {EditorState}
 */
function railsToEditorState(json) {
  const root = (json.divisions ?? []).find((d) => d.is_root);
  const title = json.title ?? "";
  const projectType = json.document_type === "book" ? "book" : "article";
  const rootMeta = { type: projectType, title };
  return {
    title,
    docinfo: json.docinfo ?? "",
    commonDocinfo: json.common_docinfo ?? "",
    useCommonDocinfo: json.use_common_docinfo ?? false,
    language: json.language ?? DEFAULT_LANGUAGE,
    projectType,
    divisions: (json.divisions ?? []).map((d) => railsDivisionToEditor(d, rootMeta)),
    projectAssets: (json.assets ?? []).map(railsAssetToEditor),
    // rootDivisionId is the root division's *xmlId* (its ref), which is how the
    // web-editor identifies divisions, not the database id.
    rootDivisionId: root ? (root.ref ?? "") : undefined,
    // The root's *database* id: stable across xml:id renames, which is how the
    // collab save path re-finds the root in doc-derived state.
    rootDivisionUuid: root ? String(root.id) : undefined,
    // Real-time collaboration flag + the identity shown on remote cursors.
    collaborative: json.collaborative === true,
    editorUser: json.editor_user ?? null,
  };
}

// The docinfo actually in effect: the user's common docinfo when the project
// is opted in to it (and one is set), otherwise the project's own docinfo.
/**
 * @param {EditorState} state
 * @returns {string}
 */
function effectiveDocinfo(state) {
  return state.useCommonDocinfo && state.commonDocinfo ? state.commonDocinfo : state.docinfo;
}

// Assemble the full, standalone PreTeXt document that gets sent to the build
// server.  The web-editor owns this entirely: `assembleFullProjectSource`
// resolves every <plus:* ref="..."/> placeholder, converts any latex/markdown
// divisions to PreTeXt, wraps the result in the outer <pretext> with the
// docinfo we pass inserted as a sibling, and guarantees the root element
// carries a label/xml:id so the build server knows which file to return.
//
// The only thing Rails contributes is *which* docinfo is in effect (the user's
// common preamble vs. the project's own) -- the rest of the document shape is
// no longer reshaped here.
// `projectAssets` are passed in (server truth, from the live query) rather than
// read off `state`: the editor owns the live asset pool, so we no longer keep an
// asset working copy here -- the document only needs the assets to resolve each
// <plus:* ref="..."/> placeholder it emits.
/**
 * @param {EditorState} state
 * @param {Asset[]} projectAssets
 * @returns {string}
 */
function assembleFullPretextSource(state, projectAssets) {
  if (!state.rootDivisionId) return "";
  return assembleFullProjectSource(
    state.divisions,
    state.rootDivisionId,
    effectiveDocinfo(state),
    projectAssets.map(toEditorAsset),
    state.language,
  );
}

// Build the PATCH body Rails expects.  Only the fields permitted by
// project_params are sent.  We omit is_root so updates never toggle the root.
//
// Every division carries the UUID the *editor* minted for it (see
// `onDivisionAdd`), which Rails inserts under if it has never seen it and
// updates otherwise -- Project#tolerate_client_minted_ids makes that entry an
// upsert.  So this one payload both creates and updates, and re-sending a
// division is harmless: the id is stable from the moment the editor created it
// and survives later xml:id (ref) renames.
//
// `deletes` are records the session removed, as `{id, kind}` -- the shared
// doc's tombstones.  Each becomes a `_destroy` marker in the matching
// collection.  Re-sending one is likewise harmless (Rails drops a `_destroy`
// naming a row that is already gone), which is what makes a removal survive the
// acting client's own request failing or its tab closing mid-flight.
//
// Asset *content* is NOT in this payload: an asset's bytes can't ride in the
// shared doc, so the client that uploads one persists it immediately through
// its own single-entry `assets_attributes` PATCH (see the asset callbacks).
// Only asset *destroys* are re-sent from here.  We still pass `projectAssets`
// so the assembled `pretext_source` can resolve image refs.
/**
 * @param {EditorState} state
 * @param {Asset[]} projectAssets
 * @param {{id: string, kind: "division"|"asset"}[]} [deletes] - Records to destroy.
 * @returns {{project: Object}}
 */
function editorStateToRailsPayload(state, projectAssets, deletes = []) {
  const project = {
    title: state.title,
    docinfo: state.docinfo,
    use_common_docinfo: state.useCommonDocinfo,
    language: state.language,
    pretext_source: assembleFullPretextSource(state, projectAssets),
    divisions_attributes: [
      ...state.divisions.map((d) => ({
        id: d.id,
        ref: d.xmlId,
        source: d.source,
        source_format: d.sourceFormat,
      })),
      ...deletes
        .filter((d) => d.kind === "division")
        .map(({ id }) => ({ id, _destroy: true })),
    ],
  };
  const assetDeletes = deletes
    .filter((d) => d.kind === "asset")
    .map(({ id }) => ({ id, _destroy: true }));
  if (assetDeletes.length) project.assets_attributes = assetDeletes;
  return { project };
}

// The subset of working state that actually persists — used for dirty checks so
// we don't autosave on changes the server doesn't store.
/**
 * @param {EditorState} state
 * @returns {string} A JSON string suitable for equality comparison.
 */
function persistableShape(state) {
  return JSON.stringify({
    title: state.title,
    docinfo: state.docinfo,
    useCommonDocinfo: state.useCommonDocinfo,
    language: state.language,
    divisions: state.divisions.map((d) => ({
      id: d.id,
      xmlId: d.xmlId,
      source: d.source,
      sourceFormat: d.sourceFormat,
    })),
    // Tombstones count as unsaved work: a removal whose own PATCH failed is
    // only ever retried because the next dirty check still sees it here.
    deletes: (state.deletes ?? []).map((d) => `${d.kind}:${d.id}`).sort(),
    // Asset *content* is deliberately excluded: it's persisted immediately via
    // its own single-entry PATCH, so it never participates in the document
    // dirty check.
  });
}

// --- Collaboration helpers -------------------------------------------------

// Deterministic per-user cursor/avatar color (same palette every session, so
// a collaborator keeps their color across visits).
const COLLAB_COLORS = [
  "#0e639c", "#b45309", "#15803d", "#7c3aed",
  "#be123c", "#0f766e", "#a16207", "#4338ca",
];

/**
 * @param {string|undefined} id
 * @returns {string}
 */
function colorForUser(id) {
  let hash = 0;
  for (const char of String(id ?? "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

// The CollabDocState used to seed a brand-new shared doc, from the project
// state we already loaded. Only runs for the one client that wins the seed
// race (see YCableProvider.loadOrSeed).
//
// Assets are seeded too: from here on the doc, not this endpoint, is where
// collaborators learn about each other's assets, so anything the project
// already has must be in it. Only their metadata travels -- the bytes stay in
// ActiveStorage, reachable through the `url` each record carries.
/**
 * @param {EditorState} state
 * @returns {import("@pretextbook/web-editor").CollabDocState}
 */
function editorStateToCollabSeed(state) {
  return {
    title: state.title,
    docinfo: state.docinfo,
    useCommonDocinfo: state.useCommonDocinfo,
    language: state.language,
    divisions: state.divisions.map((d) => ({
      id: d.id,
      xmlId: d.xmlId,
      sourceFormat: d.sourceFormat,
      source: d.source,
      title: d.title,
      type: d.type,
    })),
    assets: (state.projectAssets ?? []).filter((a) => a.id).map(toEditorAsset),
  };
}

// In collab mode the shared doc — not this client's working copy — is the
// authoritative document, so save payloads are derived from it: it already
// contains every peer's edits, which is exactly what lets a single "leader"
// client autosave on behalf of the whole session. Shaped like EditorState so
// editorStateToRailsPayload/persistableShape work unchanged; divisions sorted
// by id so dirty-check comparisons don't depend on Y.Map iteration order.
/**
 * @param {import("yjs").Doc} doc
 * @param {EditorState} base - The initially loaded state (supplies the fields
 *   that don't live in the doc: commonDocinfo, projectType, root identity).
 * @returns {EditorState}
 */
function collabEditorState(doc, base) {
  const shared = docToState(doc);
  const divisions = shared.divisions
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((d) => ({
      id: d.id,
      xmlId: d.xmlId,
      source: d.source,
      sourceFormat: d.sourceFormat,
      title: d.title,
      type: d.type,
    }));
  // Re-find the root by database id — stable across xml:id renames.
  const root = divisions.find((d) => d.id === base.rootDivisionUuid);
  return {
    title: shared.title,
    docinfo: shared.docinfo,
    commonDocinfo: base.commonDocinfo,
    useCommonDocinfo: shared.useCommonDocinfo ?? base.useCommonDocinfo,
    language: shared.language ?? base.language,
    projectType: base.projectType,
    divisions,
    // The doc's assets are the session's truth about which assets exist; the
    // save only needs them to resolve <plus:* ref="..."/> placeholders in the
    // assembled source, since asset rows are written by whoever uploaded them.
    projectAssets: shared.assets.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    // Tombstones, sorted for a stable dirty-check comparison.
    deletes: shared.deleted.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    rootDivisionId: root?.xmlId ?? base.rootDivisionId,
    rootDivisionUuid: base.rootDivisionUuid,
  };
}

// --- The editor app --------------------------------------------------------

/**
 * @typedef {Object} EditorConfig
 * @property {string} projectId
 * @property {string} apiBase - The editor-state endpoint URL (`editorStateUrl`).
 * @property {string} [csrfToken]
 */

/**
 * @param {{ config: EditorConfig }} props
 * @returns {JSX.Element}
 */
function EditorApp({ config }) {
  const { projectId, apiBase, csrfToken } = config;

  // Rails routes the React side needs.  Kept here (rather than in many data
  // attributes) since they're derivable from the project id.
  const projectUrl = `/projects/${projectId}`;
  const previewUrl = `/projects/${projectId}/preview`;
  const copyUrl = `/projects/${projectId}/copy_conversion`;
  const feedbackUrl = `/projects/${projectId}/feedback`;
  // The static page (public/preview-frame.html, served at this project-scoped
  // URL by ProjectsController#preview_frame) the live preview is delivered
  // into, instead of `iframe.srcdoc`.
  //
  // This is what gives the preview a real URL, which is the only way
  // PreTeXt's print preview for worksheets and handouts can work at all --
  // it is entered via a `?printpreview=<id>` query string, and `srcdoc`
  // documents have no URL. It must be project-scoped (rather than the bare
  // `/preview-frame.html`) so that relative asset links in the rendered
  // preview -- e.g. `external/:ref` -- resolve against `/projects/${projectId}/...`,
  // matching AssetsController#share's member route.
  const previewFrameUrl = `/projects/${projectId}/preview-frame.html`;
  // Fetches the bytes of a remote image server-side (CORS workaround only --
  // does not persist anything; see onAssetFetchUrl below).
  const assetFetchUrl = "/asset_fetches";
  // Division/asset creation, edits, and removal all persist through `apiBase`
  // itself now -- Rails accepts `divisions_attributes`/`assets_attributes` as
  // nested attributes on the one project PATCH; there are no dedicated
  // `/divisions` or `/project_assets` REST endpoints anymore.

  // Lets the asset callbacks invalidate cached server state after a mutation.
  const queryClient = useQueryClient();

  // ----- READ: load the project JSON via TanStack Query --------------------
  // queryKey uniquely identifies this cache entry; queryFn does the fetch and
  // returns the already-transformed editor state.
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(apiBase, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Failed to load editor state: ${res.status}`);
      return railsToEditorState(await res.json());
    },
  });

  // ----- The live working copy + last-saved server snapshot ----------------
  // `working` is the buffer we mutate as edits stream in.  `serverSnapshot` is
  // what we last successfully saved (or first loaded); diffing the two is the
  // dirty check.  Both are refs because edits should not trigger React re-renders
  // here — the web-editor re-renders itself from its own store.
  const working = useRef(null);
  const serverSnapshot = useRef(null);
  // The initial data handed to <Editors>.  Captured exactly once so the props
  // stay stable for the whole session; pushing fresh `divisions` mid-edit would
  // fight the user's cursor.  Subsequent edits flow out via onContentChange.
  const initial = useRef(null);
  // Server-truth project assets, mirrored from the live query into a ref so the
  // document save can resolve each <plus:* ref="..."/> placeholder without
  // re-rendering.  The web-editor owns the live asset pool, so unlike divisions
  // we keep no asset working copy here -- this is just the latest server snapshot,
  // refreshed whenever an asset mutation invalidates the project query.
  const serverAssets = useRef([]);

  if (projectQuery.data && !initial.current) {
    initial.current = projectQuery.data;
    working.current = structuredClone(projectQuery.data);
    serverSnapshot.current = structuredClone(projectQuery.data);
  }
  if (projectQuery.data) serverAssets.current = projectQuery.data.projectAssets;

  // ----- Real-time collaboration ------------------------------------------
  // When the project has collaborators, the buffer sync moves to a shared
  // Yjs doc carried over ActionCable (YCableProvider); this PATCH-based module
  // remains the *persistence* layer, with the save payload derived from the
  // doc (see collabEditorState) and autosave gated to the session leader.
  // Solo projects skip all of this — providerRef stays null and behavior is
  // exactly as before.
  const providerRef = useRef(null);
  // The doc-derived state as of the last successful save (or session join) —
  // the collab-mode dirty-check baseline, mirroring serverSnapshot.
  const collabServerSnapshot = useRef(null);
  const [collabStatus, setCollabStatus] = useState("off"); // off|connecting|ready|error

  useEffect(() => {
    const data = projectQuery.data;
    if (!data?.collaborative || providerRef.current) return;
    const provider = new YCableProvider({
      projectId,
      csrfToken,
      user: {
        name: data.editorUser?.name || "Anonymous",
        color: colorForUser(data.editorUser?.id),
      },
    });
    providerRef.current = provider;
    setCollabStatus("connecting");
    provider
      .connect(() => editorStateToCollabSeed(data))
      .then(() => {
        // Baseline for the dirty check comes from the doc itself: it may
        // already be ahead of what we loaded (peers kept editing), and those
        // differences belong to the next autosave, not to a false "clean".
        collabServerSnapshot.current = collabEditorState(provider.doc, data);
        setCollabStatus("ready");
      })
      .catch((error) => {
        console.error("Failed to join collaborative session:", error);
        setCollabStatus("error");
      });
  }, [projectQuery.data, projectId, csrfToken]);

  useEffect(() => () => providerRef.current?.destroy(), []);

  // ----- WRITE: save via TanStack mutation ---------------------------------
  const saveMutation = useMutation({
    mutationFn: async ({ state, assets, deletes }) => {
      const payload = editorStateToRailsPayload(state, assets, deletes);
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      return state;
    },
  });

  const isDirty = useCallback(() => {
    // Collab mode: dirtiness is a property of the shared doc vs. what was last
    // persisted from it, not of this client's own working copy.
    const provider = providerRef.current;
    if (provider) {
      if (!collabServerSnapshot.current || !initial.current) return false;
      const docState = collabEditorState(provider.doc, initial.current);
      return persistableShape(docState) !== persistableShape(collabServerSnapshot.current);
    }
    if (!working.current || !serverSnapshot.current) return false;
    return persistableShape(working.current) !== persistableShape(serverSnapshot.current);
  }, []);

  // Save the current document.  `hard` saves even when not dirty (used by
  // the Save button and before copy-conversion).  Snapshots the buffer up
  // front so edits made *during* the in-flight save aren't mistakenly marked
  // saved.
  //
  // In collab mode the payload is derived from the shared doc (which holds
  // every peer's edits), and soft (auto)saves run only on the session leader —
  // one writer for the whole session instead of N clients issuing near-
  // identical PATCHes. Autosave failures are logged but not alerted: with the
  // doc as the source of truth a transient failure is retried on the next
  // tick, and racing a just-deleted division is an expected (self-healing)
  // case. Explicit saves still alert.
  const save = useCallback(
    async (hard = false) => {
      const provider = providerRef.current;
      if (provider) {
        if (!initial.current || !collabServerSnapshot.current) return false;
        if (!hard && !provider.isLeader()) return true;
        if (!hard && !isDirty()) return true;
        const snapshot = collabEditorState(provider.doc, initial.current);
        try {
          await saveMutation.mutateAsync({
            state: snapshot,
            // The doc's assets, not this client's last fetch: a peer may have
            // added an asset whose placeholder is already in the source, and
            // the assembled document has to be able to resolve it.
            assets: snapshot.projectAssets,
            deletes: snapshot.deletes,
          });
          // Rails has now dropped those rows, so the tombstones have done their
          // job; clearing them keeps the doc from accumulating one per removal
          // for the life of the session.
          clearDeletions(provider.doc, snapshot.deletes);
          collabServerSnapshot.current = { ...snapshot, deletes: [] };
          return true;
        } catch (error) {
          console.error("Error saving:", error);
          if (hard) alert("An error occurred while saving.");
          return false;
        }
      }

      if (!working.current) return false;
      if (!hard && !isDirty()) return true;
      const snapshot = structuredClone(working.current);
      const assets = serverAssets.current;
      try {
        await saveMutation.mutateAsync({ state: snapshot, assets, deletes: [] });
        serverSnapshot.current = snapshot;
        return true;
      } catch (error) {
        console.error("Error saving:", error);
        if (hard) alert("An error occurred while saving.");
        return false;
      }
    },
    [isDirty, saveMutation],
  );

  // ----- Autosave: fire `save` every AUTOSAVE_MS, only when dirty ----------
  // We hold `save` in a ref so the interval (set up once) always calls the
  // latest closure without resetting the timer.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const id = setInterval(() => {
      if (!saveMutation.isPending) saveRef.current(false);
    }, AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [saveMutation.isPending]);

  // ----- Editor callbacks: update the working copy in place ----------------
  const onContentChange = useCallback((change) => {
    const w = working.current;
    if (!w) return;
    const division = w.divisions.find((d) => d.xmlId === change.xmlId);
    if (division) {
      if (change.source !== undefined) division.source = change.source;
      if (change.sourceFormat !== undefined) division.sourceFormat = change.sourceFormat;
    }
    // Document-wide docinfo edits arrive against the root division.
    if (change.docinfo !== undefined) w.docinfo = change.docinfo;
  }, []);

  // ----- Shared PATCH helpers ------------------------------------------------
  // Every division/asset mutation below goes through the same `apiBase`
  // endpoint used for load + bulk save. Rails' `accepts_nested_attributes_for`
  // treats a `divisions_attributes`/`assets_attributes` entry with no `id` as a
  // pure addition, so a single-item array here can't disturb the rest of that
  // collection, and any top-level field left out of `project` (title, docinfo,
  // ...) is left alone server-side -- these are safe to fire independently of
  // the deferred bulk save.

  const handlePatchResponse = useCallback(async (res, fallbackMessage) => {
    if (!res.ok) {
      let message = fallbackMessage;
      try {
        const err = await res.json();
        message = err.error || Object.values(err).flat().join(", ") || message;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(message);
    }
    return res.json();
  }, []);

  // PATCH the project with a JSON-encoded partial payload and return the full,
  // updated Rails project JSON (`{ ...project, divisions: [...], assets: [...] }`).
  const patchProjectJson = useCallback(
    async (project) => {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ project }),
      });
      return handlePatchResponse(res, `Request failed: ${res.status}`);
    },
    [apiBase, csrfToken, handlePatchResponse],
  );

  // Same, but multipart -- the only way to hand Rails a real file upload for a
  // new file-backed asset (`assets_attributes[][file]` needs an actual
  // uploaded file, not a JSON string). `fields` becomes a single new entry at
  // `assets_attributes[0]`.
  const patchProjectAssetUpload = useCallback(
    async (fields) => {
      const form = new FormData();
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) form.append(`project[assets_attributes][0][${key}]`, value);
      });
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
        body: form,
      });
      return handlePatchResponse(res, `Upload failed: ${res.status}`);
    },
    [apiBase, csrfToken, handlePatchResponse],
  );

  // ----- Structural division changes: keep the working pool in sync --------
  // These fire for create/remove/rename of whole division records (vs.
  // onContentChange, which only edits an existing one).  All three are keyed by
  // the division's xmlId; the Rails UUID PK is the host's stable identity.
  //
  // onDivisionAdd fires for every new division -- manually added via the TOC,
  // converted from latex/markdown, or auto-created from a typed
  // <plus:TYPE ref="..."/> placeholder -- and the web-editor has already added
  // it to its own pool, and to the shared doc, before calling us.
  //
  // The division arrives carrying the UUID the *editor* minted for it, and we
  // insert under that id rather than let Rails assign one. That inversion is
  // the point: the record exists for collaborators the instant it is created
  // rather than only after this round trip, so the parent's
  // <plus:* ref="..."/> placeholder is never briefly pointing at nothing.
  // Rails takes the unfamiliar id as an insert (see
  // Project#tolerate_client_minted_ids), which also makes re-sending it later
  // -- as the bulk save does -- an update rather than a duplicate.
  //
  // We still persist immediately rather than waiting for the next bulk save, so
  // a division survives the tab closing right after it is created. But nothing
  // depends on this call succeeding any more: the division is already in the
  // doc and in `working`, the next save re-sends it, and the editor ignores our
  // return value. So a failure is logged, not thrown.
  const onDivisionAdd = useCallback(
    async (division) => {
      const w = working.current;
      if (!w) return;
      if (w.divisions.some((d) => d.xmlId === division.xmlId)) return;
      const record = {
        id: division.id,
        xmlId: division.xmlId,
        source: division.source ?? "",
        sourceFormat: division.sourceFormat ?? "pretext",
      };
      w.divisions.push(record);
      try {
        // division.title/type aren't sent: like the root division, they're
        // derivable from `source` itself (the wrapping tag + <title>) rather
        // than stored separately, so there's nothing here that could go stale.
        await patchProjectJson({
          divisions_attributes: [
            {
              id: record.id,
              ref: record.xmlId,
              source_format: record.sourceFormat,
              source: record.source,
            },
          ],
        });
        // Now persisted, so mirror it into the server snapshot too: otherwise
        // it looks unsaved, and removing it before the next bulk save would
        // skip the _destroy (see onDivisionRemove) and orphan the row on the
        // server. A distinct object per pool keeps the working copy and
        // snapshot from aliasing.
        serverSnapshot.current?.divisions.push({ ...record });
      } catch (error) {
        // Deliberately left out of serverSnapshot: the division stays dirty, so
        // the next bulk save carries it -- and in a collaborative session that
        // save may run on any client, since the doc holds the division too.
        console.error("Error creating division:", error);
      }
    },
    [patchProjectJson],
  );

  // Division removal persists immediately (like every asset mutation), not on
  // the next bulk save: in collab mode the bulk autosave may run on a *different*
  // client (the leader), whose doc-derived payload simply omits the removed
  // division. What carries the removal *across* clients is the shared doc's
  // tombstone, which the leader replays as a _destroy until it sticks — so this
  // immediate request is the fast path, not the only one.
  //
  // The destroy is sent unconditionally now. Rails drops a _destroy naming a row
  // it doesn't have (Project#tolerate_client_minted_ids), so a division the
  // editor created and removed before its create landed costs one harmless
  // request rather than needing to be recognized here.
  const onDivisionRemove = useCallback(
    (xmlId) => {
      const w = working.current;
      if (!w) return;
      const index = w.divisions.findIndex((d) => d.xmlId === xmlId);
      if (index === -1) return;
      const [removed] = w.divisions.splice(index, 1);
      if (serverSnapshot.current) {
        serverSnapshot.current.divisions = serverSnapshot.current.divisions.filter(
          (d) => d.id !== removed.id,
        );
      }
      patchProjectJson({ divisions_attributes: [ { id: removed.id, _destroy: true } ] })
        .catch((error) => {
          console.error("Error removing division:", error);
          // In a collaborative session the doc's tombstone means the leader will
          // retry this, so only a solo editor is left with nothing to fall back
          // on and needs telling.
          if (!providerRef.current) {
            alert("An error occurred while removing the section.");
          }
        });
    },
    [patchProjectJson],
  );

  const onDivisionUpdate = useCallback((xmlId, changes) => {
    const w = working.current;
    if (!w) return;
    const division = w.divisions.find((d) => d.xmlId === xmlId);
    if (!division) return;
    if (changes.sourceFormat !== undefined) division.sourceFormat = changes.sourceFormat;
    // An xml:id rename: update the ref, and if this is the root division keep
    // rootDivisionId (used to assemble/preview the doc) pointing at it.
    if (changes.xmlId !== undefined) {
      const newXmlId = changes.xmlId ?? "";
      if (w.rootDivisionId === division.xmlId) w.rootDivisionId = newXmlId;
      division.xmlId = newXmlId;
    }
  }, []);

  // ----- Assets ------------------------------------------------------------
  // The web-editor owns the live project-asset pool (seeded from the
  // `projectAssets` prop, mutated optimistically on its own), so these callbacks
  // are pure persistence: each writes through to Rails immediately -- as its
  // own single-entry `assets_attributes` PATCH to the project endpoint, there
  // being no dedicated asset REST resource anymore -- and then invalidates the
  // project query, so the prop reconciles to server truth on the next fetch.
  // An asset's `id` is now the one stable identity Rails and the client both
  // use; there's no separate join-row PK, and (since Asset now belongs
  // directly to a project, with no cross-project join) no asset library to
  // pick an existing upload from -- every project's assets are its own.

  // Invalidate the project query (whose `assets` drive the `projectAssets`
  // prop) after a mutation settles.
  const invalidateAssetQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }, [queryClient, projectId]);

  // Pick a project-unique ref from a desired slug.  A ref must be unique among
  // both the project's assets and its divisions (Asset enforces both), so
  // we dedupe against the live server assets and the working divisions, suffixing
  // `-2`, `-3`, ... on collision.  Read from refs at call time, so no deps.
  const uniqueRef = useCallback((desired) => {
    const base = slugifyRef(desired) || "asset";
    const taken = new Set([
      ...(working.current?.divisions ?? []).map((d) => d.xmlId),
      ...(serverAssets.current ?? []).map((p) => p.ref),
    ]);
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }, []);

  // The tag is inserted into the active division by the editor itself; the text
  // reaches us through onContentChange, so there's nothing to record here.
  const onAssetInsert = useCallback(() => {}, []);

  const onAssetUpload = useCallback(
    async (file, title) => {
      title = title || "New Asset";
      const ref = uniqueRef(slugifyRef(title.replace(/\.[^.]+$/, "")));
      const json = await patchProjectAssetUpload({ ref, kind: "file", title, file });
      const created = (json.assets ?? []).find((a) => a.ref === ref);
      invalidateAssetQueries();
      // contentType comes off the File itself -- a UI hint the server doesn't echo.
      return { ...toEditorAsset(railsAssetToEditor(created)), contentType: file.type || undefined };
    },
    [uniqueRef, patchProjectAssetUpload, invalidateAssetQueries],
  );

  // Fetches the image bytes server-side and hands back a File -- it does not
  // create a persisted asset. The editor commits the file (possibly after
  // letting the user edit it) through onAssetUpload, the same path used for
  // local file picks.
  const onAssetFetchUrl = useCallback(
    async (url) => {
      // Same-origin/relative URLs -- e.g. our own asset thumbnails, which the
      // Duplicate flow re-fetches -- must NOT go through the server-side proxy:
      // they have no scheme (SsrfFilter::InvalidUriScheme) and, once resolved,
      // point back at this app, which the SSRF filter also rejects (a private
      // IP in development). Fetch them directly in the browser instead; the
      // session cookie authorizes the owner-only redirect. The proxy exists
      // only to fetch arbitrary cross-origin URLs without hitting CORS.
      const absolute = new URL(url, window.location.origin);
      const sameOrigin = absolute.origin === window.location.origin;

      let blob;
      if (sameOrigin) {
        const res = await fetch(absolute, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`Could not fetch image: ${res.status}`);
        blob = await res.blob();
      } else {
        const res = await fetch(assetFetchUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) {
          let message = `Could not fetch image: ${res.status}`;
          try {
            const err = await res.json();
            message = err.error || message;
          } catch {
            /* non-JSON error body */
          }
          throw new Error(message);
        }
        blob = await res.blob();
      }
      const filename = url.split("/").pop()?.split("?")[0] || "image";
      return new File([ blob ], filename, { type: blob.type });
    },
    [assetFetchUrl, csrfToken],
  );

  // Persists an edit to an existing asset made through the web-editor's asset
  // editor -- its `ref`, its `title`, its authored `source` (e.g. an image's
  // <description> XML), and its `short_description` (an image's plain-text
  // alt description, auto-rendered as <shortdescription>).  Also the commit
  // step of Duplicate and Replace, which upload a file first and then give
  // the resulting asset its real ref/title/source/short_description.
  //
  // All fields go every time, keyed by `id` (the UUID, stable across
  // renames -- never `ref`, which is the thing being changed).  `ref`
  // especially: it is the name `<plus:* ref="..."/>` placeholders resolve
  // against, the `<image source="ref.ext">` the assembled pretext_source
  // carries, and the segment `/projects/:id/external/:ref` serves the file
  // from.  Leaving it here -- as this callback used to, sending only `source`
  // -- meant a rename showed correctly in the editor while every build and
  // published page still looked the asset up under its old name.
  //
  // `source`/`short_description` fall back to "" (rather than being left
  // `undefined`, which JSON.stringify would drop) so clearing either field in
  // the editor persists the blank value instead of leaving the column
  // untouched.
  const onAssetUpdate = useCallback(
    async (asset) => {
      await patchProjectJson({
        assets_attributes: [ {
          id: asset.id,
          ref: asset.ref,
          title: asset.title,
          source: asset.source ?? "",
          short_description: asset.shortDescription ?? "",
        } ],
      });
      invalidateAssetQueries();
    },
    [patchProjectJson, invalidateAssetQueries],
  );

  // Drop this asset from the project entirely (Asset belongs to exactly one
  // project now, so there's no separate "remove membership vs. delete" -- this
  // destroys the row). The editor has already removed it from its pool; this is
  // fire-and-forget persistence, then a reconcile via invalidate.
  //
  // In a collaborative session the editor has also written a tombstone into the
  // shared doc, so this request failing is recoverable: the session leader
  // re-sends the _destroy on its next save, and peers have already dropped the
  // asset from their pools regardless.
  //
  // The promise is returned so Replace can await it: the replacement takes over
  // this asset's ref, and Asset validates ref uniqueness within a project, so
  // that rename only succeeds once this row is gone.  It still resolves rather
  // than rejects on failure (the alert below is the report) -- a Replace whose
  // removal failed then fails again, visibly, on the rename.
  const onAssetRemove = useCallback(
    (asset) =>
      patchProjectJson({ assets_attributes: [{ id: asset.id, _destroy: true }] })
        .then(() => invalidateAssetQueries())
        .catch((error) => {
          console.error("Error removing asset:", error);
          if (!providerRef.current) {
            alert("An error occurred while removing the asset.");
          }
        }),
    [patchProjectJson, invalidateAssetQueries],
  );

  // The Asset Manager calls this when it opens; the editor overwrites its pool
  // with the result, so it must return *server-fresh* data -- re-fetch the
  // project query so assets associated earlier this session are included.
  // Depend on `.refetch` itself, not the query result object: TanStack Query
  // returns a new result object every render, so depending on the whole object
  // (as this used to) gave this callback a new identity every render too. The
  // web-editor's asset modal re-runs its load-on-open effect whenever
  // onLoadAssets changes identity, so that churn turned into an infinite
  // refetch loop the instant the modal opened (see asset_modal_loop_test.rb).
  // `.refetch` is stable across renders for a given query key, so this keeps
  // the callback stable.
  const onLoadAssets = useCallback(async () => {
    const { data } = await projectQuery.refetch();
    return (data?.projectAssets ?? []).map(toEditorAsset);
  }, [projectQuery.refetch]);

  const onTitleChange = useCallback((value) => {
    const w = working.current;
    if (!w) return;
    w.title = value ?? "";
    // Keep a latex/markdown root's own `title` field in sync: that's the one
    // case where assembleProjectSource reads the title off the division
    // itself rather than off the (nonexistent) XML.
    const root = w.divisions.find((d) => d.xmlId === w.rootDivisionId);
    if (root && root.sourceFormat !== "pretext") root.title = w.title;
  }, []);

  const onLanguageChange = useCallback((value) => {
    if (working.current) working.current.language = value || DEFAULT_LANGUAGE;
  }, []);

  const onUseCommonDocinfoChange = useCallback(
    (value) => {
      if (working.current) working.current.useCommonDocinfo = value === true;
      save();
    },
    [save],
  );

  const onCommonDocinfoChange = useCallback((value) => {
    // NOTE: common_docinfo is a user-level field and is not yet persisted by the
    // project PATCH (it isn't in project_params).  Tracked here for the editor's
    // UI; persisting it will need a dedicated user endpoint (future work).
    if (working.current) working.current.commonDocinfo = value ?? "";
  }, []);

  const onSaveButton = useCallback(async () => {
    if (await save(true)) window.location.href = projectUrl;
  }, [save, projectUrl]);

  const onCancelButton = useCallback(() => {
    if (confirm("Cancel without saving?")) window.location.href = projectUrl;
  }, [projectUrl]);

  // The web-editor hands us a standalone PreTeXt fragment scoped to whichever
  // division is currently open (the whole document only when that's the root)
  // plus a helper to post into the preview iframe. The fragment is already
  // build-ready -- the web-editor emits `<image source>` from each asset's
  // `fileRef` (the bare `<ref>.<ext>` filename), so nothing here needs fixing.
  // `project_id` lets ProjectsController#preview scope the `<base>` tag it
  // prepends to this project's own preview/external/:ref route (see
  // routes.rb) -- unlike the anonymous /tryit demo, which posts no
  // project_id and never has external assets to resolve.
  const onPreviewRebuild = useCallback(
    (source, title, postToIframe) => {
      postToIframe(previewUrl, { source, title, project_id: projectId, authenticity_token: csrfToken });
    },
    [previewUrl, projectId, csrfToken],
  );

  const onCreatePretextProjectCopy = useCallback(async () => {
    try {
      if (!(await save(true))) throw new Error("Failed to save current project");
      const res = await fetch(copyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `Failed to create converted copy: ${res.status}`);
      }
      const result = await res.json();
      window.location.href = result.project_url;
    } catch (error) {
      console.error("Error creating converted copy:", error);
      alert(`Failed to create converted copy:\n${error.message}`);
    }
  }, [save, copyUrl, csrfToken]);

  const onFeedbackSubmit = useCallback(
    async (feedback) => {
      try {
        const res = await fetch(feedbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({
            context: feedback.context,
            message: feedback.message,
            email: feedback.email,
            project_url: feedback.projectUrl,
            current_source: feedback.currentSource,
            source_format: feedback.sourceFormat,
            title: feedback.title,
            submitted_at: feedback.submittedAt,
          }),
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || `Failed to submit feedback: ${res.status}`);
        }
      } catch (error) {
        console.error("Error submitting feedback:", error);
        alert(`Failed to submit feedback: ${error.message}`);
      }
    },
    [feedbackUrl, csrfToken],
  );

  // The `projectAssets` prop seeds the editor's pool on mount and acts as an
  // external reset channel thereafter: a new array *identity* is treated as
  // authoritative and overwrites the editor's working pool.  So we memoize on
  // the query data itself -- the identity changes only when an asset mutation
  // invalidates the project query and a refetch lands fresh server truth, never
  // on an unrelated re-render (which would feed a stale-but-new-identity array).
  const projectAssets = useMemo(
    () => (projectQuery.data?.projectAssets ?? []).map(toEditorAsset),
    [projectQuery.data],
  );

  // ----- Render ------------------------------------------------------------
  if (projectQuery.isPending) {
    return <div className="flex h-full items-center justify-center">
      <div className="mx-5 text-center text-lg">Loading editor…</div>
    </div>;
  }
  if (projectQuery.isError) {
    return <div className="flex h-full items-center justify-center">
      <div class="mx-5 text-center">Error loading editor state. Please reload the page.</div>
    </div>;
  }
  // A collaborative project's editor waits for the shared doc: mounting before
  // it arrives would show (and let the user edit) state the session may have
  // long since moved past.
  if (projectQuery.data?.collaborative && collabStatus !== "ready") {
    if (collabStatus === "error") {
      return (
        <div class="flex h-full items-center justify-center"><div class="mx-5 text-center">
          Could not join the collaborative editing session. Please reload the page.
        </div></div>
      );
    }
    return (
      <div class="flex h-full items-center justify-center"><div class="mx-5 text-center">
        Connecting to collaborative session…
      </div></div>
    );
  }

  const state = initial.current;
  const provider = providerRef.current;
  return (
    <Editors
      title={state.title}
      docinfo={state.docinfo}
      commonDocinfo={state.commonDocinfo}
      useCommonDocinfo={state.useCommonDocinfo}
      language={state.language}
      projectType={state.projectType}
      divisions={state.divisions}
      rootDivisionId={state.rootDivisionId}
      collaboration={
        provider
          ? {
              doc: provider.doc,
              awareness: provider.awareness,
              user: provider.user,
            }
          : undefined
      }
      projectAssets={projectAssets}
      projectUrl={projectUrl}
      saveButtonLabel="Save and manage"
      cancelButtonLabel="Cancel"
      onContentChange={onContentChange}
      onDivisionAdd={onDivisionAdd}
      onDivisionRemove={onDivisionRemove}
      onDivisionUpdate={onDivisionUpdate}
      onAssetInsert={onAssetInsert}
      onAssetUpload={onAssetUpload}
      onAssetFetchUrl={onAssetFetchUrl}
      onAssetUpdate={onAssetUpdate}
      onAssetRemove={onAssetRemove}
      onLoadAssets={onLoadAssets}
      onTitleChange={onTitleChange}
      onLanguageChange={onLanguageChange}
      onUseCommonDocinfoChange={onUseCommonDocinfoChange}
      onCommonDocinfoChange={onCommonDocinfoChange}
      onSave={() => save()}
      onSaveButton={onSaveButton}
      onCancelButton={onCancelButton}
      onPreviewRebuild={onPreviewRebuild}
      previewFrameUrl={previewFrameUrl}
      onCreatePretextProjectCopy={onCreatePretextProjectCopy}
      onFeedbackSubmit={onFeedbackSubmit}
    />
  );
}

// --- Imperative mount/unmount interface used by the Stimulus controller ----

/** @type {import("react-dom/client").Root|null} */
let root = null;

/**
 * @param {Element} node - Mount point provided by the Stimulus controller.
 * @param {EditorConfig} config
 * @returns {void}
 */
function render(node, config) {
  // One QueryClient per mounted editor.  refetchOnWindowFocus is disabled: the
  // working copy is the live buffer, so we don't want a background refetch to
  // overwrite in-progress edits.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: 1 },
    },
  });
  root = ReactDOM.createRoot(node);
  root.render(
    <QueryClientProvider client={queryClient}>
      <EditorApp config={config} />
    </QueryClientProvider>,
  );
}

/** @returns {void} */
function destroy() {
  root?.unmount();
  root = null;
}

export { destroy, render };
