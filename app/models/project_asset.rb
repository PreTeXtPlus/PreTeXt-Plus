class ProjectAsset < ApplicationRecord
  belongs_to :library_asset
  accepts_nested_attributes_for :library_asset
  belongs_to :project
  validates_uniqueness_of :library_asset, scope: :project
  validates :ref, format: REF_REGEX, presence: true, uniqueness: { scope: :project }
  validate :ref_unique_among_divisions

  before_save :set_to_correct_user

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

  def set_to_correct_user
    unless project.user == library_asset.user
      new_la = LibraryAsset.new(library_asset.dup.attributes)
      new_la.user = project.user
      new_la.file.attach(library_asset.file.blob) if library_asset.file.attached?
      unless new_la.save
        errors.add(:library_asset, "could not be created")
      end
      self.library_asset=new_la
    end
  end
end
