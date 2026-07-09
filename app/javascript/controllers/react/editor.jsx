import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Editors, assembleFullProjectSource } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";

/** @typedef {import("@pretextbook/web-editor").Asset} Asset */
/** @typedef {import("@pretextbook/web-editor").Division} Division */

/**
 * A division record as returned by the Rails `divisions` JSON array.
 * @typedef {Object} RailsDivision
 * @property {string|number} id
 * @property {string} [ref]
 * @property {string} [source]
 * @property {string} [source_format]
 * @property {boolean} [is_root]
 */

/**
 * An asset record as returned by Rails' single per-project Asset model
 * (`assets/_asset.json.jbuilder`) -- flat, no nested library/project split.
 * @typedef {Object} RailsAsset
 * @property {string} id
 * @property {string} [ref]
 * @property {"file"|"authored"} [kind]
 * @property {string} [title]
 * @property {string} [source]
 * @property {string} [path] - Fetchable share URL; present only when a file is attached.
 * @property {string} [extension] - Present only when a file is attached.
 */

/**
 * The full project JSON returned by the editor-state endpoint.
 * @typedef {Object} RailsProjectJson
 * @property {string} [title]
 * @property {string} [docinfo]
 * @property {string} [common_docinfo]
 * @property {boolean} [use_common_docinfo]
 * @property {string} [document_type]
 * @property {RailsDivision[]} [divisions]
 * @property {RailsAsset[]} [assets]
 */

/**
 * The editor's own working representation of a division: a subset of
 * {@link Division}, missing `title`/`type` until derivable (see
 * railsDivisionToEditor).
 * @typedef {Object} EditorDivision
 * @property {string} id
 * @property {string} xmlId
 * @property {string} source
 * @property {string} sourceFormat
 * @property {string} [title]
 * @property {string} [type]
 */

/**
 * The client-side working/server-snapshot state mirrored from Rails and fed
 * to (or read back from) the `<Editors>` component.
 * @typedef {Object} EditorState
 * @property {string} title
 * @property {string} docinfo
 * @property {string} commonDocinfo
 * @property {boolean} useCommonDocinfo
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

// The root element tags a pretext document can open with.  A well-formed
// pretext root division's source *is* one of these; a malformed pre-migration
// one still holds a bare <section>.
const PRETEXT_ROOT_TAG = /^\s*<(article|book|slideshow)[\s>]/;

// The `type` of a pretext root, read from its own XML (the root element's tag
// name) -- undefined when the source isn't a root element yet.
/**
 * @param {string|undefined} source
 * @returns {string|undefined} "article" | "book" | "slideshow" | undefined
 */
function pretextRootType(source) {
  const match = PRETEXT_ROOT_TAG.exec(source ?? "");
  return match ? match[1] : undefined;
}

// Map one Rails division record to the web-editor's Division shape.
//
// A latex/markdown ROOT needs `type`/`title` passed in explicitly (rootMeta):
// there's no PreTeXt XML there for the web-editor to read a document type or
// title out of, so the assembler would otherwise render literal "undefined".
//
// A pretext division instead carries its type *in its own XML* -- the root
// element's tag name -- so we derive `type` from the source rather than from
// Rails metadata.  We only attach it once the source is actually a root
// element (<article>/<book>/<slideshow>): a malformed pretext root still
// holding a bare <section> (pre-migration data) gets no `type`, matching the
// old behavior, so the live editor won't try to rewrap that <section> into an
// <article>.  Once migrated to a real root element, it picks up the right type
// automatically and preview/TOC wrapping work without further changes here.
/**
 * @param {RailsDivision} d
 * @param {{type: "article"|"book", title: string}} rootMeta
 * @returns {EditorDivision}
 */
function railsDivisionToEditor(d, rootMeta) {
  const base = {
    id: String(d.id),
    xmlId: d.ref ?? "",
    source: d.source ?? "",
    sourceFormat: d.source_format ?? "pretext",
  };
  if (!d.is_root) return base;
  if (d.source_format !== "pretext") return { ...base, ...rootMeta };
  const type = pretextRootType(base.source);
  return type ? { ...base, type } : base;
}

