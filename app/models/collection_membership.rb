# One project's place in one collection. `position` is the owner's manual order;
# gaps are harmless, since only relative order matters.
class CollectionMembership < ApplicationRecord
  belongs_to :collection, inverse_of: :collection_memberships
  belongs_to :project

  validates :project_id, uniqueness: { scope: :collection_id }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :project_owned_by_collection_owner

  before_validation :append_to_end, on: :create

  private

  def append_to_end
    return if position.present? || collection.nil?
    last = collection.collection_memberships.maximum(:position)
    self.position = last.nil? ? 0 : last + 1
  end

  # Only a project's owner may file it, and only in their own collections --
  # collaborating on a project is not enough.
  def project_owned_by_collection_owner
    return if project.nil? || collection.nil?
    errors.add(:project, "must be owned by the collection's owner") unless project.user_id == collection.user_id
  end
end
