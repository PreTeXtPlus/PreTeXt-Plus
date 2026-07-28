/** The format of the source content being edited. */
export type SourceFormat = "pretext" | "latex" | "markdown";

/** The kind of a project asset — determines the inserted PreTeXt tag. */
export type AssetKind = "image" | "doenet";

/** An asset owned by a single project. */
export interface Asset {
  /**
   * Stable server-assigned identifier (hidden from users). Assets are
   * persisted through the project's nested `assets_attributes`, so a
   * freshly-created asset has **no** `id` until the project is saved and the
   * server mints one — the *absence* of an `id` is the signal that an asset is
   * new. The editor keys asset identity on `kind` + `ref` (never `id`), so an
   * id-less asset is fully usable the instant it's added.
   */
  id?: string;
  /** Human-readable display title shown in the library UI. */
  title: string;
  /** Short reference used when authoring references, e.g. `"euler-painting"`.
   * Authors write e.g. `<plus:image ref="euler-painting"/>` and the build system
   * resolves it to the necessary core PreTeXt markup based upon the kind of
   * asset it is.
   */
  ref?: string;
  /** The kind of asset — determines the tag inserted into the document. */
  kind: AssetKind;
  /**
   * User-authored inner XML for the asset's PreTeXt element — e.g.
   * `<shortdescription>...</shortdescription>` and `<description>...</description>`
   * for an image, or an activity's body for a Doenet interactive. Inserted
   * verbatim as the children of the generated element.
   */
  source?: string;
  /**
   * Whether this asset is backed by an uploaded/fetched file rather than
   * being defined purely by `source`. File-based image assets emit a
   * `source` attribute on the generated `<image>` element built from this
   * asset's {@link ref} plus a file extension (e.g. `ref="euler-painting"`
   * with a PNG upload emits `source="euler-painting.png"`); non-file image
   * assets carry no `source` attribute and rely entirely on their authored
   * `source` content.
   */
  isFile?: boolean;
  /**
   * Publicly accessible URL used as the asset-manager thumbnail
   * (`<img src={url}>`). Its filename extension (if any) is also used, as a
   * fallback after {@link fileRef}, to determine the extension appended to
   * `ref` for the generated `<image source="...">` attribute. The URL itself
   * (e.g. a UUID-based storage key) is never written into the document.
   */
  url?: string;
  /**
   * The server-assigned storage filename for a file-backed asset (e.g. a
   * UUID-based key). Its extension, if present, is used to build the
   * `source` attribute of the generated `<image>` element as
   * `"{ref}.{extension}"` — the rest of this value (e.g. the UUID itself)
   * is never written into the document.
   *
   * Only meaningful when {@link isFile} is true.
   */
  fileRef?: string;
  /** Mime type for the asset, if applicable.  Used for hints only. */
  contentType?: string;
}

/** Payload emitted when a user submits feedback from the editor UI. */
export interface FeedbackSubmission {
  /** Location where feedback was submitted (for example, "main-editor"). */
  context: string;
  /** Optional email provided by the user when they want a response. */
  email?: string;
  /** Free-form feedback message. */
  message: string;
  /** Whether `currentSource` was included in this submission. */
  includeCurrentSource: boolean;
  /** Current source content when the user opted in. */
  currentSource?: string;
  /** Project URL associated with this feedback, when available. */
  projectUrl?: string;
  /** Optional source format metadata for routing/debugging. */
  sourceFormat?: SourceFormat;
  /** Optional title metadata for routing/debugging. */
  title?: string;
  /** Client-side timestamp of submission. */
  submittedAt: string;
}

/**
 * Represents the full content state of the editor at any point in time.
 * When `sourceFormat` is `"pretext"`, `pretextSource` mirrors `source`.
 * When `sourceFormat` is `"latex"`, `pretextSource` holds the result of
 * converting the LaTeX source, or `pretextError` holds a description of why
 * conversion failed.
 * In both cases, `docinfo` contains the pretext docinfo element, which will
 * be inserted into the pretext source when building the preview.  Consumers can use this to store macros
 * and similar document-wide information that may be needed for previewing or other derived state.
 */
export interface EditorContentState {
  /** The raw source string as typed/loaded by the user. */
  source: string;
  /** The format of `source`. */
  sourceFormat: SourceFormat;
  /**
   * The PreTeXt XML derived from `source`.
   * Present when conversion succeeded (or when the source is already PreTeXt).
   */
  pretextSource?: string;
  /**
   * Human-readable error message set when conversion from a non-PreTeXt
   * format fails.  When present, `pretextSource` will be undefined.
   */
  pretextError?: string;
  /** The docinfo element for a pretext document, which can contain macros and similar
   * document wide information.
   */
  docinfo?: string;
  /** The user-level common docinfo/preamble XML. */
  commonDocinfo?: string;
  /** Whether project rendering should use a user-level common docinfo/preamble. */
  useCommonDocinfo?: boolean;
}

/**
 * The value passed to `onContentChange`.  Extends {@link EditorContentState}
 * with the `xmlId` of the division the change applies to, so a single callback
 * can describe every kind of change: a division content edit, a structural
 * reorder (which rewrites a parent division's content), or a document-wide
 * docinfo edit (reported against the root/document division).
 */
export interface EditorContentChange extends EditorContentState {
  /**
   * The `xml:id` of the division whose content changed.  For document-wide
   * changes such as docinfo edits, this is the root/document division.
   */
  xmlId: string;
}
