class Asset < ApplicationRecord
  # See Division: a build consumes assets too, so changing one makes built targets stale.
  belongs_to :project, touch: :source_updated_at
  has_one_attached :file

  enum :kind, {
    file: 0,
    authored: 1
  }, suffix: true

  validates :ref, format: REF_REGEX, presence: true, uniqueness: { scope: :project }
  validate :ref_unique_among_divisions
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

  private

  def ref_unique_among_divisions
    return unless project_id && ref

    if Division.where(project_id: project_id, ref: ref).exists?
      errors.add(:ref, "has already been taken")
    end
  end

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