// Since Rails collapsed LibraryAsset/ProjectAsset into a single per-project
// `Asset`, its `id` IS the identity the web-editor keys on directly -- no more
// project-asset-vs-library-asset split, and nothing extra to carry alongside it.
//
// An asset still carries two distinct file references, and they must not be
// confused:
//
//  * `url` -- `path`, Rails' `share_asset_project_path` redirect. A real,
//    fetchable URL. Used ONLY for the editor's own UI: the live thumbnail
//    `<img src>` in the Asset Manager / "Edit asset" dialog.
//
//  * `fileRef` -- a bare `<ref>.<ext>` external-asset filename. This is what the
//    web-editor emits as the `<image source="...">` attribute in any assembled
//    PreTeXt (live preview or save). The build server treats that value as a
//    plain external-asset filename and prepends `external/` itself, so a real
//    URL there would double-prefix. See the `<base>` tags in
//    projects_controller.rb / project.rb that make the resulting relative path
//    resolve wherever the build's output is displayed.
//
// `isFile` distinguishes a file-backed asset from one defined purely by its
// authored `source`; derived from `path`'s presence (only set when a file is
// attached), not from Rails' `kind` column -- the web-editor's own `AssetKind`
// no longer distinguishes a source-only image from a file-backed one (both are
// just `"image"`), so `kind` below is always `"image"`; the only other kind it
// supports, `"doenet"`, is a distinct, currently feature-flagged-off activity
// type with no creation path wired up yet.
//
// The bare `<ref>.<ext>` source filename for a file-backed asset, or undefined
// for a non-file asset (which relies entirely on its authored `source`) or one
// with no ref yet.
/**
 * @param {RailsAsset} asset
 * @param {string|undefined} ref
 * @returns {string|undefined}
 */
function fileRefFor(asset, ref) {
  if (!asset.path || !ref) return undefined;
  return asset.extension ? `${ref}.${asset.extension}` : ref;
}

// Map one Rails asset to the web-editor's Asset shape.
/**
 * @param {RailsAsset} a
 * @returns {Asset}
 */
function railsAssetToEditor(a) {
  return {
    id: String(a.id),
    ref: a.ref ?? "",
    title: a.title,
    kind: "image",
    source: a.source ?? undefined,
    url: a.path ?? undefined,
    isFile: Boolean(a.path),
    fileRef: fileRefFor(a, a.ref),
  };
}

// Strip a host project-asset record down to the bare web-editor Asset shape.
// `url` is the real thumbnail URL (asset-manager UI); `fileRef` is the bare
// `<ref>.<ext>` filename the web-editor emits as `<image source>` -- see
// railsAssetToEditor for why the two must stay distinct.
/**
 * @param {Asset} rec
 * @returns {Asset}
 */
function toEditorAsset(rec) {
  return {
    id: rec.id,
    ref: rec.ref,
    title: rec.title,
    kind: rec.kind,
    source: rec.source,
    url: rec.url,
    fileRef: rec.fileRef,
    // Recomputed from `url` rather than carried on `rec`, same reasoning as
    // railsAssetToEditor: file-backed-ness is a property of the attachment,
    // not of `kind`.
    isFile: Boolean(rec.url),
  };
}

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
    projectType,
    divisions: (json.divisions ?? []).map((d) => railsDivisionToEditor(d, rootMeta)),
    projectAssets: (json.assets ?? []).map(railsAssetToEditor),
    // rootDivisionId is the root division's *xmlId* (its ref), which is how the
    // web-editor identifies divisions, not the database id.
    rootDivisionId: root ? (root.ref ?? "") : undefined,
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
  );
}

