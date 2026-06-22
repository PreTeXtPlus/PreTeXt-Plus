import React, { useCallback, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
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

// Map one Rails project_asset (+ its library_asset) to the web-editor Asset.
function railsAssetToEditor(a) {
  const lib = a.library_asset ?? {};
  return {
    id: String(a.id),
    ref: a.ref ?? "",
    name: lib.short_description || lib.description || a.ref || "",
    kind: lib.kind === "doenet" ? "doenet" : "image",
    source: lib.content ?? undefined,
    url: lib.file ?? undefined,
  };
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
function assembleFullPretextSource(state) {
  if (!state.rootDivisionId) return "";
  return assembleFullProjectSource(
    state.divisions,
    state.rootDivisionId,
    effectiveDocinfo(state),
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
function editorStateToRailsPayload(state, deletes = []) {
  return {
    project: {
      title: state.title,
      docinfo: state.docinfo,
      use_common_docinfo: state.useCommonDocinfo,
      pretext_source: assembleFullPretextSource(state),
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

  if (projectQuery.data && !initial.current) {
    initial.current = projectQuery.data;
    working.current = structuredClone(projectQuery.data);
    serverSnapshot.current = structuredClone(projectQuery.data);
  }

  // ----- WRITE: save via TanStack mutation ---------------------------------
  const saveMutation = useMutation({
    mutationFn: async ({ state, deletes }) => {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(editorStateToRailsPayload(state, deletes)),
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
      const deletes = pendingDeletes.current.slice();
      try {
        await saveMutation.mutateAsync({ state: snapshot, deletes });
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
  // the division's xmlId; the Rails UUID PK is the host's stable identity, so a
  // new division gets a freshly minted UUID and a rename is just a ref change.
  const onDivisionAdd = useCallback((division) => {
    const w = working.current;
    if (!w) return;
    if (w.divisions.some((d) => d.xmlId === division.xmlId)) return;
    w.divisions.push({
      id: crypto.randomUUID(),
      xmlId: division.xmlId,
      content: division.content ?? "",
      sourceFormat: division.sourceFormat ?? "pretext",
    });
  }, []);

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

  // The web-editor hands us a fully-assembled standalone PreTeXt source plus a
  // helper to post into the preview iframe; we just forward it to the server.
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
      projectAssets={state.projectAssets}
      projectUrl={projectUrl}
      saveButtonLabel="Save"
      cancelButtonLabel="Cancel"
      onContentChange={onContentChange}
      onDivisionAdd={onDivisionAdd}
      onDivisionRemove={onDivisionRemove}
      onDivisionUpdate={onDivisionUpdate}
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
