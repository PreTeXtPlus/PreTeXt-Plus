// Pure mappers between Rails' project JSON shape and the web-editor's
// `Division`/`Asset` shapes. Shared by every host that mounts `<Editors>`
// (./editor.jsx for the authenticated editor, ./shared_source.jsx for the
// read-only share view) so they can't silently drift on how the same JSON
// is interpreted.

import { assembleFullProjectSource, DEFAULT_LANGUAGE } from "@pretextbook/web-editor";

/** @typedef {import("@pretextbook/web-editor").Asset} Asset */
/** @typedef {import("@pretextbook/web-editor").Division} Division */
/** @typedef {import("@pretextbook/web-editor").Snippet} Snippet */

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
 * @property {"file"|"authored"} kind
 * @property {string} [title]
 * @property {string} [source]
 * @property {string} [short_description] - Plain-text image alt description; rendered as
 *   `<shortdescription>` in the assembled PreTeXt.
 * @property {string} [path] - Fetchable share URL; present only when a file is attached.
 * @property {string} [extension] - Present only when a file is attached.
 * @property {string} [thumbnail_path] - Fetchable small-preview URL; present only when the
 *   attached file can be thumbnailed (see Asset#thumbnailable?).
 * @property {string} [content_type] - The attached file's MIME type; present only when a
 *   file is attached.
 */

/**
 * A snippet record as returned by Rails' `snippets` JSON array
 * (`snippets/_snippet.json.jbuilder`).
 * @typedef {Object} RailsSnippet
 * @property {string} id
 * @property {string} [ref]
 * @property {string} [source]
 * @property {string} [source_format]
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
export function pretextRootType(source) {
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
export function railsDivisionToEditor(d, rootMeta) {
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
// An asset still carries three distinct file references, and they must not be
// confused:
//
//  * `url` -- `path`, Rails' `share_asset_project_path` redirect. A real,
//    fetchable URL to the full file. Used ONLY for the editor's own UI: the
//    "Manage asset" dialog's live preview, and as a fallback thumbnail when
//    `thumbnailUrl` is unavailable.
//
//  * `thumbnailUrl` -- `thumbnail_path`, Rails' `share_asset_thumbnail_project_path`
//    redirect to a small resized variant. A real, fetchable URL, present only
//    when the file is thumbnailable (see Asset#thumbnailable?). Used for the
//    asset list's `<img src>` in the Asset Manager.
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
// authored `source`; read straight from Rails' `kind` column (`file`/
// `authored`), the single source of truth for that distinction.
//
// The bare `<ref>.<ext>` source filename for a file-backed asset, or undefined
// for a non-file asset (which relies entirely on its authored `source`) or one
// with no ref yet.
/**
 * @param {RailsAsset} asset
 * @param {string|undefined} ref
 * @returns {string|undefined}
 */
export function fileRefFor(asset, ref) {
  if (!asset.path || !ref) return undefined;
  return asset.extension ? `${ref}.${asset.extension}` : ref;
}

// Map one Rails asset to the web-editor's Asset shape.
/**
 * @param {RailsAsset} a
 * @returns {Asset}
 */
export function railsAssetToEditor(a) {
  return {
    id: String(a.id),
    ref: a.ref ?? "",
    title: a.title,
    source: a.source ?? undefined,
    shortDescription: a.short_description ?? undefined,
    url: a.path ?? undefined,
    thumbnailUrl: a.thumbnail_path ?? undefined,
    extension: a.extension ?? undefined,
    contentType: a.content_type ?? undefined,
    isFile: a.kind === "file",
    fileRef: fileRefFor(a, a.ref),
  };
}

// Strip a host project-asset record down to the bare web-editor Asset shape.
// `url`/`thumbnailUrl` are the real file URLs (asset-manager UI); `fileRef` is
// the bare `<ref>.<ext>` filename the web-editor emits as `<image source>` --
// see railsAssetToEditor for why these must stay distinct.
/**
 * @param {Asset} rec
 * @returns {Asset}
 */
export function toEditorAsset(rec) {
  return {
    id: rec.id,
    ref: rec.ref,
    title: rec.title,
    source: rec.source,
    shortDescription: rec.shortDescription,
    url: rec.url,
    thumbnailUrl: rec.thumbnailUrl,
    extension: rec.extension,
    contentType: rec.contentType,
    fileRef: rec.fileRef,
    // Already correctly set by railsAssetToEditor upstream (from Rails' real
    // `kind` column) for every asset that reaches this function.
    isFile: rec.isFile,
  };
}

// Map one Rails snippet to the web-editor's Snippet shape. Simpler than an
// asset's mapper -- no file/thumbnail/content-type fields, since a snippet is
// always pure text.
/**
 * @param {RailsSnippet} s
 * @returns {Snippet}
 */
export function railsSnippetToEditor(s) {
  return {
    id: String(s.id),
    ref: s.ref ?? "",
    source: s.source ?? "",
    sourceFormat: s.source_format ?? "pretext",
  };
}

// Strip a host project-snippet record down to the bare web-editor Snippet
// shape. Mirrors `toEditorAsset`.
/**
 * @param {Snippet} rec
 * @returns {Snippet}
 */
export function toEditorSnippet(rec) {
  return {
    id: rec.id,
    ref: rec.ref,
    source: rec.source,
    sourceFormat: rec.sourceFormat,
  };
}

// ---------------------------------------------------------------------------
// Whole-project mapping and assembly
// ---------------------------------------------------------------------------
//
// Below this line the module stops being per-record mappers and becomes the
// one definition of "Rails project JSON -> the assembled PreTeXt document".
// Three hosts share it: the authenticated editor (./editor.jsx), the read-only
// share view (./shared_source.jsx), and -- since the server took over building
// the document a real `pretext build` consumes -- the Node assembler that
// SourceAssembler shells out to (../../../script/assemble-source.mjs).
//
// That last one is the reason this lives here rather than in editor.jsx. The
// server's assembled source has to be the same document the browser would have
// produced from the same project, byte for byte; the only way to guarantee that
// is for both to run this code rather than two readings of it.

/**
 * The full project JSON returned by the editor-state endpoint
 * (`projects/_project.json.jbuilder`).
 * @typedef {Object} RailsProjectJson
 * @property {string} [title]
 * @property {string} [docinfo]
 * @property {string} [common_docinfo]
 * @property {boolean} [use_common_docinfo]
 * @property {string} [document_type]
 * @property {string} [language]
 * @property {RailsDivision[]} [divisions]
 * @property {RailsAsset[]} [assets]
 * @property {RailsSnippet[]} [snippets]
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
 * @property {"article"|"book"|"slideshow"} projectType
 * @property {EditorDivision[]} divisions
 * @property {Asset[]} [projectAssets]
 * @property {Snippet[]} [projectSnippets]
 * @property {string} [rootDivisionId]
 */

// Root element tag names the editor understands, which is also exactly the set
// of `Project#document_type` values -- see railsToEditorState for why the two
// vocabularies are deliberately the same.
const ROOT_ELEMENT_TYPES = [ "article", "book", "slideshow" ];

// Transform the full project JSON into the state the editor renders from.
/**
 * @param {RailsProjectJson} json
 * @returns {EditorState}
 */
export function railsToEditorState(json) {
  const root = (json.divisions ?? []).find((d) => d.is_root);
  const title = json.title ?? "";
  // `document_type` and the editor's `projectType` are the same vocabulary --
  // root element tag names -- so this is an identity map with a fallback, not a
  // translation. That is deliberate: the editor synthesizes a wrapper element
  // from this value, so it has to be a real tag name. Anything unrecognised
  // becomes an article, since a wrong tag is worse than a default one.
  const projectType = ROOT_ELEMENT_TYPES.includes(json.document_type)
    ? json.document_type
    : "article";
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
    projectSnippets: (json.snippets ?? []).map(railsSnippetToEditor),
    // rootDivisionId is the root division's *xmlId* (its ref), which is how the
    // web-editor identifies divisions, not the database id.
    rootDivisionId: root ? (root.ref ?? "") : undefined,
    // The root's *database* id: stable across xml:id renames, which is how the
    // collab save path re-finds the root in doc-derived state.
    rootDivisionUuid: root ? String(root.id) : undefined,
    // Real-time collaboration flag + the identity shown on remote cursors.
    collaborative: json.collaborative === true,
    editorUser: json.editor_user ?? null,
    // Words the spell checker has been taught on this project. Read-only here,
    // like the two fields above: additions go straight to their own endpoint.
    dictionaryWords: json.dictionary_words ?? [],
  };
}

