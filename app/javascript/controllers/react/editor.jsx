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
// What TanStack deliberately does NOT manage is the *live editing buffer* —
// the characters the user is currently typing.  That is client state, and it
// already lives inside the web-editor's own Zustand store.  The host's job is
// only to (a) feed the initial data in, (b) collect changes as they stream out
// via onContentChange, and (c) push the accumulated result back to the server.
//
// So we keep a small mutable "working copy" in a ref, seeded once from the
// query result and updated by the editor callbacks.  The query cache holds the
// last-known *server* snapshot; diffing the working copy against it is our
// dirty check.  Rails remains the source of truth for the data model — we map
// its `divisions` / `project_assets` JSON into the shapes the web-editor wants.
//
// Project ASSETS are handled differently from divisions: the web-editor owns
// its own live asset pool (seeded from the `projectAssets` prop, then mutated
// optimistically on its own), so we don't keep an asset working copy here.  The
// asset callbacks are pure persistence — each one writes through to Rails
// immediately (membership lives on its own /project_assets endpoint, not the
// deferred project PATCH) and then invalidates the project + library queries so
// the prop reconciles to server truth on the next fetch.  A fresh `projectAssets`
// array identity is an authoritative reset of the editor's pool, so we only ever
// hand it the query's current data, never a stale-but-new-identity array.
// ---------------------------------------------------------------------------

const AUTOSAVE_MS = 10000;

// --- Rails JSON  <->  web-editor shapes ------------------------------------

// The root element tags a pretext document can open with.  A well-formed
// pretext root division's content *is* one of these; a malformed pre-migration
// one still holds a bare <section>.
const PRETEXT_ROOT_TAG = /^\s*<(article|book|slideshow)[\s>]/;

// The `type` of a pretext root, read from its own XML (the root element's tag
// name) -- undefined when the content isn't a root element yet.
function pretextRootType(content) {
  const match = PRETEXT_ROOT_TAG.exec(content ?? "");
  return match ? match[1] : undefined;
}

// Map one Rails division record to the web-editor's Division shape.
//
// A latex/markdown ROOT needs `type`/`title` passed in explicitly (rootMeta):
// there's no PreTeXt XML there for the web-editor to read a document type or
// title out of, so the assembler would otherwise render literal "undefined".
//
// A pretext division instead carries its type *in its own XML* -- the root
// element's tag name -- so we derive `type` from the content rather than from
// Rails metadata.  We only attach it once the content is actually a root
// element (<article>/<book>/<slideshow>): a malformed pretext root still
// holding a bare <section> (pre-migration data) gets no `type`, matching the
// old behavior, so the live editor won't try to rewrap that <section> into an
// <article>.  Once migrated to a real root element, it picks up the right type
// automatically and preview/TOC wrapping work without further changes here.
function railsDivisionToEditor(d, rootMeta) {
  const base = {
    id: String(d.id),
    xmlId: d.ref ?? "",
    content: d.source ?? "",
    sourceFormat: d.source_format ?? "pretext",
  };
  if (!d.is_root) return base;
  if (d.source_format !== "pretext") return { ...base, ...rootMeta };
  const type = pretextRootType(base.content);
  return type ? { ...base, type } : base;
}

