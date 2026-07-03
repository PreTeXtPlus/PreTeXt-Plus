class LibraryAsset < ApplicationRecord
  belongs_to :user
  has_one_attached :file
  enum :kind, {
    file: 0,
    authored: 1
  }, suffix: true

  # Rails forces SVGs to download rather than display inline by default,
  # since an SVG can carry a <script> (a stored-XSS precaution). This asset's
  # file is only ever rendered via `<img src>` in the asset manager/editor,
  # which never executes embedded scripts, so it's safe to bypass that
  # default here. Scoped to this method (rather than the app-wide Rails
  # config) so other blob URLs, e.g. build output, keep the default
  # protection.
  INLINE_OVERRIDE_CONTENT_TYPES = %w[ image/svg+xml ].freeze

  def url
    return "/image-not-found.svg" unless file.present?

    blob = file.blob
    # use 1.hour to avoid clock skew
    if INLINE_OVERRIDE_CONTENT_TYPES.include?(blob.content_type)
      blob.service.url(blob.key, expires_in: 1.hour, filename: blob.filename,
        content_type: blob.content_type, disposition: :inline)
    else
      file.url(expires_in: 1.hour)
    end
  end
end
