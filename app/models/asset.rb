class Asset < ApplicationRecord
  include HasUniqueRef
  ref_sibling_classes "Division", "Snippet"

  # See Division: a build consumes assets too, so changing one makes built targets stale.
  belongs_to :project, touch: :source_updated_at
  has_one_attached :file

  enum :kind, {
    file: 0,
    authored: 1
  }, suffix: true

  # The cap applies only when adding a new asset: an account already over its
  # limit (subscription lapsed) keeps its existing assets rather than being
  # forced to delete them (see Collaboration#within_collaborator_limit for the
  # identical grandfathering rule).
  validate :within_asset_quota, on: :create, if: -> { project.present? }

  # Rails forces SVGs to download rather than display inline by default,
  # since an SVG can carry a <script> (a stored-XSS precaution). This asset's
  # file is only ever rendered via `<img src>` in the asset manager/editor,
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

  # The bare filename extension (no leading dot) inferred from the attached
  # file's content type -- never from the uploaded filename, which a browser
  # paste can't supply reliably (the web-editor renames a pasted image's file
  # to a bare, extensionless placeholder before it ever reaches here). Nil
  # when there's no file, or its content type isn't a recognized image type.
  def file_extension
    CONTENT_TYPE_EXTENSIONS[file_content_type] if file.attached?
  end

  # The attached file's MIME type (e.g. "image/png"), or nil when there's no
  # file. Delegates through the attachment proxy to the blob.
  def file_content_type
    file.content_type if file.attached?
  end

  # The filename this asset is presented as everywhere outside its own byte
  # storage: "REF.EXT" (or bare REF if the content type isn't recognized).
  # Single source of truth for every place that names this asset's file for
  # external consumption -- ProjectArchiveBuilder's external/ entry, the EPUB
  # cover picker, and this asset's own download/inline Content-Disposition
  # (`url`, below) all call this instead of re-deriving a filename
  # themselves. Computed fresh from `ref` + `file_extension` rather than read
  # off the stored blob filename, since the same blob can be shared by
  # multiple Asset rows with different refs (see Project#full_dup).
  def external_filename
    return nil unless file.attached?

    file_extension ? "#{ref}.#{file_extension}" : ref
  end

  def url
    return "/image-not-found.svg" unless file.present?

    blob = file.blob
    # use 1.hour to avoid clock skew
    if INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type)
      blob.service.url(blob.key, expires_in: 1.hour, filename: ActiveStorage::Filename.new(external_filename),
        content_type: blob.content_type, disposition: :inline)
    else
      file.url(expires_in: 1.hour, filename: external_filename)
    end
  end

  THUMBNAIL_SIZE = [ 200, 200 ].freeze

  # Whether `thumbnail_url` has anything to show: no file, or a file type
  # ActiveStorage can't raster a variant of, means no preview -- callers fall
  # back to a generic file icon. Cheap (no processing), so it's safe to call
  # from JSON rendering to decide whether to advertise a thumbnail path at
  # all, without paying for `thumbnail_url`'s variant processing there.
  def thumbnailable?
    return false unless file.present?

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

  private

  # Keyed to the project OWNER, not whoever is actually uploading -- an
  # asset's storage cost belongs to whoever's account it lives in, exactly
  # like Project#collaborator_limit follows the owner rather than the inviter.
  def within_asset_quota
    owner = project.user
    if owner.present? && owner.assets.count >= owner.asset_quota
      errors.add(:base, "Asset limit (#{owner.asset_quota}) reached for this account")
    end
  end
end
