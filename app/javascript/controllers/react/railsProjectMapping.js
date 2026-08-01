// Pure mappers between Rails' project JSON shape and the web-editor's
// `Division`/`Asset` shapes. Shared by every host that mounts `<Editors>`
// (./editor.jsx for the authenticated editor, ./shared_source.jsx for the
// read-only share view) so they can't silently drift on how the same JSON
// is interpreted.

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
 * @property {string} [thumbnail_path] - Fetchable small-preview URL; present only when the
 *   attached file can be thumbnailed (see Asset#thumbnailable?).
 * @property {string} [content_type] - The attached file's MIME type; present only when a
 *   file is attached.
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
//    "Edit asset" dialog's live preview, and as a fallback thumbnail when
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
    kind: "image",
    source: a.source ?? undefined,
    url: a.path ?? undefined,
    thumbnailUrl: a.thumbnail_path ?? undefined,
    extension: a.extension ?? undefined,
    contentType: a.content_type ?? undefined,
    isFile: Boolean(a.path),
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
    kind: rec.kind,
    source: rec.source,
    url: rec.url,
    thumbnailUrl: rec.thumbnailUrl,
    extension: rec.extension,
    contentType: rec.contentType,
    fileRef: rec.fileRef,
    // Recomputed from `url` rather than carried on `rec`, same reasoning as
    // railsAssetToEditor: file-backed-ness is a property of the attachment,
    // not of `kind`.
    isFile: Boolean(rec.url),
  };
}
