# The files a Content carries, and how they are served -- for every kind of
# content, not only assets. ProjectsController#content_file and
# #content_thumbnail look a record up by ref across all of a project's
# contents and serve whatever it has through these.
#
# What may carry a file is a separate question, answered by validation (see
# Content::AssetBehavior#attachments_fit_kind): today, a file asset, once.
module Content::AttachedFiles
  extend ActiveSupport::Concern

  # Rails forces SVGs to download rather than display inline by default,
  # since an SVG can carry a <script> (a stored-XSS precaution). Content's
  # files are only ever rendered via `<img src>` in the asset manager/editor,
  # which never executes embedded scripts, so it's safe to bypass that
  # default here. Scoped to this method (rather than the app-wide Rails
  # config) rather than changing the default for every blob URL app-wide.
  # See ServesBuildFiles::INLINE_OVERRIDE_CONTENT_TYPES for the same override
  # applied to build output.
  INLINE_OVERRIDE_CONTENT_TYPES = %w[ image/svg+xml ].freeze

  # Recognized image content types and the extension each maps to. Matches
  # ActiveStorage.variable_content_types (what #thumbnailable? treats as
  # rasterable) plus svg+xml (INLINE_OVERRIDE_CONTENT_TYPES) -- anything this
  # app will ever thumbnail or inline-serve has a known extension here too.
  CONTENT_TYPE_EXTENSIONS = {
    "image/png" => "png",
    "image/gif" => "gif",
    "image/jpeg" => "jpg",
    "image/tiff" => "tiff",
    "image/bmp" => "bmp",
    "image/vnd.adobe.photoshop" => "psd",
    "image/vnd.microsoft.icon" => "ico",
    "image/webp" => "webp",
    "image/avif" => "avif",
    "image/heic" => "heic",
    "image/heif" => "heif",
    "image/svg+xml" => "svg"
  }.freeze

  THUMBNAIL_SIZE = [ 200, 200 ].freeze

  # The content's file: the one attachment it carries. Nil when there is none.
  def file
    files.attachments.first
  end

  # Whether there is an image to serve. Safe on any kind.
  def file_attached?
    files.attached?
  end

  # Make `attachable` (an upload, an io hash, or an existing blob) this
  # content's file, in place of any it already has. Assigning a has_many_attached
  # replaces the whole list, and the replaced attachment is purged once the
  # record saves -- so, like any attribute, this takes effect on save.
  def attach_file(attachable)
    self.files = [ attachable ]
  end

  # Nested attributes and the upload/import params carry an asset's file under
  # the singular `file` key, as they always have; it lands here.
  alias_method :file=, :attach_file

  # The bare filename extension (no leading dot) inferred from the attached
  # file's content type -- never from the uploaded filename, which a browser
  # paste can't supply reliably (the web-editor renames a pasted image's file
  # to a bare, extensionless placeholder before it ever reaches here). Nil
  # when there's no file, or its content type isn't a recognized image type.
  def file_extension
    CONTENT_TYPE_EXTENSIONS[file_content_type] if file_attached?
  end

  # The attached file's MIME type (e.g. "image/png"), or nil when there's no
  # file. Delegates through the attachment to the blob.
  def file_content_type
    file.content_type if file_attached?
  end

  # The filename this content's file is presented as everywhere outside its own byte
  # storage: "REF.EXT" (or bare REF if the content type isn't recognized).
  # Single source of truth for every place that names this asset's file for
  # external consumption -- ProjectArchiveBuilder's external/ entry, the EPUB
  # cover picker, and the file's own download/inline Content-Disposition
  # (`url`, below) all call this instead of re-deriving a filename
  # themselves. Computed fresh from `ref` + `file_extension` rather than read
  # off the stored blob filename, since the same blob can be shared by
  # multiple Content rows with different refs (see Project#full_dup).
  def external_filename
    return nil unless file_attached?

    file_extension ? "#{ref}.#{file_extension}" : ref
  end

  def url
    return "/image-not-found.svg" unless file_attached?

    blob = file.blob
    # use 1.hour to avoid clock skew
    if INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type)
      blob.service.url(blob.key, expires_in: 1.hour, filename: ActiveStorage::Filename.new(external_filename),
        content_type: blob.content_type, disposition: :inline)
    else
      file.url(expires_in: 1.hour, filename: external_filename)
    end
  end

  # `url`, for saving the file rather than showing it: storage says "attachment",
  # so the browser saves it as `external_filename` even from another origin,
  # where a link's own `download` attribute is ignored. An SVG can be served this
  # way without the caveat above, since nothing renders it.
  def download_url
    return url unless file_attached?

    blob = file.blob
    blob.service.url(blob.key, expires_in: 1.hour, filename: ActiveStorage::Filename.new(external_filename),
      content_type: blob.content_type, disposition: :attachment)
  end

  # Whether `thumbnail_url` has anything to show: no file, or a file type
  # ActiveStorage can't raster a variant of, means no preview -- callers fall
  # back to a generic file icon. Cheap (no processing), so it's safe to call
  # from JSON rendering to decide whether to advertise a thumbnail path at
  # all, without paying for `thumbnail_url`'s variant processing there.
  def thumbnailable?
    return false unless file_attached?

    blob = file.blob
    INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type) || blob.variable?
  end

  # A small preview URL for the asset manager/editor list and the project
  # dashboard, distinct from `url` (the full file, used for the actual
  # `<image>` embed). Nil when `thumbnailable?` is false. SVGs are already
  # tiny/vector, so they skip variant processing and reuse the full `url`
  # directly; everything else is resized through a real ActiveStorage variant
  # (processed synchronously here, so only call this where that cost is
  # acceptable -- e.g. the dedicated thumbnail redirect action, not JSON
  # rendering of a list).
  def thumbnail_url
    return nil unless thumbnailable?

    blob = file.blob
    return url if INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type)

    file.variant(resize_to_limit: THUMBNAIL_SIZE).processed.url(expires_in: 1.hour)
  end
end
