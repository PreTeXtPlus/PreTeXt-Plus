# What makes a Content an asset: an image an author embeds with
# `<plus:image ref="..."/>`, either backed by an uploaded file (`file_asset`),
# defined purely by its authored source (`authored_asset`), or rendered from its
# source by a generator (`generated_asset`, see Content::GeneratedAssetBehavior).
module Content::AssetBehavior
  extend ActiveSupport::Concern

  # The kind values an asset arrives as from callers that predate them being
  # part of Content's own `kind` -- the external @pretextbook/import package
  # still writes these -- mapped to the kinds they now are.
  LEGACY_ASSET_KINDS = { "file" => "file_asset", "authored" => "authored_asset", "generated" => "generated_asset" }.freeze

  included do
    # The cap applies only when adding a new asset: an account already over its
    # limit (subscription lapsed) keeps its existing assets rather than being
    # forced to delete them (see Collaboration#within_collaborator_limit for the
    # identical grandfathering rule).
    # Never for a backup's assets: taking a backup re-attaches blobs the account
    # already holds, and must not fail -- or count -- against the cap.
    validate :within_asset_quota, on: :create, if: -> { asset? && project.present? && !project.backup? }

    # Content can hold any number of attachments (see Content::AttachedFiles),
    # but what uses them so far is a single image: a file asset's upload, or a
    # generated asset's rendered picture. This is the one place to relax when
    # something needs more.
    validate :attachments_fit_kind
  end

  # The legacy spellings (see LEGACY_ASSET_KINDS) are accepted on the way in.
  def kind=(value)
    super(LEGACY_ASSET_KINDS.fetch(value.to_s, value))
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

  def attachments_fit_kind
    count = files.attachments.reject(&:marked_for_destruction?).size
    if count > 1
      errors.add(:files, "can hold only one file")
    elsif count == 1 && !(file_asset? || generated_asset?)
      errors.add(:files, "can be attached only to a file or generated asset")
    end
  end
end