// Build the PATCH body Rails expects.  Only the fields permitted by
// project_params are sent.  We omit is_root so updates never toggle the root.
//
// `deletes` is a list of division ids (Rails UUID PKs) the user removed; each
// is sent as a `_destroy` marker so Rails drops that row.  New divisions are
// sent with the client-minted UUID the host assigned in onDivisionAdd, which
// Rails inserts under that id -- so the id the host holds is stable from
// creation and survives later xml:id (ref) renames.
//
// Asset *membership* is NOT in this payload: it's persisted the moment the user
// adds/removes an asset, via its own single-entry `assets_attributes` PATCH
// (see the asset callbacks), not deferred to this bulk PATCH.  We still pass
// `projectAssets` (server truth) so the assembled `pretext_source` can resolve
// image refs.
/**
 * @param {EditorState} state
 * @param {Asset[]} projectAssets
 * @param {string[]} [deletes] - Division ids (Rails UUID PKs) to destroy.
 * @returns {{project: Object}}
 */
function editorStateToRailsPayload(state, projectAssets, deletes = []) {
  return {
    project: {
      title: state.title,
      docinfo: state.docinfo,
      use_common_docinfo: state.useCommonDocinfo,
      pretext_source: assembleFullPretextSource(state, projectAssets),
      divisions_attributes: [
        ...state.divisions.map((d) => ({
          id: d.id,
          ref: d.xmlId,
          source: d.source,
          source_format: d.sourceFormat,
        })),
        ...deletes.map((id) => ({ id, _destroy: true })),
      ],
    },
  };
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
    divisions: state.divisions.map((d) => ({
      id: d.id,
      xmlId: d.xmlId,
      source: d.source,
      sourceFormat: d.sourceFormat,
    })),
    // Asset membership is deliberately excluded: it's persisted immediately via
    // its own single-entry PATCH, so it never participates in the document
    // dirty check.
  });
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
  // Division ids (Rails UUID PKs) the user removed but we haven't saved yet.
  // Held separately because a removed division is gone from `working`, so its
  // _destroy marker has to be tracked outside the pool until the next save.
  const pendingDeletes = useRef([]);
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

  // ----- WRITE: save via TanStack mutation ---------------------------------
  const saveMutation = useMutation({
    mutationFn: async ({ state, assets, deletes, enqueue }) => {
      const payload = editorStateToRailsPayload(state, assets, deletes);
      if (enqueue) payload.enqueue_html_source_job = true;
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
    if (!working.current || !serverSnapshot.current) return false;
    if (pendingDeletes.current.length > 0) return true;
    return persistableShape(working.current) !== persistableShape(serverSnapshot.current);
  }, []);

  // Save the current working copy.  `force` saves even when not dirty (used by
  // the Save button and before copy-conversion).  `enqueue` triggers the server
  // to kick off an html_source background build (Save button only, not autosave).
  // Snapshots the buffer up front so edits made *during* the in-flight save
  // aren't mistakenly marked saved.
  const save = useCallback(
    async (hard = false) => {
      if (!working.current) return false;
      if (!hard && !isDirty()) return true;
      const snapshot = structuredClone(working.current);
      const assets = serverAssets.current;
      const deletes = pendingDeletes.current.slice();
      try {
        await saveMutation.mutateAsync({ state: snapshot, assets, deletes, enqueue: hard });
        serverSnapshot.current = snapshot;
        // Drop the deletes we just persisted, keeping any queued mid-save.
        pendingDeletes.current = pendingDeletes.current.filter((id) => !deletes.includes(id));
        return true;
      } catch (error) {
        console.error("Error saving:", error);
        alert("An error occurred while saving.");
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
  // it to its own pool under a throwaway local id before calling us. Unlike the
  // rest of the pool (which only reaches Rails on the next save), we persist
  // this one immediately via a single-entry `divisions_attributes` PATCH (no
  // `id`, so Rails builds a brand new row and assigns its own UUID): the
  // web-editor awaits our return value to learn the real backend id, so
  // creation can't wait for the next autosave. The new row's `ref` is unique
  // per project (validated), so we match the response back to it by `ref`.
  //
  // On failure we log and rethrow rather than add anything to `working` --  the
  // web-editor swallows the rejection and keeps the division in its own pool
  // under the local id, with no backing Rails record and no retry. Acceptable
  // for a first pass, but means a failed create here is currently invisible to
  // the user.
  const onDivisionAdd = useCallback(
    async (division) => {
      const w = working.current;
      if (!w) return;
      if (w.divisions.some((d) => d.xmlId === division.xmlId)) return;
      try {
        // division.title/type aren't sent: like the root division, they're
        // derivable from `source` itself (the wrapping tag + <title>) rather
        // than stored separately, so there's nothing here that could go stale.
        const json = await patchProjectJson({
          divisions_attributes: [
            {
              ref: division.xmlId,
              source_format: division.sourceFormat,
              source: division.source,
            },
          ],
        });
        const created = (json.divisions ?? []).find((d) => d.ref === division.xmlId);
        if (!created) throw new Error("Newly created division missing from response");
        w.divisions.push({
          id: created.id,
          xmlId: division.xmlId,
          source: division.source ?? "",
          sourceFormat: division.sourceFormat ?? "pretext",
        });
        return created.id;
      } catch (error) {
        console.error("Error creating division:", error);
        throw error;
      }
    },
    [patchProjectJson],
  );

  const onDivisionRemove = useCallback((xmlId) => {
    const w = working.current;
    if (!w) return;
    const index = w.divisions.findIndex((d) => d.xmlId === xmlId);
    if (index === -1) return;
    const [removed] = w.divisions.splice(index, 1);
    // Only ask Rails to destroy a row that was actually persisted; a division
    // added and removed before any save never reached the server.
    const persisted = serverSnapshot.current?.divisions.some((d) => d.id === removed.id);
    if (persisted) pendingDeletes.current.push(removed.id);
  }, []);

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

  // Persists an edit to an asset's authored `source` (e.g. an image's
  // <shortdescription>/<description> XML) made via the web-editor's "Edit
  // source" dialog.
  const onAssetUpdate = useCallback(
    async (asset) => {
      await patchProjectJson({ assets_attributes: [{ id: asset.id, source: asset.source ?? "" }] });
      invalidateAssetQueries();
    },
    [patchProjectJson, invalidateAssetQueries],
  );

  // Drop this asset from the project entirely (Asset belongs to exactly one
  // project now, so there's no separate "remove membership vs. delete" -- this
  // destroys the row). The editor has already removed it from its pool; this is
  // fire-and-forget persistence, then a reconcile via invalidate.
  const onAssetRemove = useCallback(
    (asset) => {
      patchProjectJson({ assets_attributes: [{ id: asset.id, _destroy: true }] })
        .then(() => invalidateAssetQueries())
        .catch((error) => {
          console.error("Error removing asset:", error);
          alert("An error occurred while removing the asset.");
        });
    },
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
    return <div className="mx-5">Loading editor…</div>;
  }
  if (projectQuery.isError) {
    return <div className="mx-5">Error loading editor state. Please reload the page.</div>;
  }

  const state = initial.current;
  return (
    <Editors
      title={state.title}
      docinfo={state.docinfo}
      commonDocinfo={state.commonDocinfo}
      useCommonDocinfo={state.useCommonDocinfo}
      projectType={state.projectType}
      divisions={state.divisions}
      rootDivisionId={state.rootDivisionId}
      projectAssets={projectAssets}
      projectUrl={projectUrl}
      saveButtonLabel="Save"
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
      onUseCommonDocinfoChange={onUseCommonDocinfoChange}
      onCommonDocinfoChange={onCommonDocinfoChange}
      onSave={() => save()}
      onSaveButton={onSaveButton}
      onCancelButton={onCancelButton}
      onPreviewRebuild={onPreviewRebuild}
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
