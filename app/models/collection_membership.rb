# One project's place in one collection. `position` is the owner's manual order;
# gaps are harmless, since only relative order matters.
class CollectionMembership < ApplicationRecord
  # touch: filing, removing or moving a project counts as activity on the collection,
  # which is what orders the dashboard's "recently updated" row.
  belongs_to :collection, inverse_of: :collection_memberships, touch: true
  belongs_to :project

  validates :project_id, uniqueness: { scope: :collection_id }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :project_owned_by_collection_owner

  before_validation :append_to_end, on: :create

  # Swaps places with the neighbouring project above ("up") or below ("down"). A
  # no-op at either end of the collection.
  def move!(direction)
    siblings = collection.collection_memberships.where.not(id: id)
    neighbour =
      case direction.to_s
      when "up" then siblings.where(position: ...position).reorder(position: :desc).first
      when "down" then siblings.where(position: (position + 1)..).reorder(:position).first
      else raise ArgumentError, "Unknown direction: #{direction.inspect}"
      end
    return self unless neighbour

    transaction do
      mine, theirs = position, neighbour.position
      neighbour.update!(position: mine)
      update!(position: theirs)
    end
    self
  end

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
