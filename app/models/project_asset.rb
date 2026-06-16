class ProjectAsset < ApplicationRecord
  belongs_to :library_asset
  accepts_nested_attributes_for :library_asset
  belongs_to :project
  validates_uniqueness_of :library_asset, scope: :project
  validates :ref, format: REF_REGEX, presence: true, uniqueness: { scope: :project }
  validate :ref_unique_among_divisions

  def url
    library_asset.url
  end

  private

  def ref_unique_among_divisions
    return unless project_id && ref

    if Division.where(project_id: project_id, ref: ref).exists?
      errors.add(:ref, "has already been taken")
    end
  end
end