// The docinfo actually in effect: the user's common docinfo when the project
// is opted in to it (and one is set), otherwise the project's own docinfo.
/**
 * @param {EditorState} state
 * @returns {string}
 */
export function effectiveDocinfo(state) {
  return state.useCommonDocinfo && state.commonDocinfo ? state.commonDocinfo : state.docinfo;
}

// Assemble the full, standalone PreTeXt document a build consumes.  The
// web-editor owns this entirely: `assembleFullProjectSource` resolves every
// <plus:* ref="..."/> placeholder, converts any latex/markdown divisions to
// PreTeXt, wraps the result in the outer <pretext> with the docinfo we pass
// inserted as a sibling, and guarantees the root element carries a label/xml:id
// so the build server knows which file to return.
//
// The only thing Rails contributes is *which* docinfo is in effect (the user's
// common preamble vs. the project's own) -- the rest of the document shape is
// not reshaped here.
// `projectAssets` are passed in rather than read off `state` so the editor can
// hand over its live asset pool: it owns that pool and keeps no working copy on
// `state`. The document only needs the assets to resolve each
// <plus:image ref="..."/> placeholder it emits.
/**
 * @param {EditorState} state
 * @param {Asset[]} projectAssets
 * @param {Snippet[]} projectSnippets
 * @returns {string}
 */
export function assembleFullPretextSource(state, projectAssets, projectSnippets) {
  if (!state.rootDivisionId) return "";
  return assembleFullProjectSource(
    state.divisions,
    state.rootDivisionId,
    effectiveDocinfo(state),
    projectAssets.map(toEditorAsset),
    state.language,
    projectSnippets.map(toEditorSnippet),
  );
}

/**
 * Rails project JSON straight through to the assembled document, for a host
 * that has no editor session to read state from -- the Node assembler. Equal by
 * construction to what a browser editing that same project would produce, which
 * is the property the server-side build path depends on.
 *
 * Returns `""` for a project with no root division, exactly as the editor's own
 * save path does: there is no document to assemble yet, and an empty string is
 * what the column held in that case.
 *
 * @param {RailsProjectJson} json
 * @returns {string}
 */
export function assembleProjectJson(json) {
  const state = railsToEditorState(json);
  return assembleFullPretextSource(state, state.projectAssets, state.projectSnippets);
}