// An Asset's identity (the `id` the web-editor keys on) is the *library_asset*
// id, not the project_asset id: the Asset Manager decides whether a library
// asset is "in this project" by testing `projectAssetIds.has(libraryAsset.id)`,
// so both the project pool and the library pool must agree on that id.  The
// project_asset (join) id is carried separately as `projectAssetId` -- it's the
// stable PK we send/destroy through nested project_assets_attributes, exactly
// like a division's UUID.
//
// An asset carries two distinct file references, and they must not be confused:
//
//  * `url` -- `lib.file`, Rails' `preview_asset_file_path` redirect (owner-only).
//    A real, fetchable URL. Used ONLY for the editor's own UI: the live
//    thumbnail `<img src>` in the Asset Manager / "Edit asset" dialog.
//
//  * `fileRef` -- a bare `<id>.<ext>` external-asset filename. This is what the
//    web-editor emits as the `<image source="...">` attribute in any assembled
//    PreTeXt (live preview or save). The build server treats that value as a
//    plain external-asset filename and prepends `external/` itself, so a real
//    URL there would double-prefix. See the `<base>` tags in
//    projects_controller.rb / project.rb that make the resulting relative path
//    resolve wherever the build's output is displayed.
//
// `isFile` distinguishes a file-backed asset from one defined purely by its
// authored `source` (e.g. a future "defined in source" image); derived from the
// attachment's presence, not from `kind` (which only splits image vs. doenet).
//
// The bare `<id>.<ext>` source filename for a file-backed asset, or undefined
// for a non-file asset (which relies entirely on its authored `source`).
function fileRefFor(lib) {
  if (!lib.file || lib.id == null) return undefined;
  return lib.extension ? `${lib.id}.${lib.extension}` : String(lib.id);
}

// Map one Rails project_asset (+ its library_asset) to the host's richer record.
function railsAssetToEditor(a) {
  const lib = a.library_asset ?? {};
  return {
    id: String(lib.id ?? ""),
    projectAssetId: String(a.id),
    ref: a.ref ?? "",
    name: lib.short_description || lib.description || a.ref || "",
    kind: lib.kind === "doenet" ? "doenet" : "image",
    source: lib.content ?? undefined,
    url: lib.file ?? undefined,
    isFile: Boolean(lib.file),
    fileRef: fileRefFor(lib),
  };
}

// Map one Rails library_asset JSON to a library-pool Asset.  Library assets have
// no project `ref` of their own, so we derive a default slug; once the asset is
// in the current project we override it with the real project ref (see
// reconcileLibraryRefs) so inserting from the library uses the right tag.
function railsLibraryAssetToEditor(lib) {
  const name = lib.short_description || lib.description || "";
  return {
    id: String(lib.id),
    ref: slugifyRef(name),
    name,
    kind: lib.kind === "doenet" ? "doenet" : "image",
    source: lib.content ?? undefined,
    url: lib.file ?? undefined,
    isFile: Boolean(lib.file),
    fileRef: fileRefFor(lib),
  };
}

// Strip a host project-asset record down to the bare web-editor Asset shape.
// `url` is the real thumbnail URL (asset-manager UI); `fileRef` is the bare
// `<id>.<ext>` filename the web-editor emits as `<image source>` -- see
// railsAssetToEditor for why the two must stay distinct.
function toEditorAsset(rec) {
  return {
    id: rec.id,
    ref: rec.ref,
    name: rec.name,
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
function slugifyRef(value) {
  const slug = (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z_]/.test(slug) ? slug : `asset-${slug}`.replace(/-+$/, "");
}

// Transform the full project JSON into the state the editor renders from.
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
    projectAssets: (json.project_assets ?? []).map(railsAssetToEditor),
    // rootDivisionId is the root division's *xmlId* (its ref), which is how the
    // web-editor identifies divisions, not the database id.
    rootDivisionId: root ? (root.ref ?? "") : undefined,
  };
}

// The docinfo actually in effect: the user's common docinfo when the project
// is opted in to it (and one is set), otherwise the project's own docinfo.
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
// adds/removes an asset, through the dedicated /project_assets endpoint (see the
// asset callbacks), not deferred to this PATCH.  We still pass `projectAssets`
// (server truth) so the assembled `pretext_source` can resolve image refs.
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
          source: d.content,
          source_format: d.sourceFormat,
        })),
        ...deletes.map((id) => ({ id, _destroy: true })),
      ],
    },
  };
}

// The subset of working state that actually persists — used for dirty checks so
// we don't autosave on changes the server doesn't store.
function persistableShape(state) {
  return JSON.stringify({
    title: state.title,
    docinfo: state.docinfo,
    useCommonDocinfo: state.useCommonDocinfo,
    divisions: state.divisions.map((d) => ({
      id: d.id,
      xmlId: d.xmlId,
      content: d.content,
      sourceFormat: d.sourceFormat,
    })),
    // Asset membership is deliberately excluded: it's persisted immediately via
    // its own endpoint, so it never participates in the document dirty check.
  });
}

// --- The editor app --------------------------------------------------------

function EditorApp({ config }) {
  const { projectId, apiBase, csrfToken } = config;

  // Rails routes the React side needs.  Kept here (rather than in many data
  // attributes) since they're derivable from the project id.
  const projectUrl = `/projects/${projectId}`;
  const previewUrl = "/projects/preview";
  const copyUrl = `/projects/${projectId}/copy_conversion`;
  const feedbackUrl = "/projects/feedback";
  // The user's cross-project asset library (JSON CRUD lives under /library).
  const libraryUrl = "/library.json";
  const libraryAssetUrl = (id) => `/library/${id}.json`;
  // Fetches the bytes of a remote image server-side (CORS workaround only --
  // does not persist anything; see onAssetFetchUrl below).
  const assetFetchUrl = "/asset_fetches";
  // Persists a single new division immediately (see onDivisionAdd below),
  // unlike the rest of the divisions pool which only round-trips on save.
  const divisionsUrl = `/projects/${projectId}/divisions`;
  // Persists project<->library_asset membership immediately, the asset analogue
  // of divisionsUrl.  DELETE keys on the *library_asset* id (the editor's
  // `Asset.id`); a project has at most one membership per library asset.
  const projectAssetsUrl = `/projects/${projectId}/project_assets`;

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

  // ----- READ: load the user's asset library --------------------------------
  // Separate from the project: it spans every project, and the Asset Manager
  // re-fetches it (via onLoadLibraryAssets) each time it opens, so uploads made
  // this session show up without a page reload.
  const libraryQuery = useQuery({
    queryKey: ["libraryAssets"],
    queryFn: async () => {
      const res = await fetch(libraryUrl, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Failed to load asset library: ${res.status}`);
      return (await res.json()).map(railsLibraryAssetToEditor);
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
  // we keep no asset working copy -- this is just the latest server snapshot,
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
    mutationFn: async ({ state, assets, deletes }) => {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(editorStateToRailsPayload(state, assets, deletes)),
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
  // the Save button and before copy-conversion).  Snapshots the buffer up front
  // so edits made *during* the in-flight save aren't mistakenly marked saved.
  const save = useCallback(
    async (force = false) => {
      if (!working.current) return false;
      if (!force && !isDirty()) return true;
      const snapshot = structuredClone(working.current);
      const assets = serverAssets.current;
      const deletes = pendingDeletes.current.slice();
      try {
        await saveMutation.mutateAsync({ state: snapshot, assets, deletes });
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
      if (change.sourceContent !== undefined) division.content = change.sourceContent;
      if (change.sourceFormat !== undefined) division.sourceFormat = change.sourceFormat;
    }
    // Document-wide docinfo edits arrive against the root division.
    if (change.docinfo !== undefined) w.docinfo = change.docinfo;
  }, []);

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
  // this one immediately: the web-editor awaits our return value to learn the
  // real backend id, so creation can't wait for the next autosave.
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
        const res = await fetch(divisionsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({
            division: {
              ref: division.xmlId,
              source_format: division.sourceFormat,
              source: division.content,
            },
          }),
        });
        if (!res.ok) throw new Error(`Failed to create division: ${res.status}`);
        const { id } = await res.json();
        w.divisions.push({
          id,
          xmlId: division.xmlId,
          content: division.content ?? "",
          sourceFormat: division.sourceFormat ?? "pretext",
        });
        return id;
      } catch (error) {
        console.error("Error creating division:", error);
        throw error;
      }
    },
    [divisionsUrl, csrfToken],
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
  // are pure persistence: each writes through to Rails immediately and then
  // invalidates the project + library queries, so the prop reconciles to server
  // truth on the next fetch.  Two server resources are involved: the user's
  // cross-project library (/library) and a project's membership of a library
  // asset (/project_assets).  Both key on the *library_asset* id (the editor's
  // `Asset.id`); the membership join row's own PK never reaches the client.

  // Invalidate both asset-bearing caches after a mutation settles: the project
  // query (whose project_assets drive the prop) and the standalone library list.
  const invalidateAssetQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    queryClient.invalidateQueries({ queryKey: ["libraryAssets"] });
  }, [queryClient, projectId]);

  // Pick a project-unique ref from a desired slug.  A ref must be unique among
  // both the project's assets and its divisions (ProjectAsset enforces both), so
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

  // POST a new library asset and return it mapped to a library-pool Asset.
  // `body` is either FormData (file upload) or a plain object sent as JSON.
  const createLibraryAsset = useCallback(
    async (body) => {
      const isForm = body instanceof FormData;
      const res = await fetch(libraryUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
          // Let the browser set the multipart boundary for FormData.
          ...(isForm ? {} : { "Content-Type": "application/json" }),
        },
        body: isForm ? body : JSON.stringify(body),
      });
      if (!res.ok) {
        let message = `Request failed: ${res.status}`;
        try {
          const err = await res.json();
          message = err.error || Object.values(err).flat().join(", ") || message;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }
      return railsLibraryAssetToEditor(await res.json());
    },
    [libraryUrl, csrfToken],
  );

  // Persist this project's membership of a library asset under `ref`, returning
  // the saved join row mapped to a host record (carrying the real ref + url).
  const associateAsset = useCallback(
    async (libraryAssetId, ref) => {
      const res = await fetch(projectAssetsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ project_asset: { library_asset_id: libraryAssetId, ref } }),
      });
      if (!res.ok) {
        let message = `Failed to add asset to project: ${res.status}`;
        try {
          const err = await res.json();
          message = err.error || Object.values(err).flat().join(", ") || message;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }
      return railsAssetToEditor(await res.json());
    },
    [projectAssetsUrl, csrfToken],
  );

  // The tag is inserted into the active division by the editor itself; the text
  // reaches us through onContentChange, so there's nothing to record here.
  const onAssetInsert = useCallback(() => {}, []);

  // User picked a library asset not yet in this project: persist the membership
  // under a project-unique ref (the editor has already shown it optimistically).
  const onAssetAddFromLibrary = useCallback(
    async (asset) => {
      await associateAsset(asset.id, uniqueRef(asset.ref || slugifyRef(asset.name)));
      invalidateAssetQueries();
    },
    [associateAsset, uniqueRef, invalidateAssetQueries],
  );

  const onAssetUpload = useCallback(
    async (file) => {
      const form = new FormData();
      form.append("library_asset[file]", file);
      form.append("library_asset[kind]", "file");
      form.append("library_asset[short_description]", file.name);
      // Create the library asset (upload bytes), then associate it with the
      // project; only resolve once both are persisted, returning the canonical
      // Asset the editor keys its optimistic entry against.
      const created = await createLibraryAsset(form);
      const ref = uniqueRef(slugifyRef(file.name.replace(/\.[^.]+$/, "")) || created.ref);
      const member = await associateAsset(created.id, ref);
      invalidateAssetQueries();
      // contentType comes off the File itself -- a UI hint the server doesn't echo.
      return { ...toEditorAsset(member), contentType: file.type || undefined };
    },
    [createLibraryAsset, associateAsset, uniqueRef, invalidateAssetQueries],
  );

  // Fetches the image bytes server-side and hands back a File -- it does not
  // create a library asset or project membership. The editor commits the
  // file (possibly after letting the user edit it) through onAssetUpload,
  // the same path used for local file picks.
  const onAssetFetchUrl = useCallback(
    async (url) => {
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
      const blob = await res.blob();
      const filename = url.split("/").pop()?.split("?")[0] || "image";
      return new File([ blob ], filename, { type: blob.type });
    },
    [assetFetchUrl, csrfToken],
  );

  const onCreateDoenet = useCallback(
    async (name, ref) => {
      // Create the doenet library asset, then associate it; only resolve once
      // both are persisted, returning the canonical Asset.
      const created = await createLibraryAsset({
        library_asset: { kind: "doenet", short_description: name, content: "" },
      });
      const member = await associateAsset(created.id, uniqueRef(ref));
      invalidateAssetQueries();
      return toEditorAsset(member);
    },
    [createLibraryAsset, associateAsset, uniqueRef, invalidateAssetQueries],
  );

  // Persists an edit to an asset's authored `source` (e.g. an image's
  // <shortdescription>/<description> XML, or a doenet activity body) made via
  // the web-editor's "Edit source" dialog.  The edit lives on the library asset,
  // so we PATCH /library and invalidate -- the project query refetch then carries
  // the new source into the project pool.
  const onAssetUpdate = useCallback(
    async (asset) => {
      const res = await fetch(libraryAssetUrl(asset.id), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ library_asset: { content: asset.source ?? "" } }),
      });
      if (!res.ok) {
        let message = `Failed to save asset: ${res.status}`;
        try {
          const err = await res.json();
          message = err.error || Object.values(err).flat().join(", ") || message;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }
      invalidateAssetQueries();
    },
    [csrfToken, invalidateAssetQueries],
  );

  // Drop this project's membership of the asset (library asset untouched).  The
  // editor has already removed it from its pool; this is fire-and-forget
  // persistence keyed on the library asset id, then a reconcile via invalidate.
  const onAssetRemove = useCallback(
    (asset) => {
      fetch(`${projectAssetsUrl}/${asset.id}`, {
        method: "DELETE",
        headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to remove asset: ${res.status}`);
          invalidateAssetQueries();
        })
        .catch((error) => {
          console.error("Error removing asset:", error);
          alert("An error occurred while removing the asset.");
        });
    },
    [projectAssetsUrl, csrfToken, invalidateAssetQueries],
  );

  // Library rows carry a derived ref by default; when an asset is already in the
  // current project, show/insert its real project ref instead so the inserted
  // <plus:* ref="..."/> matches the stored membership.  Reads server truth (the
  // live project query) since the editor, not us, owns the working asset pool.
  const reconcileLibraryRefs = useCallback((list) => {
    const members = serverAssets.current ?? [];
    return list.map((a) => {
      const member = members.find((p) => p.id === a.id);
      return member ? { ...a, ref: member.ref } : a;
    });
  }, []);

  // The Asset Manager calls these when it opens; the editor overwrites its pool
  // with the result, so both must return *server-fresh* data -- onLoadAssets
  // re-fetches the project query so assets associated earlier this session are
  // included, and the library loader re-fetches so freshly uploaded ones appear.
  const onLoadAssets = useCallback(async () => {
    const { data } = await projectQuery.refetch();
    return (data?.projectAssets ?? []).map(toEditorAsset);
  }, [projectQuery]);

  const onLoadLibraryAssets = useCallback(async () => {
    const { data } = await libraryQuery.refetch();
    return reconcileLibraryRefs(data ?? []);
  }, [libraryQuery, reconcileLibraryRefs]);

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
  // `fileRef` (the bare `<id>.<ext>` filename), so nothing here needs fixing.
  const onPreviewRebuild = useCallback(
    (source, title, postToIframe) => {
      postToIframe(previewUrl, { source, title, authenticity_token: csrfToken });
    },
    [previewUrl, csrfToken],
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
      libraryAssets={reconcileLibraryRefs(libraryQuery.data ?? [])}
      projectUrl={projectUrl}
      saveButtonLabel="Save"
      cancelButtonLabel="Cancel"
      onContentChange={onContentChange}
      onDivisionAdd={onDivisionAdd}
      onDivisionRemove={onDivisionRemove}
      onDivisionUpdate={onDivisionUpdate}
      onAssetInsert={onAssetInsert}
      onAssetAddFromLibrary={onAssetAddFromLibrary}
      onAssetUpload={onAssetUpload}
      onAssetFetchUrl={onAssetFetchUrl}
      onCreateDoenet={onCreateDoenet}
      onAssetUpdate={onAssetUpdate}
      onAssetRemove={onAssetRemove}
      onLoadAssets={onLoadAssets}
      onLoadLibraryAssets={onLoadLibraryAssets}
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

let root = null;

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

function destroy() {
  root?.unmount();
  root = null;
}

export { destroy, render };
